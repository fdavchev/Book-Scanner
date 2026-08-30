/**
 * The OCR stage: a small pool of tesseract.js workers, all of them pointed at the
 * assets vendored into `public/tesseract/` so nothing is ever fetched from a CDN.
 *
 * The rest of the pipeline only sees `OcrResult`, so tesseract's own shapes stop here.
 */
import { createWorker, PSM, type Worker } from 'tesseract.js'
import type { BBox, OcrEvidence, OcrLine, OcrPass, OcrResult, OcrWord } from './types'
import { letterCount, wordiness } from './text'

/** Where the app is served from — '/' normally, '/repo-name/' on GitHub Pages. */
export const BASE_URL = import.meta.env.BASE_URL

export const OCR_PATHS = {
  workerPath: `${BASE_URL}tesseract/worker.min.js`,
  corePath: `${BASE_URL}tesseract/core`,
  langPath: `${BASE_URL}tesseract/lang`,
} as const

export type LanguageCode = 'eng' | 'mkd'

/** 2 on a phone (memory), up to 4 on a laptop. */
export function poolSize(): number {
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2
  const mobile =
    typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  return mobile ? Math.min(2, cores) : Math.max(1, Math.min(cores, 4))
}

async function imageDataToBlob(image: ImageData): Promise<Blob> {
  // PNG, not JPEG: the binarised image is pure black and white, and JPEG ringing around
  // the glyph edges measurably costs accuracy.
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas is not available')
    ctx.putImageData(image, 0, 0)
    return canvas.convertToBlob({ type: 'image/png' })
  }
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is not available')
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      'image/png',
    )
  })
}

/** Flattens tesseract's block/paragraph/line tree into the pipeline's flat line list. */
export function toOcrResult(
  data: { text?: string; blocks?: unknown },
  width: number,
  height: number,
): OcrResult {
  interface RawWord {
    text: string
    confidence: number
    bbox: { x0: number; y0: number; x1: number; y1: number }
  }
  interface RawLine extends RawWord {
    words?: RawWord[]
  }
  interface RawParagraph {
    lines?: RawLine[]
  }
  interface RawBlock {
    paragraphs?: RawParagraph[]
  }

  const blocks = (data.blocks ?? []) as RawBlock[]
  const lines: OcrLine[] = []
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const words: OcrWord[] = (line.words ?? [])
          .filter((w) => w.text.trim().length > 0)
          .map((w) => ({ text: w.text, confidence: w.confidence, bbox: { ...w.bbox } }))
        const text = line.text.replace(/\s+/g, ' ').trim()
        if (text.length === 0) continue
        lines.push({ text, confidence: line.confidence, bbox: { ...line.bbox }, words })
      }
    }
  }

  const allWords = lines.flatMap((l) => l.words)
  const meanConfidence =
    allWords.length === 0
      ? 0
      : allWords.reduce((sum, w) => sum + w.confidence, 0) / allWords.length

  return {
    lines,
    text: data.text ?? lines.map((l) => l.text).join('\n'),
    width,
    height,
    meanConfidence,
  }
}

export interface OcrEngine {
  recognise(image: ImageData, mode?: PSM, dpi?: number): Promise<OcrResult>
  terminate(): Promise<void>
}

/**
 * Told to tesseract for every image.
 *
 * Without this, tesseract estimates the resolution from the image itself and, on cover
 * art, routinely guesses 150–200 DPI. Its LSTM engine is trained on ~300 DPI scans, and
 * a low estimate makes it discard text as too small to be text at all — several covers
 * in the benchmark returned zero lines purely because of this.
 */
export const ASSUMED_DPI = 300

/**
 * A fixed pool of workers handed out round-robin. Creating a worker means loading a
 * multi-megabyte WASM core and a language model, so they are created once and reused
 * for the whole batch.
 */
