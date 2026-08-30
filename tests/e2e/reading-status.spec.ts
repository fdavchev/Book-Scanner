import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'covers')

/** Saves one book so there is something to mark as read. */
async function saveOneBook(page: Page, file: string) {
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  const pill = page.getByTestId('lookup-pill')
  if ((await pill.getAttribute('data-mode')) !== 'forced-off') await pill.click()
  const english = page.getByRole('button', { name: 'English' })
  if ((await english.getAttribute('aria-pressed')) !== 'true') await english.click()
  await page.getByTestId('file-input').setInputFiles(join(fixtures, file))
  await expect(page.getByTestId('review-card').first()).toBeVisible({ timeout: 120_000 })
  await page.getByTestId('save-all').click()
  await expect(page.getByTestId('book-row').first()).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
    localStorage.clear()
  })
  await page.reload()
})

test('a new book starts as still to be read, and can be marked read from the list', async ({
  page,
}) => {
  await saveOneBook(page, 'winter-letters.png')

  const status = page.getByTestId('status-toggle').first()
  await expect(status).toHaveAttribute('data-status', 'unread')
  await expect(status).toContainText('To read')

  // One tap from the list — no trip through the editor.
  await status.click()
  await expect(status).toHaveAttribute('data-status', 'read')
  await expect(status).toContainText('Read')

  // And it survives a reload, so it really was stored.
  await page.reload()
  await page.getByRole('button', { name: 'My Books' }).click()
  await expect(page.getByTestId('status-toggle').first()).toHaveAttribute('data-status', 'read')
})

test('the filter shows only what has been read, or only what has not', async ({ page }) => {
  await saveOneBook(page, 'winter-letters.png')
  await saveOneBook(page, 'iron-harvest.png')
  await expect(page.getByTestId('book-row')).toHaveCount(2)

  // Mark the first one read.
  await page.getByTestId('status-toggle').first().click()
  await expect(page.getByTestId('status-toggle').first()).toHaveAttribute('data-status', 'read')

  await page.getByTestId('filter-read').click()
  await expect(page.getByTestId('book-row')).toHaveCount(1)

  await page.getByTestId('filter-unread').click()
  await expect(page.getByTestId('book-row')).toHaveCount(1)
  await expect(page.getByTestId('status-toggle').first()).toHaveAttribute('data-status', 'unread')

  await page.getByTestId('filter-all').click()
  await expect(page.getByTestId('book-row')).toHaveCount(2)
})

test('the status can also be set while editing a book', async ({ page }) => {
  await saveOneBook(page, 'burning-season.png')

  await page.getByTestId('open-book').click()
  await page.getByTestId('status-toggle').click()
  await page.getByTestId('save-edit').click()

  await expect(page.getByTestId('status-toggle').first()).toHaveAttribute('data-status', 'read')
})
