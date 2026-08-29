/**
 * "Set up offline scanning" — the step that makes the offline promise real.
 *
 * The app shell is precached by the service worker at install. The OCR assets are not:
 * they are large and device-specific, so they are pulled into the Cache API on demand
 * here, and the CacheFirst route in vite.config.ts serves them forever afterwards.
 */
import { BASE_URL, TesseractPool, type LanguageCode } from '../pipeline/ocr'

export const OCR_CACHE = 'ocr-assets'

export interface OcrManifest {
  worker: string[]
  core: string[]
  lang: { code: string; url: string; bytes: number }[]
  totalBytes: number
}

/** Manifest paths are stored relative, so they survive being served from a subpath. */
export function assetUrl(path: string): string {
  return `${BASE_URL}${path}`
}

export async function loadManifest(): Promise<OcrManifest> {
  const res = await fetch(assetUrl('tesseract/manifest.json'))
  if (!res.ok) throw new Error('The OCR asset list is missing from this build')
  return (await res.json()) as OcrManifest
}

/** The assets that can be fetched directly, and a size estimate for the whole download. */
export function plan(manifest: OcrManifest, languages: string[]): { urls: string[]; bytes: number } {
  const langs = manifest.lang.filter((l) => languages.includes(l.code))
  return {
    urls: [...manifest.worker, ...langs.map((l) => l.url)].map(assetUrl),
    // Six WASM cores are vendored but only one is ever loaded, and which one is decided
    // by the browser — so the estimate adds a flat ~4 MB for it.
    bytes: langs.reduce((sum, l) => sum + l.bytes, 0) + 4_000_000,
  }
}

export interface DownloadProgress {
  done: number
  total: number
  label: string
}

async function cacheUrl(url: string, cache: Cache | undefined): Promise<void> {
  if (cache && (await cache.match(url))) return
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download ${url} (${res.status})`)
  // With no service worker (dev, or an unsupported browser) the response is stored
  // directly, so the same code path works everywhere.
  await cache?.put(url, res.clone())
  await res.arrayBuffer()
}

/**
 * Downloads everything needed to scan offline, then **starts the OCR engine once**.
 *
 * That last step is the important one. Six WASM cores are vendored — plain, SIMD and
 * relaxed-SIMD, each in an LSTM build — and which one tesseract.js asks for is decided
 * by the browser's own feature detection. Guessing it here was wrong on Chromium (it
 * takes the relaxed-SIMD build), which cached a core that was never requested and left
 * offline scanning broken in exactly the situation this feature exists for. Booting a
 * real worker makes the browser fetch the file it will actually use, through the service
 * worker, so the right core is cached by definition — and proves the engine runs before
 * the app claims it is ready.
 */
export async function downloadOfflineAssets(
  languages: string[],
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const manifest = await loadManifest()
  const { urls } = plan(manifest, languages)
  const cache = 'caches' in globalThis ? await caches.open(OCR_CACHE) : undefined
  const total = urls.length + 1

  let done = 0
  for (const url of urls) {
    await cacheUrl(url, cache)
    done++
    onProgress?.({ done, total, label: url.split('/').pop() ?? url })
  }

  onProgress?.({ done, total, label: 'starting the text recogniser' })
  const pool = await TesseractPool.create(languages as LanguageCode[], 1)
  await pool.terminate()
  onProgress?.({ done: total, total, label: 'ready' })
}

/**
 * True when everything needed to scan the given languages offline is cached: the worker,
 * every chosen language, and a WASM core — whichever one this browser settled on.
 */
export async function isOfflineReady(languages: string[]): Promise<boolean> {
  if (!('caches' in globalThis)) return false
  try {
    const manifest = await loadManifest()
    const cache = await caches.open(OCR_CACHE)
    const { urls } = plan(manifest, languages)
    for (const url of urls) {
      if (!(await cache.match(url))) return false
    }
    for (const core of manifest.core) {
      if (await cache.match(assetUrl(core))) return true
    }
    return false
  } catch {
    return false
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