export class TesseractPool implements OcrEngine {
  private workers: Worker[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private next = 0

  private constructor(workers: Worker[]) {
    this.workers = workers
  }

  static async create(
    languages: LanguageCode[] = ['eng'],
    size = poolSize(),
    onProgress?: (fraction: number) => void,
    paths: Partial<typeof OCR_PATHS> = {},
  ): Promise<TesseractPool> {
    const langs = languages.length > 0 ? languages.join('+') : 'eng'
    const workers: Worker[] = []
    for (let i = 0; i < size; i++) {
      workers.push(
        await createWorker(langs, 1, {
          ...OCR_PATHS,
          ...paths,
          gzip: true,
          // tesseract.js calls this unconditionally, so it must always be a function.
          logger: (m: { status: string; progress: number }) => {
            if (
              onProgress &&
              (m.status === 'loading language traineddata' || m.status === 'initializing api')
            ) {
              onProgress((i + m.progress) / size)
            }
          },
        }),
      )
    }
    return new TesseractPool(workers)
  }

  /** Serialised per worker: tesseract workers are single-job, and overlapping calls on
   *  one worker corrupt its result. Jobs are chained through a promise queue instead. */
  async recognise(
    image: ImageData,
    mode: PSM = PSM.AUTO,
    dpi: number = ASSUMED_DPI,
  ): Promise<OcrResult> {
    const worker = this.workers[this.next % this.workers.length]
    this.next++
    const run = this.queue.then(async () => {
      await worker.setParameters({
        // SetVariable takes strings; a raw number is silently ignored by the worker.
        tessedit_pageseg_mode: String(mode) as PSM,
        user_defined_dpi: String(dpi),
      })
      const blob = await imageDataToBlob(image)
      // `rotateAuto` lets tesseract find the text baseline and straighten the image
      // before reading it. A book photographed at even 12° off square came back as
      // "Eyre" / "Jane"; deskewing first costs a few milliseconds and recovers the line.
      const { data } = await worker.recognize(blob, { rotateAuto: true }, {
        blocks: true,
        text: true,
      })
      return toOcrResult(data, image.width, image.height)
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()))
    this.workers = []
  }
}


// ------------------------------------------------------------------ multi-pass reading

/** One (image variant × page-segmentation mode) reading to attempt. */
export interface PassSpec {
  variant: 'raw' | 'grayscale' | 'binarised' | 'flattened'
  psm: PSM
  /** Why this pass exists, for the diagnostics. */
  why: string
}

/**
 * The pass schedule, in the order they are attempted.
 *
 * Every entry earns its place on the benchmark set — each one is the *only* pass that
 * reads some cover correctly:
 *
 *   raw + AUTO          the general case, and the fastest; reads most covers on its own
 *   grayscale + SPARSE  scattered display type — the only pass that reads "The Great
 *                       Gatsby" and the only one that finds "RAY BRADBURY"
 *   raw + SINGLE_BLOCK  tightly-set stacked titles — the only pass that reads
 *                       "TO KILL A / Mockingbird"
 *   raw + SPARSE        word-per-line covers — the only pass that reads "Pride and
 *                       Prejudice" as three clean words
 *   binarised + AUTO    flat, low-contrast photographs of matte covers
 *   grayscale + BLOCK   the last resort; finds "VONNEGUT" where nothing else does
 *
 * Passes are expensive (~250 ms each), so the schedule is walked adaptively and stops as
 * soon as the evidence is good enough — see `readImage`.
 */
export const PASS_SCHEDULE: PassSpec[] = [
  { variant: 'raw', psm: PSM.AUTO, why: 'general' },
  { variant: 'grayscale', psm: PSM.SPARSE_TEXT, why: 'scattered display type' },
  { variant: 'flattened', psm: PSM.AUTO, why: 'glare or uneven lighting' },
  { variant: 'raw', psm: PSM.SINGLE_BLOCK, why: 'stacked title block' },
  { variant: 'raw', psm: PSM.SPARSE_TEXT, why: 'word-per-line covers' },
  { variant: 'binarised', psm: PSM.AUTO, why: 'low contrast' },
  { variant: 'grayscale', psm: PSM.SINGLE_BLOCK, why: 'last resort' },
]

/** A spine is read differently: sparse text, rotated type, very little of it. */
export const SPINE_SCHEDULE: PassSpec[] = [
  { variant: 'raw', psm: PSM.SPARSE_TEXT, why: 'spine' },
  { variant: 'grayscale', psm: PSM.SPARSE_TEXT, why: 'spine, low contrast' },
  { variant: 'binarised', psm: PSM.SINGLE_BLOCK, why: 'spine, last resort' },
]

function normaliseForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim()
}

/**
 * Pools the lines from several passes, keeping one copy of each distinct line.
 *
 * Two passes reading the same words is the normal case, so duplicates are collapsed by
 * normalised text and the highest-confidence copy is kept — its geometry is the one the
 * scorer will trust.
 */
export function mergeLines(passes: OcrPass[]): OcrLine[] {
  const best = new Map<string, OcrLine>()
  for (const pass of passes) {
    for (const line of pass.lines) {
      const key = normaliseForDedupe(line.text)
      if (key.length === 0) continue
      const existing = best.get(key)
      if (!existing || line.confidence > existing.confidence) best.set(key, line)
    }
  }

  // Different passes reading the *same* physical line rarely agree character for
  // character, so exact-text dedupe leaves several copies of it — "СНАБЛЕТНА." and
  // "СКАРЛЕТНА" are one title line read twice. They sit in the same place on the cover, so
  // the later grouping stage concatenated them into one nonsense candidate. Where two
  // readings occupy substantially the same box, only the more confident one survives.
  const kept: OcrLine[] = []
  for (const line of [...best.values()].sort((a, b) => b.confidence - a.confidence)) {
    const clash = kept.findIndex((other) => overlapFraction(line.bbox, other.bbox) > 0.6)
    if (clash === -1) {
      kept.push(line)
      continue
    }
    // Confidence alone picked the wrong survivor: a pass reading "Salt and" scored higher
    // than the pass that read the whole "Salt and Ash", and the title lost its last word.
    // When one reading simply contains the other, the fuller one is the better record of
    // what is printed there.
    const existing = kept[clash]
    if (containsReading(line.text, existing.text)) kept[clash] = line
  }
  return kept.sort((a, b) => a.bbox.y0 - b.bbox.y0)
}

