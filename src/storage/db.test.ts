import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  addBook,
  countBooks,
  deleteBook,
  exportBooks,
  getBook,
  getDb,
  getSettings,
  importBooks,
  listBooks,
  resetDbForTests,
  saveSettings,
  updateBook,
} from './db'
import { searchBooks } from './search'

beforeEach(async () => {
  const db = await getDb()
  await db.clear('books')
  await db.clear('settings')
  resetDbForTests()
})

describe('books CRUD', () => {
  it('saves a book and reads it back', async () => {
    const saved = await addBook({ title: 'Dune', author: 'Frank Herbert', source: 'ocr' })
    expect(saved.id).toBeTruthy()
    expect(await getBook(saved.id)).toMatchObject({ title: 'Dune', author: 'Frank Herbert' })
  })

  it('trims whitespace the user leaves in the fields', async () => {
    const saved = await addBook({ title: '  Dune  ', author: ' Frank Herbert ' })
    expect(saved.title).toBe('Dune')
    expect(saved.author).toBe('Frank Herbert')
  })

  it('defaults source and photo count', async () => {
    const saved = await addBook({ title: 'Dune', author: '' })
    expect(saved.source).toBe('manual')
    expect(saved.photoCount).toBe(1)
  })

  it('starts a new book as still to be read', async () => {
    // You catalogue a book before you read it, so unread is the honest default.
    expect((await addBook({ title: 'Dune', author: '' })).status).toBe('unread')
  })

  it('remembers a book marked as read', async () => {
    const saved = await addBook({ title: 'Dune', author: '' })
    await updateBook(saved.id, { status: 'read' })
    expect((await getBook(saved.id))?.status).toBe('read')
  })

  it('treats a book saved before reading status existed as unread', async () => {
    const db = await getDb()
    await db.put('books', {
      id: 'legacy',
      title: 'An older record',
      author: '',
      dateAdded: 1,
      dateModified: 1,
      source: 'manual',
      photoCount: 1,
    })
    expect((await getBook('legacy'))?.status).toBe('unread')
  })

  it('stores a cover and hands it back as a Blob with its type intact', async () => {
    const cover = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })
    const saved = await addBook({ title: 'Dune', author: '', cover })
    const loaded = await getBook(saved.id)
    expect(loaded?.cover).toBeInstanceOf(Blob)
    expect(loaded?.cover?.type).toBe('image/jpeg')
    expect(await loaded?.cover?.text()).toBe('jpeg-bytes')
  })

  it('keeps the cover when other fields are edited', async () => {
    const saved = await addBook({
      title: 'Dune',
      author: '',
      cover: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
    })
    await updateBook(saved.id, { title: 'Dune Messiah' })
    expect(await (await getBook(saved.id))?.cover?.text()).toBe('jpeg-bytes')
  })

  it('lists newest first', async () => {
    // Written straight to the store: two addBook calls in the same millisecond tie on
    // dateAdded, and the ordering under test is the one that matters to the library list.
    const db = await getDb()
    const base = { author: '', source: 'manual' as const, photoCount: 1, dateModified: 0 }
    await db.put('books', { ...base, id: 'older', title: 'First', dateAdded: 1000 })
    await db.put('books', { ...base, id: 'newer', title: 'Second', dateAdded: 2000 })
    expect((await listBooks()).map((b) => b.id)).toEqual(['newer', 'older'])
  })

  it('updates a book and moves dateModified without touching dateAdded', async () => {
    const saved = await addBook({ title: 'Dune', author: 'Frank Herbert' })
    const updated = await updateBook(saved.id, { title: 'Dune Messiah' })
    expect(updated.title).toBe('Dune Messiah')
    expect(updated.dateAdded).toBe(saved.dateAdded)
    expect(updated.dateModified).toBeGreaterThanOrEqual(saved.dateModified)
  })

  it('refuses to update a book that is not there', async () => {
    await expect(updateBook('missing', { title: 'x' })).rejects.toThrow(/no book/i)
  })

  it('deletes a book', async () => {
    const saved = await addBook({ title: 'Dune', author: '' })
    await deleteBook(saved.id)
    expect(await getBook(saved.id)).toBeUndefined()
    expect(await countBooks()).toBe(0)
  })
})

