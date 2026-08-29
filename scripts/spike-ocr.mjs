/**
 * Phase-1 spike: prove tesseract.js can read a real book cover using ONLY the assets
 * vendored into public/tesseract/ — no CDN, no network. This is the single biggest
 * technical risk in the project, so it is settled before any UI is written.
 *
 *   node scripts/spike-ocr.mjs [cover.jpg ...]
 */
import { readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorker, PSM } from 'tesseract.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendored = join(root, 'public', 'tesseract')
const fixtures = join(root, 'tests', 'fixtures', 'benchmark')

const options = {
  corePath: join(vendored, 'core'),
  langPath: join(vendored, 'lang'),
  gzip: true,
  cacheMethod: 'none',
}

const files = process.argv.slice(2)
if (files.length === 0) {
  const all = (await readdir(fixtures)).filter((f) => f.endsWith('.jpg'))
  files.push(join(fixtures, all[0]))
}

const worker = await createWorker('eng', 1, options)
await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })

for (const file of files) {
  const started = Date.now()
  const { data } = await worker.recognize(file, {}, { blocks: true, text: true })
  const elapsed = Date.now() - started

  const lines = (data.blocks ?? [])
    .flatMap((b) => b.paragraphs ?? [])
    .flatMap((p) => p.lines ?? [])
    .map((l) => ({
      text: l.text.replace(/\s+/g, ' ').trim(),
      confidence: Math.round(l.confidence),
      height: l.bbox.y1 - l.bbox.y0,
      top: l.bbox.y0,
    }))
    .filter((l) => l.text.length > 0)

  console.log(`\n=== ${basename(file)} — ${elapsed} ms, ${lines.length} lines ===`)
  for (const l of lines.sort((a, b) => b.height - a.height)) {
    console.log(`  h=${String(l.height).padStart(3)} y=${String(l.top).padStart(4)} c=${String(l.confidence).padStart(3)}  ${l.text}`)
  }
}

await worker.terminate()
