/**
 * One image is one book by default. Two photos of the same book — the front cover twice,
 * or a cover and a spine — collapse into a single review card showing "from 2 photos".
 */
import type { Detection } from './types'
import { similarity } from './text'

/** Above this combined title/author similarity, two detections are the same book. */
export const MERGE_THRESHOLD = 0.85

export interface ScannedImage {
  id: string
  /** The original photo, kept in memory only for the length of the review step. */
  blob: Blob
  detection: Detection
  cover?: Blob
  ocrText: string
}

export interface ReviewItem {
  id: string
  title: string
  author: string
  confidence: number
  reason: string
  titleAlternates: string[]
  authorAlternates: string[]
  source: Detection['source']
  ocrText: string
  cover?: Blob
  /** The images this card was built from, in scan order. */
  images: ScannedImage[]
}

/** 0–1 similarity of two detections, weighted towards the title. */
export function detectionSimilarity(a: Detection, b: Detection): number {
  const title = similarity(a.title, b.title)
  // An author match only counts when both sides actually read one; otherwise a pair of
  // blank authors would score a perfect 1 and merge two unrelated books.
  if (!a.author || !b.author) return title
  return title * 0.75 + similarity(a.author, b.author) * 0.25
}

function toItem(image: ScannedImage): ReviewItem {
  return {
    id: image.id,
    title: image.detection.title,
    author: image.detection.author,
    confidence: image.detection.confidence,
    reason: image.detection.reason,
    titleAlternates: image.detection.titleAlternates,
    authorAlternates: image.detection.authorAlternates,
    source: image.detection.source,
    ocrText: image.ocrText,
    cover: image.cover,
    images: [image],
  }
}

/** Groups a batch of scanned images into review cards. */
export function groupDetections(
  images: ScannedImage[],
  threshold = MERGE_THRESHOLD,
): ReviewItem[] {
  const items: ReviewItem[] = []
  for (const image of images) {
    // An empty detection has nothing to match on, so it always gets its own card.
    const match = image.detection.title
      ? items.find((item) => detectionSimilarity(item, image.detection) >= threshold)
      : undefined
    if (match) {
      match.images.push(image)
      // Keep whichever reading the pipeline was most confident about.
      if (image.detection.confidence > match.confidence) {
        match.title = image.detection.title
        match.author = image.detection.author || match.author
        match.confidence = image.detection.confidence
        match.reason = image.detection.reason
        match.source = image.detection.source
        match.cover = image.cover ?? match.cover
      }
    } else {
      items.push(toItem(image))
    }
  }
  return items
}

/** Splits a merged card back into one card per photo. */
export function splitItem(item: ReviewItem): ReviewItem[] {
  if (item.images.length <= 1) return [item]
  return item.images.map(toItem)
}

/** Merges several cards into the first one, keeping its edited title and author. */
export function mergeItems(items: ReviewItem[]): ReviewItem {
  const [first, ...rest] = items
  return {
    ...first,
    images: [...first.images, ...rest.flatMap((i) => i.images)],
  }
}