describe('settings', () => {
  it('returns defaults before anything is saved', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('merges a partial change over what is stored', async () => {
    await saveSettings({ lookupMode: 'forced-off' })
    await saveSettings({ languages: ['eng', 'mkd'] })
    const settings = await getSettings()
    expect(settings.lookupMode).toBe('forced-off')
    expect(settings.languages).toEqual(['eng', 'mkd'])
  })
})

describe('search', () => {
  const books = [
    { id: '1', title: 'The Silent Orchard', author: 'Marta Reyes' },
    { id: '2', title: 'Iron Harvest', author: 'D. K. Whitlock' },
    { id: '3', title: 'Мојот Роман', author: 'Ана Петрова' },
  ].map((b) => ({
    ...b,
    dateAdded: 0,
    dateModified: 0,
    source: 'ocr' as const,
    photoCount: 1,
  }))

  it('returns everything for an empty query', () => {
    expect(searchBooks(books, '   ')).toHaveLength(3)
  })

  it('matches on title and on author', () => {
    expect(searchBooks(books, 'orchard').map((b) => b.id)).toEqual(['1'])
    expect(searchBooks(books, 'whitlock').map((b) => b.id)).toEqual(['2'])
  })

  it('ignores case, accents and punctuation', () => {
    expect(searchBooks(books, 'D.K. WHITLOCK').map((b) => b.id)).toEqual(['2'])
  })

  it('requires every token to match, so two words narrow the results', () => {
    expect(searchBooks(books, 'silent reyes').map((b) => b.id)).toEqual(['1'])
    expect(searchBooks(books, 'silent whitlock')).toHaveLength(0)
  })

  it('matches Cyrillic', () => {
    expect(searchBooks(books, 'роман').map((b) => b.id)).toEqual(['3'])
  })

  it('matches on a partial word, the way typing into a search box feels', () => {
    expect(searchBooks(books, 'harv').map((b) => b.id)).toEqual(['2'])
  })
})

describe('export and import', () => {
  it('round-trips a collection including covers', async () => {
    const cover = new Blob(['cover-bytes'], { type: 'image/jpeg' })
    await addBook({ title: 'Dune', author: 'Frank Herbert', cover, source: 'ocr', status: 'read' })
    const file = await exportBooks()
    expect(file.format).toBe('book-scanner-export')
    expect(file.books[0].cover).toMatch(/^data:image\/jpeg;base64,/)

    const db = await getDb()
    await db.clear('books')
    const result = await importBooks(file)
    expect(result).toEqual({ added: 1, skipped: 0 })

    const [restored] = await listBooks()
    expect(restored.title).toBe('Dune')
    expect(restored.author).toBe('Frank Herbert')
    expect(restored.source).toBe('ocr')
    expect(restored.status).toBe('read')
    expect(await restored.cover?.text()).toBe('cover-bytes')
  })

  it('skips books that are already there instead of overwriting them', async () => {
    await addBook({ title: 'Dune', author: 'Frank Herbert' })
    const file = await exportBooks()
    expect(await importBooks(file)).toEqual({ added: 0, skipped: 1 })
    expect(await countBooks()).toBe(1)
  })

  it('rejects a file that is not a backup', async () => {
    await expect(importBooks({ hello: 'world' })).rejects.toThrow(/not a Book Scanner backup/i)
    await expect(importBooks(null)).rejects.toThrow()
  })

  it('skips malformed entries but keeps the good ones', async () => {
    const result = await importBooks({
      format: 'book-scanner-export',
      version: 1,
      exported: new Date().toISOString(),
      books: [{ id: 'ok', title: 'Dune' }, { title: 'no id' }, null],
    })
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(2)
  })
})
