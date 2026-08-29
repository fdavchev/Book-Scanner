/**
 * Turns raw OCR lines into a title/author guess.
 *
 * Everything here is a pure function of the OCR output — no canvas, no network, no
 * WASM — which is what makes the detection logic directly unit-testable.
 *
 * The dominant signal is glyph height: on almost every cover the title is the largest
 * text on the page. Position, word shape and confidence break the ties.
 */
import type { BBox, Detection, OcrLine, OcrResult } from './types'
import { isMostlyUpperCase, letterRatio, normalise, tidyTitle, tokens } from './text'

/** Lines that are printed on covers but are never the title or the author. */
const NOISE_PATTERNS: RegExp[] = [
  /^(a|an)\s+(novel|memoir|story|novella|tale|thriller|romance|mystery)\b/i,
  /\b(inter)?national\s+bestseller\b/i,
  /\bbestsell(er|ing)\b/i,
  /\bnew york times\b/i,
  /\bsunday times\b/i,
  /\bwinner of\b/i,
  /\bshort ?listed\b/i,
  /\blong ?listed\b/i,
  /\bprize\b/i,
  /\baward[- ]winning\b/i,
  /\bpulitzer\b/i,
  /\bbooker\b/i,
  /\bnobel\b/i,
  /\bauthor of\b/i,
  /\bfrom the (author|creator)\b/i,
  /\bnow a major (motion picture|film|series)\b/i,
  /\bsoon to be a\b/i,
  /\b(un)?abridged\b/i,
  /\bwith a new (introduction|foreword|afterword|preface)\b/i,
  /\b(translated|illustrated|edited|introduced|foreword|afterword)\s+by\b/i,
  /\bedition\b/i,
  /\bvolume\s+(one|two|three|[ivx\d]+)\b/i,
  /\bisbn\b/i,
  /^\s*\d{5,}\s*$/,
  /^[\s\d.,$£€]+$/,
  /^[$£€]\s?\d/,
  /\bcopyright\b|©/,
  /\bwww\.|https?:|\.com\b/i,
  /\bclassics?\b/i,
  /\b(paperback|hardcover|hardback)\b/i,
  /\bbook (one|two|three|1|2|3)\b/i,
  /\bprelude to\b/i,
]

/**
 * Publisher and imprint names, matched as whole lines only — plenty of real titles
 * contain the word "Penguin", but a line that *is* "PENGUIN BOOKS" is an imprint.
 */
const IMPRINTS = new Set([
  'penguin',
  'penguin books',
  'penguin classics',
  'vintage',
  'vintage books',
  'vintage international',
  'harper',
  'harpercollins',
  'harper perennial',
  'anchor',
  'anchor books',
  'bantam',
  'bantam books',
  'del rey',
  'tor',
  'tor books',
  'faber',
  'faber and faber',
  'viking',
  'knopf',
  'random house',
  'simon schuster',
  'simon and schuster',
  'macmillan',
  'orbit',
  'gollancz',
  'pan',
  'pan books',
  'corgi',
  'mariner',
  'mariner books',
  'picador',
  'doubleday',
  'scribner',
  'norton',
  'w w norton',
  'oxford',
  'modern library',
  'everyman',
  'signet',
  'ace',
  'ace books',
  'dell',
  'avon',
  'ballantine',
  'ballantine books',
  'grove press',
  'granta',
  'bloomsbury',
  'hodder',
  'headline',
  'orion',
  'sceptre',
  'canongate',
  'houghton mifflin',
  'little brown',
])

const AUTHOR_PREFIX = /^(by|written by|av|од)\s+/i

export interface Candidate {
  text: string
  /** Median glyph height of the group, in pixels. */
  height: number
  confidence: number
  bbox: BBox
  /** Vertical centre as a fraction of image height, 0 (top) to 1 (bottom). */
  centreY: number
  /** True if the line was introduced by "by …". */
  hasByPrefix: boolean
  lines: OcrLine[]
}

