import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'covers')

/**
 * The offline guarantee, tested as a first-class case rather than assumed.
 *
 * The sequence is the real one: install the app, run the first-run offline setup, cut the
 * network, cold-start, and scan. Only Chromium is exercised here — `context.setOffline`
 * plus a service worker is what makes the test meaningful, and the desktop project is the
 * one that has it.
 */
test.describe('offline', () => {
  async function waitForServiceWorker(page: Page) {
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration())?.active != null,
      undefined,
      { timeout: 60_000 },
    )
  }

  test('after the offline setup, a cold start scans with the network off', async ({
    page,
    context,
    browserName,
  }) => {
    // `context.setOffline` against a service worker is a Chromium capability; the same
    // guarantee on a real iPhone is checked by hand and recorded in the project report.
    test.skip(browserName !== 'chromium', 'needs service-worker-aware offline emulation')

    await page.goto('/')
    await page.evaluate(async () => {
      for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
      localStorage.clear()
    })
    await page.reload()
    await waitForServiceWorker(page)

    // Run the first-run download that makes the OCR engine available offline.
    await page.getByRole('button', { name: 'Set up offline scanning' }).click()
    // The app defaults to Macedonian; this fixture is English, and with the network cut
    // there is no second chance to fetch a model that was not downloaded here.
    await page.getByRole('checkbox', { name: 'English' }).check()
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await expect(page.getByText('Offline scanning is ready')).toBeVisible({ timeout: 180_000 })

    // Cut the network and cold-start the app.
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Book Scanner' })).toBeVisible()

    // The pill must report the loss of connectivity — and must still be clickable.
    await page.getByRole('button', { name: 'Scan', exact: true }).click()
    const pill = page.getByTestId('lookup-pill')
    await expect(pill).toContainText('Off · offline', { timeout: 60_000 })
    await expect(pill).toBeEnabled()

    // The part that matters: scanning, OCR and detection with no network at all.
    // English fixtures, and the app now defaults to Macedonian.
    const english = page.getByRole('button', { name: 'English' })
    if ((await english.getAttribute('aria-pressed')) !== 'true') await english.click()
    await page.getByTestId('file-input').setInputFiles(join(fixtures, 'thirteen-doors.png'))
    await expect(page.getByTestId('review-card')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Thirteen Doors')

    await page.getByTestId('save-all').click()
    await expect(page.getByTestId('book-row')).toContainText('Thirteen Doors')

    // And it is still there after another offline reload.
    await page.reload()
    await page.getByRole('button', { name: 'My Books' }).click()
    await expect(page.getByTestId('book-row')).toContainText('Thirteen Doors')

    await context.setOffline(false)
  })

  test('the app ships a web manifest and icons so it can be installed', async ({ page }) => {
    await page.goto('/')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBeTruthy()

    const manifest = await (await page.request.get(href!)).json()
    expect(manifest.name).toBe('Book Scanner')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toContain('512x512')
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)

    for (const icon of manifest.icons) {
      expect((await page.request.get(`/${icon.src}`)).status()).toBe(200)
    }
    // iOS ignores the manifest icon and uses this one.
    expect((await page.request.get('/icons/apple-touch-icon.png')).status()).toBe(200)
  })
})
