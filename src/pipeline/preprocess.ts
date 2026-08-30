/**
 * Image preparation, in the browser, before OCR sees anything.
 *
 * A phone photo is 3000×4000 of noisy, unevenly lit JPEG. Tesseract wants a modest,
 * high-contrast, upright image. This module does that conversion and, in the same pass,
 * produces the 400px cover thumbnail that is the only part of the photo ever stored.
 */

/** Long edge fed to OCR. 1600 is the accuracy knee: bigger costs time for no gain, and
 *  a 20-image batch at this size still fits inside a phone browser's memory ceiling. */
export const OCR_LONG_EDGE = 1600

/** Long edge of the stored cover thumbnail. */
export const THUMB_LONG_EDGE = 400
export const THUMB_QUALITY = 0.72

export interface Prepared {
  /** The photo, EXIF-corrected and resized, otherwise untouched. */
  raw: ImageData
  /** Grayscale with uneven lighting divided out — for glare and shadow. */
  flattened: ImageData
  /** High-contrast binarised image — the first thing OCR is asked to read. */
  binarised: ImageData
  /** Contrast-stretched grayscale, used for the retry pass when binarisation loses a
   *  stylised cover to its own background. */
  grayscale: ImageData
  width: number
  height: number
  /** 400px JPEG, ~40 KB — stored on the book record. */
  thumbnail: Blob
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function context2d(canvas: AnyCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) throw new Error('2D canvas is not available in this browser')
  return ctx
}

async function canvasToBlob(canvas: AnyCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  return new Promise((resolve, reject) => {
    ;(canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      'image/jpeg',
      quality,
    )
  })
}

/** Default ceiling on enlargement of an image that is already smaller than the target. */
export const MAX_UPSCALE = 2

/** Scale factor that puts the long edge at `target`, never enlarging past `maxUpscale`. */
export function scaleFor(
  width: number,
  height: number,
  target: number,
  maxUpscale = MAX_UPSCALE,
): number {
  const longEdge = Math.max(width, height)
  if (longEdge === 0) return 1
  return Math.min(target / longEdge, maxUpscale)
}

/** In-place grayscale + linear contrast stretch between the 2nd and 98th percentiles. */
export function toGrayscale(image: ImageData): ImageData {
  const data = image.data
  const histogram = new Uint32Array(256)
  const luma = new Uint8ClampedArray(image.width * image.height)

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
    luma[p] = value
    histogram[luma[p]]++
  }

  // Percentile clipping beats min/max: one specular highlight should not define white.
  // The clip is deliberately gentle — an aggressive 2%/98% stretch was measured to
  // destroy high-contrast covers (white type on black) rather than help them.
  const total = luma.length
  const lowCut = total * 0.005
  const highCut = total * 0.995
  let seen = 0
  let low = 0
  let high = 255
  for (let v = 0; v < 256; v++) {
    seen += histogram[v]
    if (seen >= lowCut) {
      low = v
      break
    }
  }
  seen = 0
  for (let v = 0; v < 256; v++) {
    seen += histogram[v]
    if (seen >= highCut) {
      high = v
      break
    }
  }
  // An image that already uses most of the range is left alone; stretching it further
  // only amplifies JPEG noise.
  if (high - low > 200) {
    low = 0
    high = 255
  }
  const span = Math.max(1, high - low)

  const out = new ImageData(image.width, image.height)
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    const stretched = Math.max(0, Math.min(255, ((luma[p] - low) * 255) / span))
    out.data[i] = stretched
    out.data[i + 1] = stretched
    out.data[i + 2] = stretched
    out.data[i + 3] = 255
  }
  return out
}

/**
 * Divides out uneven lighting.
 *
 * A glossy jacket photographed under a lamp has a bright band across it; a shelf photo has
 * a shadow down one side. Both defeat any single global threshold, and they defeat
 * tesseract too — a reflection across *The Picture of Dorian Gray* reduced it to "The
 * Pic". Estimating the local background brightness with a fast box blur and dividing each
 * pixel by it removes the gradient while leaving the letters, because letters are small
 * relative to the blur radius and the background is not.
 */
export function flattenIllumination(grayscale: ImageData, radius = 24): ImageData {
  const { width, height, data } = grayscale
  const luma = new Float32Array(width * height)
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) luma[p] = data[i]

  // Separable box blur over a summed-area row pass then column pass — O(pixels).
  const horizontal = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    let sum = 0
    const row = y * width
    for (let x = 0; x < Math.min(radius, width); x++) sum += luma[row + x]
    for (let x = 0; x < width; x++) {
      const add = x + radius
      const drop = x - radius - 1
      if (add < width) sum += luma[row + add]
      if (drop >= 0) sum -= luma[row + drop]
      const count = Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1
      horizontal[row + x] = sum / count
    }
  }
  const background = new Float32Array(width * height)
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = 0; y < Math.min(radius, height); y++) sum += horizontal[y * width + x]
    for (let y = 0; y < height; y++) {
      const add = y + radius
      const drop = y - radius - 1
      if (add < height) sum += horizontal[add * width + x]
      if (drop >= 0) sum -= horizontal[drop * width + x]
      const count = Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1
      background[y * width + x] = sum / count
    }
  }

  const out = new ImageData(width, height)
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    // 128 keeps mid-grey where the pixel equals its local background.
    const value = Math.max(0, Math.min(255, (luma[p] / Math.max(1, background[p])) * 160))
    out.data[i] = value
    out.data[i + 1] = value
    out.data[i + 2] = value
    out.data[i + 3] = 255
  }
  return out
}

