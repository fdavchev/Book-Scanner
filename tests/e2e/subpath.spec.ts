import { expect, test } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

/**
 * `npm run deploy` publishes to GitHub Pages, which serves a project site from a subpath
 * (https://user.github.io/book-scanner/) rather than the domain root. Every asset URL in
 * the app — including the vendored OCR worker, core and language data — has to be
 * resolved against that base, or the recommended install route produces a blank page or
 * a scanner that cannot start.
 *
 * So the subpath build is built and scanned for real here, rather than assumed to work.
 */
const BASE = '/book-scanner/'
const PORT = 4188
const isWindows = process.platform === 'win32'

let server: ChildProcess | undefined

test.beforeAll(async () => {
  execFileSync(isWindows ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    shell: isWindows,
    env: { ...process.env, VITE_BASE: BASE },
    timeout: 240_000,
  })

  server = spawn(
    isWindows ? 'npm.cmd' : 'npm',
    ['run', 'preview', '--', '--port', String(PORT), '--strictPort'],
    {
      cwd: process.cwd(),
      stdio: 'ignore',
      shell: isWindows,
      // `vite preview` reads the same config, so it needs the base too — otherwise it
      // serves the subpath build from the root and nothing resolves.
      env: { ...process.env, VITE_BASE: BASE },
    },
  )

  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${PORT}${BASE}`)
      if (res.ok) break
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error('preview server did not start')
    await new Promise((r) => setTimeout(r, 500))
  }
})

test.afterAll(async () => {
  server?.kill()
  // Leave the tree holding a root-base build, which is what every other test expects.
  execFileSync(isWindows ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    shell: isWindows,
    timeout: 240_000,
  })
})

test('the app works when served from a subpath, as GitHub Pages serves it', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one engine is enough to prove the paths resolve')

  const url = `http://localhost:${PORT}${BASE}`
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Book Scanner' })).toBeVisible()

  // The manifest, its icons and the OCR asset list must all resolve under the base.
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toContain(BASE)
  // Absolute: a relative request would resolve against the config's baseURL, which is a
  // different server running the root-base build.
  const manifest = await (await page.request.get(new URL(manifestHref!, url).href)).json()
  expect(manifest.start_url).toBe(BASE)
  expect(manifest.scope).toBe(BASE)

  const assets = await (await page.request.get(`${url}tesseract/manifest.json`)).json()
  expect(assets.worker[0]).toBe('tesseract/worker.min.js')

  // The real proof: OCR loads its worker, core and language data from the subpath.
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await page
    .getByTestId('file-input')
    .setInputFiles(join(process.cwd(), 'tests', 'fixtures', 'covers', 'river-of-stone.png'))
  await expect(page.getByTestId('review-card')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('The River of Stone')
})
