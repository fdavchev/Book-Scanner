import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'covers')

/** Scans one rendered cover through the real pipeline and waits for the review card. */
async function scanCover(page: Page, file: string) {
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await page.getByTestId('file-input').setInputFiles(join(fixtures, file))
  await expect(page.getByTestId('review-card').first()).toBeVisible({ timeout: 120_000 })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // A clean device for every test: no leftover books, no cached settings.
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) {
      if (db.name) indexedDB.deleteDatabase(db.name)
    }
    localStorage.clear()
  })
  await page.reload()
})

test('scans a cover, detects title and author, and saves it to the collection', async ({
  page,
}) => {
  await scanCover(page, 'winter-letters.png')

  await expect(page.getByLabel('Title')).toHaveValue('Winter Letters')
  await expect(page.getByLabel('Author')).toHaveValue('Jonas Lindqvist')

  await page.getByTestId('save-all').click()

  await expect(page.getByRole('heading', { name: 'My Books' })).toBeVisible()
  await expect(page.getByTestId('book-row')).toHaveCount(1)
  await expect(page.getByTestId('book-row')).toContainText('Winter Letters')
})

test('a wrong detection can be corrected before saving', async ({ page }) => {
  await scanCover(page, 'iron-harvest.png')

  await page.getByLabel('Title').fill('Iron Harvest (corrected)')
  await page.getByLabel('Author').fill('Someone Else')
  await page.getByTestId('save-all').click()

  await expect(page.getByTestId('book-row')).toContainText('Iron Harvest (corrected)')
  await expect(page.getByTestId('book-row')).toContainText('Someone Else')
})

test('books survive a reload, with their cover image', async ({ page }) => {
  await scanCover(page, 'burning-season.png')
  await page.getByTestId('save-all').click()
  await expect(page.getByTestId('book-row')).toHaveCount(1)

  await page.reload()
  await page.getByRole('button', { name: 'My Books' }).click()

  await expect(page.getByTestId('book-row')).toHaveCount(1)
  await expect(page.getByTestId('book-row')).toContainText('Burning Season')
  // The cover is a Blob read back out of IndexedDB and rendered — proof the image bytes
  // themselves persisted, which the fake-indexeddb unit tests cannot show.
  const cover = page.getByTestId('book-row').locator('img.cover')
  await expect(cover).toBeVisible()
  expect(await cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
})

test('search narrows the library, and a book can be edited then deleted', async ({ page }) => {
  await scanCover(page, 'winter-letters.png')
  await page.getByTestId('save-all').click()
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await scanCover(page, 'paper-tigers.png')
  await page.getByTestId('save-all').click()
  await expect(page.getByTestId('book-row')).toHaveCount(2)

  await page.getByTestId('library-search').fill('tigers')
  await expect(page.getByTestId('book-row')).toHaveCount(1)
  await expect(page.getByTestId('book-row')).toContainText('Paper Tigers')

  await page.getByTestId('book-row').click()
  await page.getByLabel('Title').fill('Paper Tigers, Second Edition')
  await page.getByTestId('save-edit').click()
  await expect(page.getByTestId('book-row')).toContainText('Paper Tigers, Second Edition')

  page.on('dialog', (dialog) => dialog.accept())
  await page.getByTestId('book-row').click()
  await page.getByTestId('delete-book').click()
  await expect(page.getByTestId('book-row')).toHaveCount(0)
})

test('two photos of the same book collapse into one review card', async ({ page }) => {
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await page
    .getByTestId('file-input')
    .setInputFiles([join(fixtures, 'quiet-machine.png'), join(fixtures, 'quiet-machine.png')])
  await expect(page.getByTestId('review-card')).toHaveCount(1, { timeout: 120_000 })
  await expect(page.getByTestId('review-card')).toContainText('from 2 photos')
})

test('the lookup pill stays usable and can be forced off', async ({ page }) => {
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  const pill = page.getByTestId('lookup-pill')

  await expect(pill).toHaveAttribute('data-mode', 'auto')
  await pill.click()
  await expect(pill).toHaveAttribute('data-mode', 'forced-off')
  await expect(pill).toContainText('Lookup: Off')
  await pill.click()
  await expect(pill).toHaveAttribute('data-mode', 'forced-on')
  await expect(pill).toBeEnabled()
})
