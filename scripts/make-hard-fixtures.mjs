/**
 * Renders the *difficult* cover set — the cases a scanner actually meets, rather than
 * clean artwork.
 *
 *   node scripts/make-hard-fixtures.mjs   →  tests/fixtures/hard/
 *
 * Every entry names the specific weakness it probes, so a regression points at a cause
 * rather than a number. `expect` says what a correct scanner should do:
 *
 *   'book'        identify title and author
 *   'author'      the author is legible, the title is not — naming the author is success
 *   'uncertain'   nothing is legible; reporting low confidence is the correct outcome
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'hard')

/**
 * Real books, so the online lookup has something true to find, rendered as plausible
 * covers under adverse conditions.
 */
const CASES = [
  {
    id: 'clean-baseline',
    probe: 'a high-quality cover, the control for every other case',
    title: 'The Old Man and the Sea',
    author: 'Ernest Hemingway',
    expect: 'book',
    style: {},
  },
  {
    id: 'blurry',
    probe: 'camera shake — the single most common bad photo',
    title: 'Wuthering Heights',
    author: 'Emily Brontë',
    expect: 'book',
    style: { blur: 2.4 },
  },
  {
    id: 'very-blurry',
    probe: 'badly out of focus — the lookup recovers it from a partial reading',
    title: 'Moby Dick',
    author: 'Herman Melville',
    expect: 'book',
    style: { blur: 6 },
  },
  {
    id: 'angled',
    probe: 'photographed from the side, so the cover is a trapezoid',
    title: 'Crime and Punishment',
    author: 'Fyodor Dostoevsky',
    expect: 'book',
    style: { rotateY: 28 },
  },
  {
    id: 'steep-angle',
    // At this angle the title is genuinely unrecoverable; naming the author is the most
    // an honest scanner can do, and it must not guess a book from the author alone.
    probe: 'a severe perspective — only the author survives',
    title: 'Anna Karenina',
    author: 'Leo Tolstoy',
    expect: 'author',
    style: { rotateY: 42, rotateZ: 6 },
  },
  {
    id: 'tilted',
    probe: 'held crooked — rotation without perspective',
    title: 'Jane Eyre',
    author: 'Charlotte Brontë',
    expect: 'book',
    style: { rotateZ: 12 },
  },
  {
    id: 'dim-light',
    probe: 'photographed indoors at night',
    title: 'Great Expectations',
    author: 'Charles Dickens',
    expect: 'book',
    style: { brightness: 0.42 },
  },
  {
    id: 'harsh-glare',
    probe: 'a bright reflection across the cover, as glossy jackets give',
    title: 'The Picture of Dorian Gray',
    author: 'Oscar Wilde',
    expect: 'book',
    style: { glare: true },
  },
  {
    id: 'low-resolution',
    probe: 'a distant photo — few pixels per letter',
    title: 'Treasure Island',
    author: 'Robert Louis Stevenson',
    expect: 'book',
    style: { scale: 0.28 },
  },
  {
    id: 'title-only',
    probe: 'the author is not printed on the front at all',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    expect: 'book',
    style: {},
    hideAuthor: true,
  },
  {
    id: 'author-prominent',
    probe: 'the author is set larger than the title, as on a famous name’s books',
    title: 'The Shining',
    author: 'Stephen King',
    expect: 'book',
    style: {},
    authorBigger: true,
  },
  {
    id: 'title-illegible',
    probe: 'a decorative title and a clean author — naming the author is the win',
    title: 'Slaughterhouse-Five',
    author: 'Kurt Vonnegut',
    expect: 'author',
    style: { titleBlur: 7 },
  },
  {
    id: 'similar-title-a',
    probe: 'must not be confused with the other book of almost the same name',
    title: 'The Sound and the Fury',
    author: 'William Faulkner',
    expect: 'book',
    style: {},
  },
  {
    id: 'similar-title-b',
    probe: 'the near-twin of the previous cover',
    title: 'The Sound of Things Falling',
    author: 'Juan Gabriel Vásquez',
    expect: 'book',
    style: {},
  },
  {
    id: 'macedonian',
    probe: 'Cyrillic title and author',
    title: 'Тврдина',
    author: 'Славко Јаневски',
    expect: 'book',
    style: {},
    lang: 'mkd',
  },
  {
    id: 'macedonian-latin-author',
    probe: 'a Cyrillic title over a Latin author name',
    title: 'Пиреј',
    author: 'Petre M. Andreevski',
    expect: 'author',
    style: {},
    lang: 'mkd',
  },
  {
    id: 'noisy-blurbs',
    probe: 'a cover buried in review quotes and prize flashes',
    title: 'Never Let Me Go',
    author: 'Kazuo Ishiguro',
    expect: 'book',
    style: {},
    noise: [
      '“A masterpiece” — The Guardian',
      '#1 NEW YORK TIMES BESTSELLER',
      'WINNER OF THE NOBEL PRIZE',
      'A NOVEL',
    ],
  },
  {
    id: 'unreadable',
    probe: 'no legible text — the scanner must say so instead of inventing a book',
    title: '',
    author: '',
    expect: 'uncertain',
    style: { blur: 9, brightness: 0.3 },
    scribble: true,
  },
]

