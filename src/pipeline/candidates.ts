/**
 * Turns raw OCR lines into a title/author guess.
 *
 * Everything here is a pure function of the OCR output — no canvas, no network, no
 * WASM — which is what makes the detection logic directly unit-testable.
 *
 * The dominant signal is glyph height: on almost every cover the title is the largest
 * text on the page. Position, word shape and confidence break the ties.
 */
import type { BBox, Detection, Hypothesis, OcrEvidence, OcrLine, OcrResult } from './types'
import {
  isMostlyUpperCase,
  letterCount,
  letterRatio,
  normalise,
  tidyTitle,
  tokens,
  wordiness,
} from './text'

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
  // A line opening with a dash is a blurb attribution — "— Village Voice". Treating one
  // as an author made the scanner identify a cover as "The Village Voice Film Guide".
  /^\s*[—–-]{1,2}\s*\p{L}/u,
]

/** Newspapers and magazines that review books. A cover quotes them; none of them wrote it. */
const PUBLICATIONS = [
  'village voice',
  'the guardian',
  'guardian',
  'observer',
  'the times',
  'telegraph',
  'washington post',
  'wall street journal',
  'entertainment weekly',
  'publishers weekly',
  'kirkus',
  'booklist',
  'esquire',
  'vogue',
  'the atlantic',
  'the new yorker',
  'new yorker',
  'boston globe',
  'chicago tribune',
  'los angeles times',
  'daily mail',
  'independent',
  'financial times',
  'time magazine',
  'newsweek',
  'salon',
  'slate',
  'npr',
  'bbc',
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
  if (PUBLICATIONS.some((name) => norm === name || norm.endsWith(` ${name}`))) return true
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
    .filter(
      (l) =>
        l.text.length > 0 &&
        l.confidence >= 30 &&
        // Three letters is the floor for a line to mean anything. Below it the line is
        // cover ornament that OCR tried to read as text.
        letterCount(l.text) >= 3 &&
        !isNoise(l.text),
    )
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
      // Decisive against OCR noise: large decorative marks read as "VU" or "ZR" score
      // highly on height and would otherwise take the title slot.
      score += (wordiness(candidate.text) - 0.5) * 0.4
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
      score += (wordiness(candidate.text) - 0.5) * 0.3
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

// ------------------------------------------------------------------ hypotheses

/** How many candidate lines are considered for each role. */
const MAX_ROLE_CANDIDATES = 5
export const MAX_HYPOTHESES = 6

function normaliseScores(scored: Scored[]): Map<Candidate, number> {
  const best = Math.max(...scored.map((s) => s.score), 0.0001)
  const worst = Math.min(...scored.map((s) => s.score), 0)
  const span = Math.max(0.0001, best - worst)
  return new Map(scored.map((s) => [s.candidate, (s.score - worst) / span]))
}

/**
 * Enumerates whole interpretations of the cover rather than committing to one.
 *
 * Scoring each role independently and taking the winner of each is what produced the
 * pipeline's worst failure mode: on *The Handmaid's Tale* the author's name is set larger
 * than the title, so "Margaret Atwood" won the title role and the real title was pushed
 * into the author slot. Pairing the roles and scoring the pair as a unit lets the correct
 * assignment — which scores slightly worse on raw glyph height but far better on word
 * shape — stay in contention, and lets the catalogue settle it later.
 */
/**
 * How trustworthy one pass's output looks, 0–1: the share of its text that reads like
 * real words, weighted by how confident tesseract was.
 */
export function passQuality(lines: OcrLine[]): number {
  if (lines.length === 0) return 0
  let weight = 0
  let good = 0
  for (const line of lines) {
    const w = Math.max(1, letterCount(line.text))
    weight += w
    good += w * wordiness(line.text) * (line.confidence / 100)
  }
  return weight === 0 ? 0 : Math.min(1, good / weight)
}

export function hypothesesForLines(lines: OcrLine[], imageHeight: number): Hypothesis[] {
  const candidates = groupLines(lines, imageHeight || 1)
  if (candidates.length === 0) return []

  const titleScores = scoreTitles(candidates)
  const authorScores = scoreAuthors(candidates, undefined)
  const titleRank = normaliseScores(titleScores)
  const authorRank = normaliseScores(authorScores)

  const topTitles = titleScores.slice(0, MAX_ROLE_CANDIDATES).map((s) => s.candidate)
  const topAuthors = authorScores.slice(0, MAX_ROLE_CANDIDATES).map((s) => s.candidate)

  const out: Hypothesis[] = []
  for (const title of topTitles) {
    // Title with no author at all: the honest reading of a cover that only shows one.
    out.push({
      title: tidyTitle(title.text),
      author: '',
      score: (titleRank.get(title) ?? 0) * 0.6,
      reason: describe(title, candidates),
    })

    for (const author of topAuthors) {
      if (author === title) continue
      let score = (titleRank.get(title) ?? 0) * 0.55 + (authorRank.get(author) ?? 0) * 0.45

      // Consistency bonuses: a real cover sets the title larger than the author, the
      // author reads like a name and the title does not.
      if (title.height > author.height) score += 0.1
      if (author.hasByPrefix) score += 0.12
      score += looksLikeName(author.text) * 0.12
      score -= looksLikeName(title.text) * 0.1
      if (title.hasByPrefix) score -= 0.3

      out.push({
        title: tidyTitle(title.text),
        author: tidyTitle(author.text.replace(AUTHOR_PREFIX, '')),
        score: Math.max(0, Math.min(1, score)),
        reason: describe(title, candidates),
        authorConfidence: author.confidence,
      })
    }
  }

  // Author-only: some covers show a legible name and an illegible title, and the name
  // alone is enough for the catalogue to work with.
  for (const author of topAuthors.slice(0, 2)) {
    out.push({
      title: '',
      author: tidyTitle(author.text.replace(AUTHOR_PREFIX, '')),
      score: (authorRank.get(author) ?? 0) * 0.35,
      reason: 'only a name was legible',
      authorConfidence: author.confidence,
    })
  }

  return out.sort((a, b) => b.score - a.score)
}

/**
 * Interpretations pooled across every OCR pass.
 *
 * Each pass is scored on its own geometry and never merged with another's. That
 * separation is not fussiness: pooling the *lines* first and scoring the pool was tried
 * and measurably worse, because bounding boxes from a sparse-text pass and a block pass
 * describe the same cover in incompatible ways — "THE ROAD" ended up scored as the author
 * of a book titled "VU". Geometry is only meaningful inside the pass that produced it, so
 * the passes vote on whole interpretations instead.
 *
 * A reading that several passes agree on is worth more than one that only appears once.
 */
export function hypotheses(result: OcrResult | OcrEvidence): Hypothesis[] {
  const evidence = result as OcrEvidence
  const passes =
    evidence.passes?.length > 0
      ? evidence.passes.map((p) => ({ lines: p.lines, quality: passQuality(p.lines) }))
      : [{ lines: result.lines, quality: 1 }]

  const pooled = new Map<string, Hypothesis & { votes: number }>()
  for (const pass of passes) {
    for (const h of hypothesesForLines(pass.lines, result.height)) {
      const key = `${normalise(h.title)}|${normalise(h.author)}`
      if (!h.title && !h.author) continue
      // A pass that produced mostly rubbish should not get an equal vote. Without this,
      // adding passes made the offline reading *worse*: the sparse-text pass on a heavily
      // illustrated cover emits dozens of fragments, and one of them always outscored the
      // real title found by a cleaner pass.
      const score = h.score * (0.55 + 0.45 * pass.quality)
      const existing = pooled.get(key)
      if (existing) {
        existing.votes++
        existing.score = Math.max(existing.score, score)
      } else {
        pooled.set(key, { ...h, score, votes: 1 })
      }
    }
  }

  return [...pooled.values()]
    .map((h) => ({
      title: h.title,
      author: h.author,
      authorConfidence: h.authorConfidence,
      // Agreement across independent passes is genuine corroboration, capped so that a
      // weak reading repeated six times cannot outrank a strong one.
      score: Math.min(1, h.score * (1 + Math.min(0.3, (h.votes - 1) * 0.1))),
      reason: h.reason,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HYPOTHESES)
}

/**
 * The offline answer: the best pooled interpretation, with a confidence that reflects how
 * much better it is than the runner-up.
 *
 * The confidence deliberately no longer keys off OCR's own certainty alone. Tesseract was
 * 98% sure of the words "Margaret Atwood", and the old score passed that straight through
 * even though the pipeline had put them in the wrong field — 8 of 15 benchmark covers came
 * back confidently wrong. A close race between interpretations now reads as a low score,
 * which is what lets the UI tell the user it is unsure instead of inventing certainty.
 */
export function detect(result: OcrResult): Detection {
  const ranked = hypotheses(result)
  const best = ranked[0]
  if (!best) {
    return {
      title: '',
      author: '',
      confidence: 0,
      reason: 'No text large enough to be a title was found',
      titleAlternates: [],
      authorAlternates: [],
      source: 'ocr',
    }
  }

  const margin = Math.max(0, Math.min(1, (best.score - (ranked[1]?.score ?? 0)) / 0.25))
  const ocr = Math.max(0, Math.min(1, result.meanConfidence / 100))

  // How much the winning line looks like an actual title. Glare across a cover left the
  // fragment "The Pic", which OCR was perfectly confident about — and so, wrongly, was the
  // old score. A six-letter fragment is not a title, and the number should say so.
  const titleQuality =
    Math.min(1, Math.max(0.3, letterCount(best.title) / 12)) * Math.max(0.4, wordiness(best.title))
  const confidence = Math.round(
    Math.min(96, (best.score * 0.5 + margin * 0.25 + ocr * 0.25) * 100) *
      (0.5 + 0.5 * titleQuality),
  )

  return {
    title: best.title,
    author: best.author,
    confidence,
    reason: best.reason,
    titleAlternates: [...new Set(ranked.map((h) => h.title).filter(Boolean))]
      .filter((t) => t !== best.title)
      .slice(0, 4),
    authorAlternates: [...new Set(ranked.map((h) => h.author).filter(Boolean))]
      .filter((a) => a !== best.author)
      .slice(0, 4),
    source: 'ocr',
  }
}

/** The query handed to Open Library: the detection if there is one, else the raw text. */
export function searchQuery(result: OcrResult, detection: Detection): string {
  const fromDetection = `${detection.title} ${detection.author}`.trim()
  if (fromDetection.length >= 4) return fromDetection
  return tokens(result.text).slice(0, 12).join(' ')
}
