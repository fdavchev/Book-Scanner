/**
 * Measures title/author accuracy over the real cover set, running the *actual* browser
 * pipeline (preprocess → OCR → candidates) inside headless Chromium via bench.html.
 *
 *   npm run fetch-benchmark   # once, downloads the covers
 *   npm run benchmark         # writes docs/accuracy.md
 *
 * Options:  --degraded   apply photographic degradation (rotation, blur, darkening, q40)
 *           --limit=N    only the first N covers
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const degraded = args.includes('--degraded')
// Which fixture set: the rendered covers (default, phone-photo resolution) or the real
// low-resolution Open Library artwork.
const set = args.includes('--real')
    ? 'benchmark'
    : args.includes('--hard')
      ? 'hard'
      : args.includes('--mk')
        ? 'mk'
        : 'covers'
// With the lookup on, the catalogue is used to corroborate what OCR read. Off, the result
// is whatever the device could work out on its own.
const lookup = args.includes('--lookup')
const fixtures = join(root, 'tests', 'fixtures', set)
const limitArg = args.find((a) => a.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity

// ---------------------------------------------------------------- scoring helpers

function normalise(input) {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function editDistance(a, b) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

function similarity(a, b) {
  const na = normalise(a)
  const nb = normalise(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  return 1 - editDistance(na, nb) / Math.max(na.length, nb.length)
}

/** An author is "hit" if the surname matches — OCR routinely drops or mangles initials. */
function authorHit(expected, got) {
  if (similarity(expected, got) >= 0.7) return true
  const surname = normalise(expected).split(' ').pop()
  return surname.length > 2 && normalise(got).split(' ').includes(surname)
}

// ---------------------------------------------------------------- dev server