/** Otsu's method: the threshold that maximises between-class variance. */
export function otsuThreshold(image: ImageData): number {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < image.data.length; i += 4) histogram[image.data[i]]++

  const total = image.data.length / 4
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * histogram[v]

  let sumBackground = 0
  let weightBackground = 0
  let best = 0
  let threshold = 127
  for (let v = 0; v < 256; v++) {
    weightBackground += histogram[v]
    if (weightBackground === 0) continue
    const weightForeground = total - weightBackground
    if (weightForeground === 0) break
    sumBackground += v * histogram[v]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2
    if (variance > best) {
      best = variance
      threshold = v
    }
  }
  return threshold
}

export function binarise(grayscale: ImageData, threshold = otsuThreshold(grayscale)): ImageData {
  const out = new ImageData(grayscale.width, grayscale.height)
  // Covers are as often light-on-dark as dark-on-light; tesseract wants dark text on
  // white, so the polarity is chosen from which side of the threshold is in the minority.
  let above = 0
  for (let i = 0; i < grayscale.data.length; i += 4) {
    if (grayscale.data[i] > threshold) above++
  }
  const invert = above < grayscale.data.length / 8

  for (let i = 0; i < grayscale.data.length; i += 4) {
    const isDark = grayscale.data[i] <= threshold
    const value = (invert ? !isDark : isDark) ? 0 : 255
    out.data[i] = value
    out.data[i + 1] = value
    out.data[i + 2] = value
    out.data[i + 3] = 255
  }
  return out
}

/**
 * Full preparation of one photo. EXIF rotation is applied by the decoder, the bitmap is
 * closed immediately after use so a batch never holds more than one decoded photo — the
 * behaviour iOS Safari's per-tab memory ceiling demands.
 */
export async function prepare(
  blob: Blob,
  longEdge = OCR_LONG_EDGE,
  maxUpscale = MAX_UPSCALE,
): Promise<Prepared> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    const scale = scaleFor(bitmap.width, bitmap.height, longEdge, maxUpscale)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = createCanvas(width, height)
    const ctx = context2d(canvas)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const raw = ctx.getImageData(0, 0, width, height)

    const grayscale = toGrayscale(raw)
    const binarised = binarise(grayscale)
    const flattened = flattenIllumination(grayscale)

    const thumbScale = scaleFor(bitmap.width, bitmap.height, THUMB_LONG_EDGE)
    const thumbCanvas = createCanvas(
      Math.max(1, Math.round(bitmap.width * thumbScale)),
      Math.max(1, Math.round(bitmap.height * thumbScale)),
    )
    const thumbCtx = context2d(thumbCanvas)
    thumbCtx.imageSmoothingEnabled = true
    thumbCtx.imageSmoothingQuality = 'high'
    thumbCtx.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height)
    const thumbnail = await canvasToBlob(thumbCanvas, THUMB_QUALITY)

    return { raw, binarised, grayscale, flattened, width, height, thumbnail }
  } finally {
    bitmap.close()
  }
}

/** Crops a blob to a normalised (0–1) rectangle — what "Crop & rescan" hands back. */
export async function cropBlob(
  blob: Blob,
  rect: { x: number; y: number; width: number; height: number },
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    const sx = Math.round(rect.x * bitmap.width)
    const sy = Math.round(rect.y * bitmap.height)
    const sw = Math.max(1, Math.round(rect.width * bitmap.width))
    const sh = Math.max(1, Math.round(rect.height * bitmap.height))
    const canvas = createCanvas(sw, sh)
    context2d(canvas).drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
    return canvasToBlob(canvas, 0.92)
  } finally {
    bitmap.close()
  }
}

// ------------------------------------------------------------------ image quality

export interface ImageQuality {
  /** Relative sharpness, 0–1. Below ~0.15 the text is usually unreadable. */
  sharpness: number
  /** Mean brightness, 0–1. */
  brightness: number
  /** How much of the tonal range the image uses, 0–1. */
  contrast: number
  megapixels: number
  /** Plain-language problems, worst first. Empty when the photo is fine. */
  warnings: string[]
}

/**
 * Judges a photo before OCR runs, so the app can tell the user what is wrong with it
 * rather than silently returning nothing.
 *
 * Sharpness is the variance of a Laplacian — the standard focus measure. A sharp edge
 * produces a large second derivative; a blurred one does not.
 */
export function assessQuality(grayscale: ImageData): ImageQuality {
  const { width, height, data } = grayscale
  const megapixels = (width * height) / 1e6

  let sum = 0
  let min = 255
  let max = 0
  let laplacianSum = 0
  let laplacianSquares = 0
  let samples = 0

  const at = (x: number, y: number) => data[(y * width + x) * 4]

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const value = at(x, y)
      sum += value
      if (value < min) min = value
      if (value > max) max = value
      const laplacian = 4 * value - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1)
      laplacianSum += laplacian
      laplacianSquares += laplacian * laplacian
      samples++
    }
  }

  if (samples === 0) {
    return { sharpness: 0, brightness: 0, contrast: 0, megapixels, warnings: ['The photo is empty'] }
  }

  const mean = laplacianSum / samples
  const variance = laplacianSquares / samples - mean * mean
  // Normalised against a value that clean cover type comfortably exceeds.
  const sharpness = Math.min(1, Math.sqrt(Math.max(0, variance)) / 45)
  const brightness = sum / samples / 255
  const contrast = (max - min) / 255

  const warnings: string[] = []
  if (sharpness < 0.15) warnings.push('The photo looks blurry — hold the phone steady and try again')
  if (brightness < 0.22) warnings.push('The photo is very dark — find more light')
  else if (brightness > 0.9) warnings.push('The photo is washed out — move the light off the cover')
  if (contrast < 0.35) warnings.push('The cover is low contrast — try a straighter angle to the light')
  if (megapixels < 0.25) warnings.push('The photo is small — move closer so the cover fills the frame')

  return { sharpness, brightness, contrast, megapixels, warnings }
}