/** True when `candidate` says everything `existing` says, and more. */
function containsReading(candidate: string, existing: string): boolean {
  const a = normaliseForDedupe(candidate)
  const b = normaliseForDedupe(existing)
  return a.length > b.length && a.includes(b)
}

/** How much of the smaller box the two boxes share, 0–1. */
function overlapFraction(a: BBox, b: BBox): number {
  const width = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (width <= 0 || height <= 0) return 0
  const areaA = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0))
  const areaB = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0))
  return (width * height) / Math.min(areaA, areaB)
}

export interface ReadOptions {
  /** Stop early once the evidence looks good enough. Default true. */
  adaptive?: boolean
  /** Hard ceiling on passes. Default: the whole schedule. */
  maxPasses?: number
  /** Passes to run before an early exit is allowed. Default: by image resolution. */
  minPasses?: number
  /** Called after each pass, for progress reporting. */
  onPass?: (done: number, total: number) => void
  signal?: AbortSignal
}

/**
 * True when the evidence already looks like a cleanly-read cover, so the remaining passes
 * would only cost time.
 *
 * The bar is deliberately high. A looser test — any two confident lines — stopped after
 * the first pass on covers whose title only the *third* pass could read, losing *The Great
 * Gatsby* and *Neuromancer* to a pair of confidently-read blurb lines. Two clean, wordy,
 * high-confidence lines is what a legible cover actually looks like; anything less is
 * worth spending another 250 ms on.
 */
export function evidenceIsStrong(lines: OcrLine[]): boolean {
  const solid = lines.filter(
    (l) => l.confidence >= 80 && letterCount(l.text) >= 4 && wordiness(l.text) >= 0.6,
  )
  if (solid.length < 2) return false
  const wordLike = solid.reduce(
    (sum, l) => sum + l.text.split(/\s+/).filter((w) => letterCount(w) >= 2).length,
    0,
  )
  // One of them has to be long enough to plausibly *be* a title. Glare across a cover
  // left two confident fragments — "The Pic" and "Oscar W" — which satisfied every other
  // condition and stopped the schedule before the pass that handles glare ever ran.
  const hasTitleLengthLine = solid.some((l) => letterCount(l.text) >= 8)
  return wordLike >= 3 && hasTitleLengthLine
}

/**
 * Reads one prepared image, pooling as many passes as it needs.
 *
 * The resized colour image goes first. That ordering is measured, not assumed: on the
 * benchmark set, pre-thresholding the image *lost* covers outright — "The Road" (white
 * type on black) returned zero lines binarised and 96% confidence untouched. Tesseract
 * does its own adaptive thresholding, and a global threshold applied first only throws
 * information away.
 */
export async function readImage(
  engine: OcrEngine,
  prepared: {
    raw: ImageData
    grayscale: ImageData
    binarised: ImageData
    flattened: ImageData
    width: number
    height: number
  },
  options: ReadOptions = {},
): Promise<OcrEvidence> {
  const { adaptive = true, onPass, signal } = options
  const isSpine = prepared.height / Math.max(1, prepared.width) > 2.2
  const schedule = (isSpine ? SPINE_SCHEDULE : PASS_SCHEDULE).slice(
    0,
    options.maxPasses ?? Infinity,
  )

  // A small image is a hard image: at 300x500 the title is barely 80px tall and one pass
  // is rarely enough, while a phone photo of a physical book is usually read correctly on
  // the first attempt. Resolution is the cheapest available predictor of difficulty, so it
  // sets how many passes must run before an early exit is even considered.
  const megapixels = (prepared.width * prepared.height) / 1e6
  const minPasses = options.minPasses ?? (megapixels < 1.2 ? 3 : 1)

  const passes: OcrPass[] = []
  for (const [index, spec] of schedule.entries()) {
    if (signal?.aborted) break
    const started = Date.now()
    const result = await engine.recognise(prepared[spec.variant], spec.psm)
    passes.push({
      variant: spec.variant,
      psm: String(spec.psm),
      lines: result.lines,
      meanConfidence: result.meanConfidence,
      ms: Date.now() - started,
    })
    onPass?.(index + 1, schedule.length)

    if (adaptive && passes.length >= minPasses && evidenceIsStrong(mergeLines(passes))) break
  }

  const lines = mergeLines(passes)
  const allWords = lines.flatMap((l) => l.words)
  return {
    passes,
    lines,
    text: lines.map((l) => l.text).join('\n'),
    width: prepared.width,
    height: prepared.height,
    meanConfidence:
      allWords.length === 0
        ? 0
        : allWords.reduce((sum, w) => sum + w.confidence, 0) / allWords.length,
  }
}
