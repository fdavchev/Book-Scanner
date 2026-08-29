/** Normalised OCR output. The pipeline works on these, never on tesseract's own shapes,
 *  so every stage below `ocr.ts` is pure and testable without WASM. */

export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  confidence: number
  bbox: BBox
}

export interface OcrLine {
  text: string
  /** 0–100, tesseract's mean word confidence for the line. */
  confidence: number
  bbox: BBox
  words: OcrWord[]
}

export interface OcrResult {
  lines: OcrLine[]
  /** Full raw text, kept on the book record for later re-matching. */
  text: string
  /** Pixel dimensions of the image the lines were measured in. */
  width: number
  height: number
  /** Mean word confidence across the page, 0–100. */
  meanConfidence: number
}

/** A title/author guess produced by `candidates.ts`. */
export interface Detection {
  title: string
  author: string
  /** 0–100. */
  confidence: number
  /** Plain-language explanation shown on the review card. */
  reason: string
  titleAlternates: string[]
  authorAlternates: string[]
  source: 'ocr' | 'openlibrary' | 'manual'
}
