/**
 * Renders synthetic book covers to PNG with Playwright — no image library needed.
 *
 * These exist because the Open Library benchmark set is 300×500 artwork thumbnails,
 * which is *not* what the app sees. A photo of a physical book is ~3000×4000 with the
 * cover filling the frame, so the title is hundreds of pixels tall. These fixtures are
 * rendered at 1200×1800 to match that, and cover the layouts a detector has to survive:
 * title at the top / middle / bottom, all-caps and title-case, light-on-dark and
 * dark-on-light, multi-line titles, "by" prefixes, and the usual cover noise —
 * "A NOVEL", bestseller flashes, imprint names.
 *
 *   node scripts/make-fixtures.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'covers')

/** @typedef {{id:string,title:string,author:string,layout:string,noise?:string[],byPrefix?:boolean}} Cover */

/** @type {Cover[]} */
const COVERS = [
  { id: 'silent-orchard', title: 'The Silent Orchard', author: 'Marta Reyes', layout: 'top-caps-dark', noise: ['A NOVEL'] },
  { id: 'winter-letters', title: 'Winter Letters', author: 'Jonas Lindqvist', layout: 'centre-serif-light', noise: ['A NOVEL', 'PENGUIN BOOKS'] },
  { id: 'iron-harvest', title: 'Iron Harvest', author: 'D. K. Whitlock', layout: 'bottom-caps-dark', noise: ['#1 NEW YORK TIMES BESTSELLER'] },
  { id: 'glass-cathedral', title: 'The Glass Cathedral', author: 'Amara Osei', layout: 'top-serif-light', noise: ['WINNER OF THE BOOKER PRIZE'] },
  { id: 'salt-and-ash', title: 'Salt and Ash', author: 'Peter Vance', layout: 'centre-caps-dark', byPrefix: true },
  { id: 'north-of-nowhere', title: 'North of Nowhere', author: 'Helena Brandt', layout: 'top-caps-light', noise: ['A NOVEL', 'VINTAGE'] },
  { id: 'quiet-machine', title: 'The Quiet Machine', author: 'Yuki Tanaka', layout: 'centre-serif-dark', noise: ['FROM THE AUTHOR OF IRON HARVEST'] },
  { id: 'last-cartographer', title: 'The Last Cartographer', author: 'Owen Mbeki', layout: 'bottom-serif-light', noise: ['A NOVEL'] },
  { id: 'burning-season', title: 'Burning Season', author: 'Clara Nowak', layout: 'top-caps-dark', noise: ['NATIONAL BESTSELLER', 'ANCHOR BOOKS'] },
  { id: 'thirteen-doors', title: 'Thirteen Doors', author: 'S. J. Ferreira', layout: 'centre-caps-light', byPrefix: true },
  { id: 'river-of-stone', title: 'The River of Stone', author: 'Nadia Ivanova', layout: 'bottom-caps-light', noise: ['A NOVEL'] },
  { id: 'paper-tigers', title: 'Paper Tigers', author: 'Miguel Santos', layout: 'top-serif-dark', noise: ['SOON TO BE A MAJOR MOTION PICTURE'] },
  { id: 'hollow-crownwork', title: 'The Hollow Crownwork', author: 'Eleanor Fitzgibbon', layout: 'centre-serif-light', noise: ['A NOVEL', 'FABER AND FABER'] },
  { id: 'midnight-signal', title: 'Midnight Signal', author: 'Ray Okonkwo', layout: 'bottom-caps-dark', noise: ['INTERNATIONAL BESTSELLER'] },
  { id: 'weight-of-water', title: 'The Weight of Water', author: 'Ingrid Solberg', layout: 'top-caps-light', byPrefix: true, noise: ['A NOVEL'] },
]

const PALETTES = {
  dark: [
    { bg: '#12141b', fg: '#f4efe6', accent: '#c9a227' },
    { bg: '#1d2b1f', fg: '#f2f0e6', accent: '#e0714a' },
    { bg: '#2a1512', fg: '#f6e9df', accent: '#d9b08c' },
  ],
  light: [
    { bg: '#f3ede2', fg: '#1a1a1a', accent: '#8c3b2e' },
    { bg: '#e8eef2', fg: '#16232b', accent: '#2f6f8f' },
    { bg: '#f7f2f7', fg: '#241a2b', accent: '#7a4a86' },
  ],
}

function render(cover, index) {
  const [position, face, tone] = cover.layout.split('-')
  const palette = PALETTES[tone][index % PALETTES[tone].length]
  const serif = face === 'serif'
  const caps = face === 'caps'
  const justify =
    position === 'top' ? 'flex-start' : position === 'centre' ? 'center' : 'flex-end'

  const noise = (cover.noise ?? [])
    .map((n) => `<div class="noise">${n}</div>`)
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1200px; height: 1800px; background: ${palette.bg}; color: ${palette.fg};
      display: flex; flex-direction: column; justify-content: ${justify};
      padding: 110px 90px; gap: 42px;
      font-family: ${serif ? "'Georgia', 'Times New Roman', serif" : "'Helvetica Neue', Arial, sans-serif"};
    }
    .title {
      font-size: ${cover.title.length > 16 ? 128 : 158}px;
      line-height: 1.02; font-weight: 700;
      ${caps ? 'text-transform: uppercase; letter-spacing: 0.02em;' : ''}
    }
    .author {
      font-size: 62px; font-weight: 400; letter-spacing: 0.05em;
      color: ${palette.accent};
      ${caps ? 'text-transform: uppercase;' : ''}
    }
    .noise { font-size: 34px; letter-spacing: 0.16em; opacity: 0.72; text-transform: uppercase; }
    .rule { height: 6px; width: 220px; background: ${palette.accent}; }
  </style></head><body>
    ${position === 'top' ? noise : ''}
    <div class="title">${cover.title}</div>
    <div class="rule"></div>
    <div class="author">${cover.byPrefix ? 'by ' : ''}${cover.author}</div>
    ${position === 'top' ? '' : noise}
  </body></html>`
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } })
  const manifest = []

  for (const [index, cover] of COVERS.entries()) {
    await page.setContent(render(cover, index), { waitUntil: 'load' })
    await page.screenshot({ path: join(outDir, `${cover.id}.png`), type: 'png' })
    manifest.push({
      id: cover.id,
      file: `${cover.id}.png`,
      title: cover.title,
      author: cover.author,
      layout: cover.layout,
    })
    console.log(`  rendered ${cover.id} (${cover.layout})`)
  }

  await browser.close()
  await writeFile(join(outDir, 'ground-truth.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\n${manifest.length} covers written to ${outDir}`)
}

main()
