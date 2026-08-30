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

/** One (variant × page-segmentation mode) reading of the image. */
export interface OcrPass {
  variant: 'raw' | 'small' | 'smallGray' | 'grayscale' | 'binarised' | 'flattened'
  psm: string
  /** The pixel size of the image this pass read — passes are not all the same scale. */
  width: number
  height: number
  lines: OcrLine[]
  meanConfidence: number
  ms: number
}

/**
 * Everything OCR managed to read, pooled across passes.
 *
 * The pipeline works on this rather than on a single reading. One pass never sees a whole
 * cover: measured on the benchmark set, the title of *The Great Gatsby* is legible only in
 * the grayscale sparse-text pass and *To Kill a Mockingbird* only in the single-block pass.
 * Pooling the passes is what makes the later stages able to find them.
 */
export interface OcrEvidence extends OcrResult {
  passes: OcrPass[]
  /** Every distinct line any pass read, best-confidence copy kept. */
  lines: OcrLine[]
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

/**
 * A complete interpretation of one cover: which line is the title, which is the author.
 *
 * The detector emits several of these rather than committing to one, because the
 * strongest local reading is regularly wrong — on *The Handmaid's Tale* the author is set
 * larger than the title, so scoring by glyph height alone swaps the two. Keeping the
 * runner-up interpretations lets the identification stage pick the one the catalogue
 * actually corroborates.
 */
export interface Hypothesis {
  title: string
  author: string
  /** 0–1, how well this interpretation is supported by the OCR evidence alone. */
  score: number
  reason: string
  /** OCR's confidence in the line used as the author, 0–100. */
  authorConfidence?: number
}