function render(c) {
  const s = c.style ?? {}
  const titleSize = c.authorBigger ? 86 : c.title.length > 18 ? 104 : 132
  const authorSize = c.authorBigger ? 132 : 58
  const filters = [
    s.blur ? `blur(${s.blur}px)` : '',
    s.brightness ? `brightness(${s.brightness})` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const transform = [
    s.rotateY ? `perspective(1400px) rotateY(${s.rotateY}deg)` : '',
    s.rotateZ ? `rotate(${s.rotateZ}deg)` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const noise = (c.noise ?? []).map((n) => `<div class="noise">${n}</div>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1200px; height: 1800px; background: #15161c; display: grid; place-items: center;
           overflow: hidden; }
    .stage { width: 1200px; height: 1800px; ${transform ? `transform: ${transform};` : ''} }
    .cover {
      width: 100%; height: 100%; background: #f1ece1; color: #17181d;
      display: flex; flex-direction: column; justify-content: center; gap: 46px;
      padding: 120px 90px; position: relative;
      font-family: 'Georgia', 'Times New Roman', serif;
      ${filters ? `filter: ${filters};` : ''}
    }
    .title { font-size: ${titleSize}px; line-height: 1.05; font-weight: 700;
             ${s.titleBlur ? `filter: blur(${s.titleBlur}px);` : ''} }
    .author { font-size: ${authorSize}px; color: #7d2b1e; letter-spacing: 0.04em;
              ${c.authorBigger ? 'font-weight: 700;' : ''} }
    .noise { font-size: 30px; letter-spacing: 0.1em; opacity: 0.75; text-transform: uppercase; }
    .glare { position: absolute; inset: 0;
             background: linear-gradient(118deg, rgba(255,255,255,0) 30%,
                         rgba(255,255,255,0.88) 44%, rgba(255,255,255,0) 54%); }
    .scribble { position: absolute; inset: 0;
                background: repeating-linear-gradient(41deg, #3a3a44 0 22px, #6d6152 22px 44px); }
  </style></head><body>
    <div class="stage"><div class="cover">
      ${noise}
      ${c.scribble ? '<div class="scribble"></div>' : ''}
      ${c.title ? `<div class="title">${c.title}</div>` : ''}
      ${c.author && !c.hideAuthor ? `<div class="author">${c.author}</div>` : ''}
      ${s.glare ? '<div class="glare"></div>' : ''}
    </div></div>
  </body></html>`
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch()
  const manifest = []

  for (const c of CASES) {
    const scale = c.style?.scale ?? 1
    const page = await browser.newPage({
      viewport: { width: 1200, height: 1800 },
      deviceScaleFactor: scale,
    })
    await page.setContent(render(c), { waitUntil: 'load' })
    await page.screenshot({ path: join(outDir, `${c.id}.png`), type: 'png' })
    await page.close()
    manifest.push({
      id: c.id,
      file: `${c.id}.png`,
      title: c.title,
      author: c.author,
      expect: c.expect,
      probe: c.probe,
      lang: c.lang ?? 'eng',
    })
    console.log(`  ${c.id.padEnd(24)} ${c.probe}`)
  }

  await browser.close()
  await writeFile(join(outDir, 'ground-truth.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\n${manifest.length} difficult covers written to ${outDir}`)
}

main()
