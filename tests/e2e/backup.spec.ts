import { expect, test } from '@playwright/test'
import { join } from 'node:path'

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'covers')

/**
 * Moving a collection to a new phone, done the way a person would do it.
 *
 * The books exist only on the device, so this file is the only thing standing between a
 * new phone and an empty library. It is tested end to end — a real export written to a
 * real file, storage wiped as a fresh install would be, and the file imported back —
 * because every part of it (the download, the parse, the cover bytes) has its own way of
 * failing quietly.
 */
test('a collection exported on one device restores on another', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'needs download interception')

  await page.goto('/')
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
    localStorage.clear()
  })
  await page.reload()

  // Put a real scanned book in, cover and all.
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  // English fixtures, and the app now defaults to Macedonian.
    const english = page.getByRole('button', { name: 'English' })
    if ((await english.getAttribute('aria-pressed')) !== 'true') await english.click()
    await page.getByTestId('file-input').setInputFiles(join(fixtures, 'winter-letters.png'))
  await expect(page.getByTestId('review-card').first()).toBeVisible({ timeout: 120_000 })
  await page.getByTestId('save-all').click()
  await expect(page.getByTestId('book-row')).toHaveCount(1)
  // Whatever the scanner decided this book was, that is what must come back — the test is
  // about the move, not about recognition accuracy.
  const savedBefore = await page.getByTestId('book-row').textContent()

  // Export it.
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-books').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^book-scanner-\d{4}-\d{2}-\d{2}\.json$/)
  const backupPath = await download.path()

  // A new phone: the app installed, nothing in it.
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
  })
  await page.reload()
  await page.getByRole('button', { name: 'My Books' }).click()
  await expect(page.getByTestId('book-row')).toHaveCount(0)

  // Import the file that came off the old phone.
  await page.getByTestId('import-books').setInputFiles(backupPath)
  await expect(page.getByTestId('book-row')).toHaveCount(1)
  await expect(page.getByTestId('book-row')).toHaveText(savedBefore ?? '')

  // The cover came across too, not just the text.
  const cover = page.getByTestId('book-row').locator('img.cover')
  await expect(cover).toBeVisible()
  expect(await cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
})

test('importing the same backup twice does not duplicate the collection', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'needs download interception')

  await page.goto('/')
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
  })
  await page.reload()

  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await page.getByTestId('file-input').setInputFiles(join(fixtures, 'iron-harvest.png'))
  await expect(page.getByTestId('review-card').first()).toBeVisible({ timeout: 120_000 })
  await page.getByTestId('save-all').click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-books').click()
  const backupPath = await (await downloadPromise).path()

  await page.getByTestId('import-books').setInputFiles(backupPath)
  await expect(page.getByText(/already here/i)).toBeVisible()
  await expect(page.getByTestId('book-row')).toHaveCount(1)
})

test('a file that is not a backup is refused with an explanation', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for a parse failure')

  await page.goto('/')
  await page.getByRole('button', { name: 'My Books' }).click()
  await page.getByTestId('import-books').setInputFiles(join(fixtures, 'winter-letters.png'))
  await expect(page.getByText(/not a readable backup/i)).toBeVisible()
})
