import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  backupFilename,
  createBackupBlob,
  deliverBackup,
  describeBackup,
  exportToFile,
  importFromFile,
} from './backup'
import { addBook, getDb, listBooks, resetDbForTests } from './db'

beforeEach(async () => {
  const db = await getDb()
  await db.clear('books')
  resetDbForTests()
})

function fakeNavigator(overrides: Partial<Navigator> = {}): Navigator {
  return overrides as Navigator
}

describe('backupFilename', () => {
  it('is dated, so successive backups do not overwrite each other', () => {
    expect(backupFilename(new Date('2026-08-29T10:00:00Z'))).toBe('book-scanner-2026-08-29.json')
  })
})

describe('createBackupBlob', () => {
  it('writes every book into one JSON file', async () => {
    await addBook({ title: 'Dune', author: 'Frank Herbert', source: 'ocr' })
    await addBook({ title: 'Neuromancer', author: 'William Gibson', source: 'ocr' })
    const { blob, books } = await createBackupBlob()
    expect(books).toBe(2)
    const parsed = JSON.parse(await blob.text())
    expect(parsed.format).toBe('book-scanner-export')
    expect(parsed.books.map((b: { title: string }) => b.title).sort()).toEqual([
      'Dune',
      'Neuromancer',
    ])
  })
})

describe('deliverBackup', () => {
  it('uses the share sheet when the device has one', async () => {
    // The only route that works inside an installed app on iOS.
    const share = vi.fn(async () => undefined)
    const method = await deliverBackup(
      new Blob(['{}']),
      'backup.json',
      fakeNavigator({ canShare: () => true, share }),
    )
    expect(method).toBe('shared')
    expect(share).toHaveBeenCalled()
  })

  it('falls back to a download when sharing is not available', async () => {
    const method = await deliverBackup(new Blob(['{}']), 'backup.json', fakeNavigator({}))
    expect(method).toBe('downloaded')
  })

  it('falls back to a download when sharing fails for a reason other than cancelling', async () => {
    const method = await deliverBackup(
      new Blob(['{}']),
      'backup.json',
      fakeNavigator({
        canShare: () => true,
        share: vi.fn(async () => {
          throw new Error('not allowed')
        }),
      }),
    )
    expect(method).toBe('downloaded')
  })

  it('reports a cancelled share sheet as a cancellation, not a failed backup', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    await expect(
      deliverBackup(
        new Blob(['{}']),
        'backup.json',
        fakeNavigator({
          canShare: () => true,
          share: vi.fn(async () => {
            throw abort
          }),
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('importFromFile', () => {
  it('restores a collection exported from another device', async () => {
    // The whole point of the feature: this is the phone-switch path.
    await addBook({ title: 'Dune', author: 'Frank Herbert', source: 'ocr' })
    const { blob } = await createBackupBlob()

    const db = await getDb()
    await db.clear('books')
    expect(await listBooks()).toHaveLength(0)

    const result = await importFromFile(new File([blob], 'backup.json'))
    expect(result).toEqual({ added: 1, skipped: 0 })
    const [restored] = await listBooks()
    expect(restored.title).toBe('Dune')
    expect(restored.author).toBe('Frank Herbert')
  })

  it('carries cover images across the move', async () => {
    await addBook({
      title: 'Dune',
      author: 'Frank Herbert',
      cover: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
    })
    const { blob } = await createBackupBlob()
    await (await getDb()).clear('books')
    await importFromFile(new File([blob], 'backup.json'))

    const [restored] = await listBooks()
    expect(await restored.cover?.text()).toBe('jpeg-bytes')
  })

  it('explains itself when handed the wrong file', async () => {
    await expect(
      importFromFile(new File(['not json at all'], 'holiday-photo.jpg')),
    ).rejects.toThrow(/not a readable backup/i)
  })

  it('does not duplicate books when the same backup is imported twice', async () => {
    await addBook({ title: 'Dune', author: 'Frank Herbert' })
    const { blob } = await createBackupBlob()
    await importFromFile(new File([blob], 'backup.json'))
    expect(await listBooks()).toHaveLength(1)
  })
})

describe('exportToFile', () => {
  it('reports what was written and how', async () => {
    await addBook({ title: 'Dune', author: 'Frank Herbert' })
    const result = await exportToFile(fakeNavigator({}))
    expect(result.books).toBe(1)
    expect(result.method).toBe('downloaded')
    expect(describeBackup(result)).toMatch(/1 books/)
  })
})
