/**
 * The OCR stage: a small pool of tesseract.js workers, all of them pointed at the
 * assets vendored into `public/tesseract/` so nothing is ever fetched from a CDN.
 *
 * The rest of the pipeline only sees `OcrResult`, so tesseract's own shapes stop here.
 */
import { createWorker, PSM, type Worker } from 'tesseract.js'
import type { OcrLine, OcrResult, OcrWord } from './types'

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
      const { data } = await worker.recognize(blob, {}, { blocks: true, text: true })
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

/** Mean word confidence below this triggers the un-binarised retry pass. */
export const RETRY_CONFIDENCE = 65

/**
 * Reads one prepared image.
 *
 * The resized colour image goes first. That ordering is measured, not assumed: on the
 * benchmark set, pre-thresholding the image *lost* covers outright — "The Road" (white
 * type on black) returned zero lines binarised and 96% confidence untouched. Tesseract
 * does its own adaptive thresholding, and a global threshold applied first only throws
 * information away. The binarised pass is kept as a fallback, because it does help the
 * opposite case: a flat, low-contrast photo of a matte cover.
 *
 * Tall, narrow images are spines, and are read with the sparse-text mode instead.
 */
export async function readImage(
  engine: OcrEngine,
  prepared: { raw: ImageData; binarised: ImageData; width: number; height: number },
): Promise<OcrResult> {
  const isSpine = prepared.height / Math.max(1, prepared.width) > 2.2
  const mode = isSpine ? PSM.SPARSE_TEXT : PSM.AUTO

  const first = await engine.recognise(prepared.raw, mode)
  if (first.meanConfidence >= RETRY_CONFIDENCE && first.lines.length > 0) return first

  const second = await engine.recognise(prepared.binarised, mode)
  const score = (r: OcrResult) => (r.lines.length === 0 ? -1 : r.meanConfidence)
  return score(second) > score(first) ? second : first
}
