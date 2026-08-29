/**
 * Renders the app icons with Playwright, so the project needs no image toolchain.
 * The output is committed, so this only needs re-running if the mark changes.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const iconsDir = join(publicDir, 'icons')

/** An open book over a warm ground. `pad` leaves the safe area a maskable icon needs. */
function mark(size, pad = 0.12) {
  const inner = size * (1 - pad * 2)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; }
    body { width: ${size}px; height: ${size}px; display: grid; place-items: center;
           background: #8c3b2e; }
    svg { width: ${inner}px; height: ${inner}px; }
  </style></head><body>
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M50 26c-9-6-19-8-30-7v52c11-1 21 1 30 7 9-6 19-8 30-7V19c-11-1-21 1-30 7z"
            fill="#faf8f5"/>
      <path d="M50 26v52" stroke="#8c3b2e" stroke-width="4" stroke-linecap="round"/>
      <path d="M28 34c6-1 11 0 16 2M28 46c6-1 11 0 16 2M56 36c6-2 11-3 16-2M56 48c6-2 11-3 16-2"
            stroke="#c9a227" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    </svg>
  </body></html>`
}

async function main() {
  await mkdir(iconsDir, { recursive: true })
  const browser = await chromium.launch()

  for (const [name, size, pad] of [
    ['icon-192.png', 192, 0.1],
    ['icon-512.png', 512, 0.1],
    // A maskable icon is cropped to whatever shape the launcher uses, so the mark is
    // pulled well inside the frame.
    ['icon-512-maskable.png', 512, 0.22],
    ['apple-touch-icon.png', 180, 0.1],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(mark(size, pad), { waitUntil: 'load' })
    await page.screenshot({ path: join(iconsDir, name), type: 'png' })
    await page.close()
    console.log(`  ${name} (${size}×${size})`)
  }

  await browser.close()
  await writeFile(
    join(publicDir, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="18" fill="#8c3b2e"/>
  <path d="M50 30c-8-5-17-7-26-6v46c9-1 18 1 26 6 8-5 17-7 26-6V24c-9-1-18 1-26 6z" fill="#faf8f5"/>
  <path d="M50 30v46" stroke="#8c3b2e" stroke-width="4" stroke-linecap="round"/>
</svg>
`,
  )
  console.log('  favicon.svg')
}

main()
