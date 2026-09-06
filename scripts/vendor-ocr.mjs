/**
 * Copies every asset tesseract.js needs at runtime out of node_modules and into
 * public/tesseract/, so the app never fetches anything from a CDN.
 *
 * Wired to `postinstall`. Safe to re-run; it overwrites.
 *
 * Paths in the generated manifest are relative (no leading slash) so the app works when
 * it is served from a subpath, which is what GitHub Pages does.
 *
 *   public/tesseract/worker.min.js          the worker entry point   -> workerPath
 *   public/tesseract/core/*.wasm.js|.wasm   the WASM core builds     -> corePath
 *   public/tesseract/lang/*.traineddata.gz  eng + mkd language data  -> langPath
 */
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const out = join(root, 'public', 'tesseract')
const overrideDir = join(root, 'custom-traineddata')

/** Recursively collect files under `dir` whose name passes `match`. */
async function findFiles(dir, match, found = []) {
  if (!existsSync(dir)) return found
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await findFiles(full, match, found)
    else if (match(entry.name)) found.push(full)
  }
  return found
}

async function copyInto(files, destDir) {
  await mkdir(destDir, { recursive: true })
  const copied = []
  for (const file of files) {
    const dest = join(destDir, basename(file))
    await copyFile(file, dest)
    copied.push({ name: basename(dest), bytes: (await stat(dest)).size })
  }
  return copied
}

function report(label, copied) {
  if (copied.length === 0) {
    console.warn(`  ! ${label}: nothing found — offline OCR will be incomplete`)
    return 0
  }
  const bytes = copied.reduce((sum, f) => sum + f.bytes, 0)
  console.log(`  ${label}: ${copied.length} file(s), ${(bytes / 1e6).toFixed(1)} MB`)
  return bytes
}

console.log('vendor-ocr: copying tesseract assets into public/tesseract/')

// 1 — the worker entry point
const workers = await findFiles(join(nm, 'tesseract.js', 'dist'), (n) => n === 'worker.min.js')
const worker = await copyInto(workers.slice(0, 1), out)

// 2 — the WASM cores. Only the `.wasm.js` builds are needed: tesseract.js-core ships
// SINGLE_FILE emscripten builds with the wasm embedded as base64, and worker.min.js
// only ever asks for `.wasm.js`. All six variants are vendored so that whichever one a
// given device picks (plain / simd / relaxedsimd, each × lstm-only) is present offline.
const cores = await findFiles(
  join(nm, 'tesseract.js-core'),
  (n) => /^tesseract-core.*\.wasm\.js$/.test(n),
)
const core = await copyInto(cores, join(out, 'core'))

// 3 — language data, English and Macedonian
const langs = []
for (const pkg of ['eng', 'mkd', 'osd']) {  // Prefer a hand-fine-tuned model checked into the repo, if present.
 

  // Fall back to the npm-vendored tessdata_best package, as before.
  const files = await findFiles(
    join(nm, '@tesseract.js-data', pkg),
    (n) => n === `${pkg}.traineddata.gz` || n === `${pkg}.traineddata`,
  )
  const pick =
    files.find((f) => /best/.test(f)) ?? files.find((f) => f.endsWith('.gz')) ?? files[0]
  if (pick) langs.push(pick)
}
const lang = await copyInto(langs, join(out, 'lang'))

const total = report('worker', worker) + report('core', core) + report('lang', lang)

// A manifest the app reads to know what it can precache and which languages exist offline.
await writeFile(
  join(out, 'manifest.json'),
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      worker: worker.map((f) => `tesseract/${f.name}`),
      core: core.map((f) => `tesseract/core/${f.name}`),
      lang: lang.map((f) => ({
        code: basename(f.name, '.traineddata.gz').replace(/\.traineddata$/, ''),
        url: `tesseract/lang/${f.name}`,
        bytes: f.bytes,
      })),
      totalBytes: total,
    },
    null,
    2,
  ) + '\n',
)

console.log(`vendor-ocr: done — ${(total / 1e6).toFixed(1)} MB in public/tesseract/`)
if (worker.length === 0 || core.length === 0 || lang.length === 0) {
  console.warn('vendor-ocr: WARNING — some assets are missing, offline OCR will not work')
}