export function cleanText(input: string): string {
  return input
    .replace(/[|_~^`]+/g, ' ')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function isNoise(text: string): boolean {
  const cleaned = cleanText(text)
  if (cleaned.length < 2) return true
  const norm = normalise(cleaned)
  if (norm.length < 2) return true
  if (IMPRINTS.has(norm)) return true
  // A line that is entirely a quotation is a blurb, not a title.
  if (/^["'].*["']$/.test(cleaned) && cleaned.length > 12) return true
  if (letterRatio(cleaned) < 0.5) return true
  return NOISE_PATTERNS.some((re) => re.test(cleaned))
}

function lineHeight(line: OcrLine): number {
  // Word boxes are tighter than the line box, which tesseract pads for ascenders and
  // descenders, so the median word height is the more stable measure of glyph size.
  const heights = line.words
    .filter((w) => w.text.trim().length > 0)
    .map((w) => w.bbox.y1 - w.bbox.y0)
    .sort((a, b) => a - b)
  if (heights.length === 0) return line.bbox.y1 - line.bbox.y0
  return heights[Math.floor(heights.length / 2)]
}

function mergeBBox(a: BBox, b: BBox): BBox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }
}

/**
 * Groups vertically adjacent lines of similar glyph height into one candidate, so that
 * a title set across two or three lines is scored as a single phrase.
 */
export function groupLines(lines: OcrLine[], imageHeight: number): Candidate[] {
  const usable = lines
    .map((l) => ({ ...l, text: cleanText(l.text) }))
    .filter((l) => l.text.length > 0 && l.confidence >= 30 && !isNoise(l.text))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0)

  const groups: Candidate[] = []
  for (const line of usable) {
    const h = lineHeight(line)
    const previous = groups[groups.length - 1]
    const gap = previous ? line.bbox.y0 - previous.bbox.y1 : Infinity
    const tallest = previous ? Math.max(h, previous.height) : h
    const ratio = previous ? Math.min(h, previous.height) / tallest : 0
    // Same visual block: comparable glyph size, horizontally overlapping rather than in a
    // different column, and separated by well under one line of the larger text.
    //
    // The height tolerance is deliberately loose. Tesseract's reported word heights for
    // the two halves of one wrapped title routinely differ by a factor of two — it pads
    // the first line's boxes up to whatever sits above it — so a strict ratio splits
    // "THE SILENT / ORCHARD" into two candidates and the title comes out truncated. The
    // tight gap test is what stops this over-merging a title into the author line.
    const overlaps =
      previous !== undefined &&
      Math.min(line.bbox.x1, previous.bbox.x1) - Math.max(line.bbox.x0, previous.bbox.x0) > 0
    const sameBlock =
      previous !== undefined && ratio > 0.45 && gap < tallest * 0.6 && gap > -tallest && overlaps

    if (sameBlock && previous) {
      previous.text = `${previous.text} ${line.text}`
      previous.height = (previous.height + h) / 2
      previous.confidence = (previous.confidence + line.confidence) / 2
      previous.bbox = mergeBBox(previous.bbox, line.bbox)
      previous.centreY = (previous.bbox.y0 + previous.bbox.y1) / 2 / imageHeight
      previous.lines.push(line)
    } else {
      groups.push({
        text: line.text,
        height: h,
        confidence: line.confidence,
        bbox: line.bbox,
        centreY: (line.bbox.y0 + line.bbox.y1) / 2 / imageHeight,
        hasByPrefix: AUTHOR_PREFIX.test(line.text),
        lines: [line],
      })
    }
  }
  return groups
}

/** How much a line looks like a personal name, 0–1: 2–4 capitalised tokens, initials allowed. */
export function looksLikeName(text: string): number {
  const stripped = text.replace(AUTHOR_PREFIX, '').trim()
  const words = stripped.split(/\s+/).filter((w) => w.length > 0)
  if (words.length < 1 || words.length > 5) return 0

  let score = 0
  const capitalised = words.filter((w) => /^[\p{Lu}]/u.test(w) || isMostlyUpperCase(w)).length
  score += (capitalised / words.length) * 0.5
  if (words.length >= 2 && words.length <= 4) score += 0.3
  // Initials such as "J.R.R." or "F. Scott" are a strong personal-name signal.
  if (/(\p{Lu}\.){1,3}/u.test(stripped)) score += 0.2
  if (/\b(de|van|von|del|della|di|mc|mac)\b/i.test(stripped)) score += 0.05
  // Titles are far more likely than names to contain function words.
  if (/\b(the|of|and|a|an|in|on|to|for)\b/i.test(stripped)) score -= 0.25
  return Math.max(0, Math.min(1, score))
}

interface Scored {
  candidate: Candidate
  score: number
}

function scoreTitles(candidates: Candidate[]): Scored[] {
  const maxHeight = Math.max(...candidates.map((c) => c.height), 1)
  return candidates
    .map((candidate) => {
      const words = candidate.text.split(/\s+/).length
      let score = 0
      // Dominant signal: the title is the biggest text on almost every cover.
      score += (candidate.height / maxHeight) * 0.5
      // Upper 60% of the cover.
      score += candidate.centreY <= 0.6 ? 0.15 * (1 - candidate.centreY / 0.6) + 0.05 : 0
      score += words >= 1 && words <= 10 ? 0.12 : 0
      score += letterRatio(candidate.text) * 0.1
      score += (candidate.confidence / 100) * 0.13
      // A "by …" line is an author line, never a title.
      if (candidate.hasByPrefix) score -= 0.5
      if (looksLikeName(candidate.text) > 0.75) score -= 0.12
      return { candidate, score }
    })
    .sort((a, b) => b.score - a.score)
}

function scoreAuthors(candidates: Candidate[], title: Candidate | undefined): Scored[] {
  return candidates
    .filter((c) => c !== title)
    .map((candidate) => {
      let score = 0
      if (candidate.hasByPrefix) score += 0.45
      score += looksLikeName(candidate.text) * 0.3
      // Authors sit at the very top or the very bottom of a cover.
      const edge = Math.max(0, 1 - Math.min(candidate.centreY, 1 - candidate.centreY) / 0.35)
      score += edge * 0.12
      // And they are printed smaller than the title.
      if (title && candidate.height < title.height) score += 0.1
      if (title && candidate.height > title.height) score -= 0.15
      score += (candidate.confidence / 100) * 0.13
      const words = candidate.text.replace(AUTHOR_PREFIX, '').split(/\s+/).length
      if (words > 5) score -= 0.25
      return { candidate, score }
    })
    .sort((a, b) => b.score - a.score)
}

function describe(title: Candidate | undefined, candidates: Candidate[]): string {
  if (!title) return 'No text large enough to be a title was found'
  const maxHeight = Math.max(...candidates.map((c) => c.height), 1)
  const parts: string[] = []
  parts.push(title.height >= maxHeight * 0.95 ? 'largest text' : 'one of the largest lines')
  if (title.centreY < 0.34) parts.push('upper third')
  else if (title.centreY < 0.6) parts.push('upper half')
  else parts.push('lower half')
  parts.push(`${Math.round(title.confidence)}% OCR confidence`)
  return parts.join(', ')
}

/**
 * Overall 0–100 confidence, blending OCR confidence with how clearly the winner beat
 * the runner-up — a close race deserves a low score even when OCR was sure of the text.
 */
function overallConfidence(
  title: Scored | undefined,
  author: Scored | undefined,
  runnerUpScore: number,
): number {
  if (!title) return 0
  const margin = Math.max(0, Math.min(1, (title.score - runnerUpScore) / 0.25))
  const ocr = title.candidate.confidence / 100
  const authorBonus = author && author.score > 0.35 ? 0.15 : 0
  return Math.round(Math.min(100, (ocr * 0.5 + margin * 0.35 + authorBonus) * 100))
}

export function detect(result: OcrResult): Detection {
  const candidates = groupLines(result.lines, result.height || 1)
  const titles = scoreTitles(candidates)
  const title = titles[0]?.candidate
  const authors = scoreAuthors(candidates, title)
  const author = authors[0] && authors[0].score > 0.3 ? authors[0].candidate : undefined

  return {
    title: title ? tidyTitle(title.text) : '',
    author: author ? tidyTitle(author.text.replace(AUTHOR_PREFIX, '')) : '',
    confidence: overallConfidence(titles[0], authors[0], titles[1]?.score ?? 0),
    reason: describe(title, candidates),
    titleAlternates: titles
      .slice(1, 5)
      .map((s) => tidyTitle(s.candidate.text))
      .filter((t) => t.length > 0),
    authorAlternates: authors
      .slice(author ? 1 : 0, 5)
      .map((s) => tidyTitle(s.candidate.text.replace(AUTHOR_PREFIX, '')))
      .filter((t) => t.length > 0),
    source: 'ocr',
  }
}

/** The query handed to Open Library: the detection if there is one, else the raw text. */
export function searchQuery(result: OcrResult, detection: Detection): string {
  const fromDetection = `${detection.title} ${detection.author}`.trim()
  if (fromDetection.length >= 4) return fromDetection
  return tokens(result.text).slice(0, 12).join(' ')
}