async function alreadyServing() {
  try {
    const res = await fetch('http://localhost:5199/bench.html', { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

function startVite() {
  return new Promise((resolvePort, reject) => {
    const proc = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'dev', '--', '--port', '5199', '--strictPort'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    )
    let settled = false
    const onData = (chunk) => {
      const text = chunk.toString()
      if (!settled && /localhost:5199/.test(text)) {
        settled = true
        resolvePort(proc)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', (code) => {
      if (!settled) reject(new Error(`vite exited with code ${code}`))
    })
    setTimeout(() => {
      if (!settled) {
        settled = true
        resolvePort(proc)
      }
    }, 20000)
  })
}

// ---------------------------------------------------------------- main

async function main() {
  if (!existsSync(join(fixtures, 'ground-truth.json'))) {
    console.error('No benchmark set. Run `npm run fetch-benchmark` first.')
    process.exit(1)
  }
  const truth = JSON.parse(await readFile(join(fixtures, 'ground-truth.json'), 'utf8')).slice(
    0,
    limit,
  )
  const available = new Set(await readdir(fixtures))

  const vite = (await alreadyServing()) ? null : await startVite()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('  [page]', msg.text())
  })

  const rows = []
  try {
    await page.goto('http://localhost:5199/bench.html', { waitUntil: 'load' })
    await page.waitForFunction(() => window.benchReady === true, { timeout: 60000 })
    // The OCR model has to match the book. The `lang` field in each fixture set's ground
    // truth was written but never read, so the Cyrillic fixtures were being run through the
    // English model and every Macedonian number was meaningless.
    const langs = [...new Set(truth.map((t) => t.lang ?? 'eng'))]
    await page.evaluate(([l]) => window.bench.init(l), [langs])

    for (const book of truth) {
      if (!available.has(book.file)) continue
      const base64 = (await readFile(join(fixtures, book.file))).toString('base64')
      const options = { lookup, ...(degraded ? { degrade: {} } : {}) }
      const got = await page.evaluate(
        ([b64, opts]) => window.bench.run(b64, opts),
        [base64, options],
      )

      const titleSim = similarity(book.title, got.title)
      const row = {
        id: book.id,
        expectedTitle: book.title,
        expectedAuthor: book.author,
        gotTitle: got.title,
        gotAuthor: got.author,
        titleExact: normalise(book.title) === normalise(got.title),
        titleFuzzy: titleSim >= 0.7,
        titleSimilarity: Number(titleSim.toFixed(2)),
        authorHit: authorHit(book.author, got.author),
        confidence: got.confidence,
        meanConfidence: got.meanConfidence,
        ms: got.ms,
        lineCount: got.lineCount,
        thumbnailBytes: got.thumbnailBytes,
      }
      rows.push(row)
      const mark = row.titleFuzzy ? (row.titleExact ? 'EXACT' : 'fuzzy') : 'MISS '
      console.log(
        `  ${mark} ${book.id.padEnd(36)} "${got.title}" / "${got.author}" (${got.ms} ms)`,
      )
    }
    await page.evaluate(() => window.bench.dispose())
  } finally {
    await browser.close()
    vite?.kill()
  }

  const n = rows.length || 1
  const pct = (count) => `${Math.round((count / n) * 100)}%`
  const summary = {
    covers: rows.length,
    degraded,
    titleExact: rows.filter((r) => r.titleExact).length,
    titleFuzzy: rows.filter((r) => r.titleFuzzy).length,
    authorHit: rows.filter((r) => r.authorHit).length,
    medianMs: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0,
    medianThumbKb: Math.round(
      (rows.map((r) => r.thumbnailBytes).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0) /
        1024,
    ),
  }

  const lines = [
    '# OCR accuracy benchmark',
    '',
    `Generated ${new Date().toISOString()} by \`npm run benchmark --${set === 'benchmark' ? ' --real' : set === 'hard' ? ' --hard' : ''}${lookup ? ' --lookup' : ''}${degraded ? ' --degraded' : ''}\`.`,
    '',
    set === 'benchmark'
      ? `Run against **${summary.covers} real book covers** downloaded from Open Library (\`npm run fetch-benchmark\`) — 300×500 artwork thumbnails.`
      : set === 'hard'
        ? `Run against **${summary.covers} deliberately difficult covers** (\`node scripts/make-hard-fixtures.mjs\`): blur, angles, glare, dim light, title-only, author-prominent, similar titles and Cyrillic.`
        : `Run against **${summary.covers} rendered covers** at 1200×1800 (\`node scripts/make-fixtures.mjs\`), the resolution a phone photo of a physical book actually has.`,
    'Run through the real browser pipeline in headless Chromium.',
    lookup
      ? '**Open Library lookup on** — OCR evidence corroborated against the catalogue.'
      : '**Offline only** — no network; these are the on-device numbers.',
    'preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these',
    'are the OCR-only numbers.',
    '',
    degraded
      ? '**Degraded set:** each cover was rotated 3°, blurred, darkened to 85% and re-encoded at JPEG q40 before scanning, to approximate a hand-held phone photo.'
      : '**Clean set:** covers as published, no degradation applied.',
    '',
    '| Metric | Result |',
    '|---|---|',
    `| Title exact match | ${summary.titleExact}/${summary.covers} (${pct(summary.titleExact)}) |`,
    `| Title fuzzy match (≥0.7) | ${summary.titleFuzzy}/${summary.covers} (${pct(summary.titleFuzzy)}) |`,
    `| Author found | ${summary.authorHit}/${summary.covers} (${pct(summary.authorHit)}) |`,
    `| Median time per cover | ${summary.medianMs} ms |`,
    `| Median cover thumbnail | ${summary.medianThumbKb} KB |`,
    '',
    '## Per-cover results',
    '',
    '| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |',
    '|---|---|---|---|:--:|:--:|--:|--:|',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.expectedTitle} / ${r.expectedAuthor} | ${r.gotTitle || '—'} | ${r.gotAuthor || '—'} | ` +
        `${r.titleExact ? 'exact' : r.titleFuzzy ? `~${r.titleSimilarity}` : 'miss'} | ${r.authorHit ? 'yes' : 'no'} | ${r.confidence} | ${r.ms} |`,
    ),
    '',
  ]

  const suffix = `${set}${lookup ? '-online' : '-offline'}${degraded ? '-degraded' : ''}`
  const outFile = join(root, 'docs', `accuracy-${suffix}.md`)
  await writeFile(outFile, lines.join('\n'))
  await writeFile(
    join(root, 'docs', `accuracy-${suffix}.json`),
    JSON.stringify({ summary, rows }, null, 2) + '\n',
  )
  console.log(
    `\ntitle exact ${summary.titleExact}/${summary.covers} · fuzzy ${summary.titleFuzzy}/${summary.covers} · author ${summary.authorHit}/${summary.covers}`,
  )
  console.log(`written: ${outFile}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
