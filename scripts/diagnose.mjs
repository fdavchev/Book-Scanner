/**
 * Per-stage diagnosis of the scanning pipeline, run through the real browser code.
 *
 *   node scripts/diagnose.mjs [--real] [--lookup] [--degraded] [--verbose]
 *
 * Prints, for every fixture: what OCR read, what the detector chose, what query went to
 * Open Library, what came back, and whether the final answer matches the ground truth.
 * Needs `npm run dev -- --port 5199` running.
 */
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const set = args.includes('--real')
    ? 'benchmark'
    : args.includes('--hard')
      ? 'hard'
      : args.includes('--mk')
        ? 'mk'
        : 'covers'
const lookup = args.includes('--lookup')
const degraded = args.includes('--degraded')
const verbose = args.includes('--verbose')

function norm(s) {
  return (s ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function dist(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]
}
function sim(a, b) {
  const [x, y] = [norm(a), norm(b)]
  if (!x || !y) return 0
  return 1 - dist(x, y) / Math.max(x.length, y.length)
}
function authorHit(exp, got) {
  if (sim(exp, got) >= 0.7) return true
  const sn = norm(exp).split(' ').pop()
  return sn.length > 2 && norm(got).split(' ').includes(sn)
}

const truth = JSON.parse(await readFile(`tests/fixtures/${set}/ground-truth.json`, 'utf8'))

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
await page.goto('http://localhost:5199/bench.html', { waitUntil: 'load' })
await page.waitForFunction(() => window.benchReady === true, { timeout: 60000 })
// The OCR model has to match the book. The `lang` field in each fixture set's ground
    // truth was written but never read, so the Cyrillic fixtures were being run through the
    // English model and every Macedonian number was meaningless.
    const langs = [...new Set(truth.map((t) => t.lang ?? 'eng'))]
    await page.evaluate(([l]) => window.bench.init(l), [langs])

let exact = 0
let fuzzy = 0
let author = 0
let wrong = 0
let correct = 0
let totalMs = 0
const failures = []

for (const t of truth) {
  const b64 = (await readFile(`tests/fixtures/${set}/${t.file}`)).toString('base64')
  const options = { lookup, ...(degraded ? { degrade: {} } : {}) }
  const r = await page.evaluate(([x, o]) => window.bench.run(x, o), [b64, options])
  totalMs += r.ms

  const titleSim = sim(t.title, r.title)
  const isExact = norm(t.title) === norm(r.title)
  const isFuzzy = titleSim >= 0.7
  const aHit = authorHit(t.author, r.author)
  if (isExact) exact++
  if (isFuzzy) fuzzy++
  if (aHit) author++
  // A confident answer that is simply a different book is the worst outcome.
  if (!isFuzzy && r.title && r.confidence >= 60) wrong++

  let mark = isExact ? 'EXACT' : isFuzzy ? 'fuzzy' : 'MISS '
  if (t.expect) {
    const lowConfidence = r.confidence < 55
    const ok =
      t.expect === 'book'
        ? isFuzzy && aHit
        : t.expect === 'author'
          ? aHit
          : lowConfidence && !isFuzzy
    if (ok) correct++
    mark = (ok ? 'PASS ' : 'FAIL ') + mark
  }
  console.log(
    `${mark} ${t.id.padEnd(36)} got "${r.title}" / "${r.author}"  conf=${r.confidence} ${r.ms}ms` +
      (r.lookup ? `  [lookup ${r.lookup.matched ? 'MATCHED' : 'no'}${r.lookup.error ? ' err=' + r.lookup.error.slice(0, 40) : ''}]` : ''),
  )
  if (!isFuzzy) {
    failures.push({ id: t.id, want: `${t.title} / ${t.author}`, got: `${r.title} / ${r.author}`, query: r.lookup?.query })
  }
  if (verbose && (!isFuzzy || mark.startsWith('FAIL'))) {
    console.log(`      want: "${t.title}" / "${t.author}"`)
    console.log(`      ocr : ${JSON.stringify(r.rawText).slice(0, 300)}`)
    if (r.lookup) {
      console.log(`      queries: ${JSON.stringify(r.lookup.query)}`)
      for (const c of r.lookup.ranked ?? []) {
        console.log(`        ${c.ok ? 'OK  ' : 'rej '} t=${c.t} a=${c.a}  "${c.title}" / "${c.author}"`)
      }
    }
  }
}

const n = truth.length
console.log(
  `\n== set=${set} lookup=${lookup} degraded=${degraded} ==\n` +
    `exact ${exact}/${n}  fuzzy ${fuzzy}/${n}  author ${author}/${n}  ` +
    `confidently-wrong ${wrong}/${n}  mean ${Math.round(totalMs / n)}ms` +
    (truth[0]?.expect ? `
expected-behaviour ${correct}/${n}` : ''),
)
if (failures.length && !verbose) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.id}: want "${f.want}" got "${f.got}"`)
}

await browser.close()
