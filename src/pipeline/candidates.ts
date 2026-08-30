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
  // Macedonian equivalents of the credit lines above. "Превод: ..." — the translator —
  // is set tiny on a cover and is never the title, but nothing filtered it, so it won the
  // title slot on a real Sherlock Holmes cover.
  /(превод|препев)/i,
  /илустрации/i,
  /(предговор|поговор)/i,
  /(прво|второ|трето)\s+издание/i,
  /издава(ч|штво)/i,
  /библиотека/i,
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
  // Macedonian publishers.
  'антолог',
  'табернакул',
  'култура',
  'просветно дело',
  'или или',
  'матица',
  'магор',
  'детска радост',
  'арс ламина',
  'полица',
  'слово',
  'феникс',
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

/**
 * Rejoins display type that OCR split one letter per token.
 *
 * Cover titles are frequently letter-spaced, and tesseract reads the tracking as word
 * breaks: "ШЕРЛОК ХОЛМС" comes back as "Ш Е Р Л О К  Х О Л М С". Left alone, every token
 * is one letter, so `wordiness` reads it as pure noise and the real title scores zero.
 * Runs of three or more single letters are glued back together; a genuine initial such as
 * "J. R. R." is punctuated and never forms a bare run this long.
 */
export function joinSpacedLetters(input: string): string {
  return input.replace(/(?:(?<=^|\s)\p{L}(?=\s|$)){3,}/gu, (run) => run.replace(/\s+/g, ''))
}

export function cleanText(input: string): string {
  return joinSpacedLetters(
    input
      .replace(/[|_~^`]+/g, ' ')
      .replace(/[“”„]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim(),
  )
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

export function lineHeight(line: OcrLine): number {
  // Word boxes are tighter than the line box, which tesseract pads for ascenders and
  // descenders, so the median word height is the more stable measure of glyph size.
  const heights = line.words
    .filter((w) => w.text.trim().length > 0)
    .map((w) => w.bbox.y1 - w.bbox.y0)
    .sort((a, b) => a - b)
  if (heights.length === 0) return line.bbox.y1 - line.bbox.y0
  return heights[Math.floor(heights.length / 2)]
}

/**
 * The tallest text a pass read, before any filtering.
 *
 * This is the denominator every size judgement uses, and measuring against the candidates
 * that *survived* filtering was the bug behind the worst failure: on a cover whose two
 * huge title lines were dropped for low confidence, a tiny translator credit became "the
 * largest text on the cover" by default and won the title outright. Single-letter reads
 * are excluded — a decorative flourish read as "V" is not a size reference.
 */
export function tallestLineHeight(lines: OcrLine[]): number {
  let max = 0
  for (const line of lines) {
    // The reference has to be real text. Tesseract will happily return a 641px-tall
    // "line" at zero confidence where it tried to read the cover artwork, and using that
    // as the denominator shrank a genuine 223px title to 0.35 of "full size" — straight
    // into the smallness penalty. A size reference must itself look like a word.
    if (
      line.confidence >= 20 &&
      letterCount(line.text) >= 3 &&
      wordiness(line.text) >= 0.5
    ) {
      max = Math.max(max, lineHeight(line))
    }
  }
  return max
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
  const pageMax = tallestLineHeight(lines)

  const usable = lines
    .map((l) => ({ ...l, text: cleanText(l.text), height: lineHeight(l) }))
    .filter((l) => {
      if (l.text.length === 0 || isNoise(l.text)) return false
      // Display type is exactly what tesseract is least sure of: stylised, letter-spaced,
      // often set over artwork. A flat 30% floor dropped the giant "ХОЛМС" off a perfectly
      // clean photograph and left only the fine print to compete for the title. A line at
      // least half the height of the tallest thing on the page is admitted on much lower
      // confidence — but has to earn it on a *stricter* letter count and word-shape test,
      // so the ornament noise those filters exist to remove stays out.
      if (pageMax > 0 && l.height >= pageMax * 0.5) {
        return l.confidence >= 20 && letterCount(l.text) >= 4 && wordiness(l.text) >= 0.5
      }
      // Three letters is the floor for a line to mean anything. Below it the line is
      // cover ornament that OCR tried to read as text.
      return l.confidence >= 30 && letterCount(l.text) >= 3
    })
    .sort((a, b) => a.bbox.y0 - b.bbox.y0)

  const centreX = (b: BBox) => (b.x0 + b.x1) / 2

  const groups: Candidate[] = []
  for (const line of usable) {
    const h = line.height
    const previous = groups[groups.length - 1]
    const gap = previous ? line.bbox.y0 - previous.bbox.y1 : Infinity
    // Compared against the last line of the block, not the block's running average. A
    // title that steps down in size — "АВАНТУРИТЕ НА" over "ШЕРЛОК" over "ХОЛМС" — is a
    // real typographic pattern, and averaging the first two gives a height that matches
    // neither the medium line above nor the giant line below.
    const prevTail = previous ? lineHeight(previous.lines[previous.lines.length - 1]) : 0
    const tallest = previous ? Math.max(h, prevTail) : h
    const ratio = previous ? Math.min(h, prevTail) / tallest : 0
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
    const sameSize = ratio > 0.45 && gap < tallest * 0.6

    // A display block often steps down hard in size — a medium "АВАНТУРИТЕ НА" over a
    // giant "ШЕРЛОК" is one title, and the 0.45 ratio floor splits it in two. Crossing a
    // size step is only safe when the type is genuinely display-sized, the lines are
    // centred on one another, and the leading is tighter than the *smaller* line's own
    // height — the gap down to an author line is never that tight.
    const widest = previous
      ? Math.max(previous.bbox.x1 - previous.bbox.x0, line.bbox.x1 - line.bbox.x0)
      : 0
    const centred =
      previous !== undefined && Math.abs(centreX(line.bbox) - centreX(previous.bbox)) < widest * 0.25
    const displayBlock =
      previous !== undefined &&
      ratio > 0.2 &&
      pageMax > 0 &&
      Math.max(h, prevTail) >= pageMax * 0.45 &&
      // Stops a block "walking" down from display type to body text one step at a time.
      h >= previous.height * 0.25 &&
      gap < Math.min(h, prevTail) * 0.6 &&
      centred

    const sameBlock =
      previous !== undefined && overlaps && gap > -tallest && (sameSize || displayBlock)

    if (sameBlock && previous) {
      previous.text = `${previous.text} ${line.text}`
      // Median of the block's lines. The mean understated a stepped title; the max
      // overstated an over-merged one, and a block that had swallowed a neighbour was
      // then scored as though every line in it were giant — "TO KI ockin 1Qbird od A".
      // The median gives the stepped case the right answer and lets a bad merge collapse
      // back towards the smaller lines that dominate it.
      previous.lines.push(line)
      const blockHeights = previous.lines.map(lineHeight).sort((a, b) => a - b)
      previous.height = blockHeights[Math.floor(blockHeights.length / 2)]
      previous.confidence = (previous.confidence + line.confidence) / 2
      previous.bbox = mergeBBox(previous.bbox, line.bbox)
      previous.centreY = (previous.bbox.y0 + previous.bbox.y1) / 2 / imageHeight
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

function scoreTitles(candidates: Candidate[], pageMaxHeight = 0): Scored[] {
  // Measured against the tallest text the pass *read*, not the tallest that survived
  // filtering. That distinction is the whole bug: when both title lines were dropped, a
  // tiny translator credit became "the largest text on the cover" by default.
  const maxHeight = Math.max(pageMaxHeight, ...candidates.map((c) => c.height), 1)
  return candidates
    .map((candidate) => {
      const rel = candidate.height / maxHeight
      const words = candidate.text.split(/\s+/).length
      let score = 0
      // Dominant signal: the title is the biggest text on almost every cover.
      score += rel * 0.5
      // Smallness is disqualifying, and nothing else here can pay for it. A line at a
      // tenth of the cover's largest glyph is a credit line, a strapline or an imprint —
      // "Превод: Ѓургица Илиева Нацкова" is all three at once, and it beat two title
      // lines set eight times its size. Every other positive term sums to 0.72, so this
      // penalty puts such a line permanently out of reach.
      if (rel < 0.55) score -= (0.55 - rel) * 1.2
      // Upper 60% of the cover.
      score += candidate.centreY <= 0.6 ? 0.15 * (1 - candidate.centreY / 0.6) + 0.05 : 0
      // Flat: a one-word title ("Dune", "Beloved") is as legitimate as a four-word one,
      // and scaling this by length measurably cost those. Preferring the fuller reading of
      // the *same* title is handled in `hypotheses` instead, where it belongs.
      score += words >= 1 && words <= 10 ? 0.12 : 0
      score += letterRatio(candidate.text) * 0.1
      // Decisive against OCR noise: large decorative marks read as "VU" or "ZR" score
      // highly on height and would otherwise take the title slot.
      score += (wordiness(candidate.text) - 0.5) * 0.4
      // Trimmed from 0.13: display type is legitimately low-confidence and the filter now
      // admits it, so confidence must not quietly undo that.
      score += (candidate.confidence / 100) * 0.10
      // A "by …" line is an author line, never a title.
      if (candidate.hasByPrefix) score -= 0.5
      // A line shaped like a personal name is usually the author, even when it is the
      // biggest thing on the cover. At 0.12 this was too weak to stop "Артур Конан Дојл"
      // taking the title slot from "Скарлетна" on a real cover.
      if (looksLikeName(candidate.text) > 0.75) score -= 0.25
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

export function hypothesesForLines(
  lines: OcrLine[],
  imageHeight: number,
  coverMaxHeight = 0,
): Hypothesis[] {
  // The size reference is the tallest text found anywhere on the cover, not just in this
  // pass. Using the pass's own maximum was the last piece of the laundering: a pass that
  // read nothing but the author's name believed that name was the biggest text on the
  // cover, so it escaped both the smallness penalty and the reach brake and took the
  // title role — which is exactly how "Артур Конан Дојл" became a title.
  const pageMax = Math.max(coverMaxHeight, tallestLineHeight(lines))
  const candidates = groupLines(lines, imageHeight || 1)
  if (candidates.length === 0) return []

  const titleScores = scoreTitles(candidates, pageMax)
  const authorScores = scoreAuthors(candidates, undefined)
  const titleRank = normaliseScores(titleScores)
  const authorRank = normaliseScores(authorScores)

  const topTitles = titleScores.slice(0, MAX_ROLE_CANDIDATES).map((s) => s.candidate)
  const topAuthors = authorScores.slice(0, MAX_ROLE_CANDIDATES).map((s) => s.candidate)

  /**
   * An absolute brake on the title role, applied *after* the per-pass normalisation.
   *
   * `normaliseScores` rescales each pass's candidates to 0–1, so whatever ranks first in a
   * pass always scores 1 — even when that pass dropped both title lines and the best thing
   * left is a translator credit. Everything `scoreTitles` knows about size is laundered
   * away at that point. This is what survives it: whatever else is true, a line a tenth the
   * height of the cover's largest is not the title.
   */
  const reach = (c: Candidate) =>
    pageMax <= 0 ? 1 : 0.35 + 0.65 * Math.min(1, c.height / (pageMax * 0.6))

  /**
   * The same problem for name-shaped lines. The penalty inside `scoreTitles` is erased
   * whenever a pass holds only one usable candidate — it is rescaled to 1 regardless — so
   * on a cover where one pass read nothing but "Артур Конан Дојл", the author's name won
   * the title role outright. An absolute factor is the only thing that survives.
   */
  const notAName = (c: Candidate) => (looksLikeName(c.text) > 0.75 ? 0.65 : 1)
  const titleWeight = (c: Candidate) => reach(c) * notAName(c)

  const out: Hypothesis[] = []
  for (const title of topTitles) {
    // Title with no author at all: the honest reading of a cover that only shows one.
    out.push({
      title: tidyTitle(title.text),
      author: '',
      score: (titleRank.get(title) ?? 0) * 0.6 * titleWeight(title),
      reason: describe(title, candidates),
    })

    for (const author of topAuthors) {
      if (author === title) continue
      let score =
        (titleRank.get(title) ?? 0) * 0.55 * titleWeight(title) +
        (authorRank.get(author) ?? 0) * 0.45

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

  // A title set on two separate lines that the grouping stage could not join — different
  // sizes, a graphic between them — still reads as one title to a person. The two largest
  // title candidates, in the order they appear down the cover, are offered as a combined
  // reading: on "АВАНТУРИТЕ НА / ШЕРЛОК / ХОЛМС" it is the only way to get more than one
  // word. It is deliberately scored below the single-line readings, so it surfaces as an
  // alternative the user can tap rather than as the answer.
  const [firstTitle, secondTitle] = topTitles
    .slice(0, 2)
    .slice()
    .sort((a, b) => a.bbox.y0 - b.bbox.y0)
  if (firstTitle && secondTitle && firstTitle !== secondTitle) {
    const joined = `${firstTitle.text} ${secondTitle.text}`
    out.push({
      title: tidyTitle(joined),
      author: '',
      score:
        Math.min(titleRank.get(firstTitle) ?? 0, titleRank.get(secondTitle) ?? 0) * 0.5,
      reason: 'two lines of the cover read as one title',
    })
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
      ? evidence.passes.map((p) => ({
          lines: p.lines,
          quality: passQuality(p.lines),
          maxHeight: tallestLineHeight(p.lines),
          // Passes no longer share a scale — one of them reads a deliberately shrunken
          // copy — so sizes are compared as a fraction of each pass's own image.
          imageHeight: Math.max(1, p.height),
        }))
      : [
          {
            lines: result.lines,
            quality: 1,
            maxHeight: tallestLineHeight(result.lines),
            imageHeight: Math.max(1, result.height),
          },
        ]

  // The tallest text any pass managed to read. `passQuality` measures word-shape only and
  // is completely size-blind, so a pass that read nothing but the fine print scored near 1
  // and was given the louder vote over the pass that actually found the title. Every pass
  // runs on the same prepared canvas at the same dimensions, so glyph heights are directly
  // comparable between them — positions are not, which is why this is the only cross-pass
  // geometry used.
  // The tallest text seen anywhere, as a fraction of image height so it means the same
  // thing in every pass.
  const coverMaxFraction = Math.max(
    0.0001,
    ...passes.map((p) => p.maxHeight / p.imageHeight),
  )

  const pooled = new Map<string, Hypothesis & { votes: number }>()
  for (const pass of passes) {
    // Converted back into this pass's own pixels before it is used as a denominator.
    const coverMaxHere = coverMaxFraction * pass.imageHeight
    for (const h of hypothesesForLines(pass.lines, pass.imageHeight, coverMaxHere)) {
      const key = `${normalise(h.title)}|${normalise(h.author)}`
      if (!h.title && !h.author) continue
      // A pass that produced mostly rubbish should not get an equal vote. Without this,
      // adding passes made the offline reading *worse*: the sparse-text pass on a heavily
      // illustrated cover emits dozens of fragments, and one of them always outscored the
      // real title found by a cleaner pass.
      // Gentler than the quality factor on purpose: a pass can legitimately miss the
      // biggest line because it is genuinely unreadable, so reach modulates rather than
      // dominates.
      const passReach = Math.min(1, pass.maxHeight / pass.imageHeight / coverMaxFraction)
      const score = h.score * (0.55 + 0.45 * pass.quality) * (0.72 + 0.28 * passReach)
      const existing = pooled.get(key)
      if (existing) {
        existing.votes++
        existing.score = Math.max(existing.score, score)
      } else {
        pooled.set(key, { ...h, score, votes: 1 })
      }
    }
  }

  const all = [...pooled.values()]
  return all
    .map((h) => ({
      title: h.title,
      author: h.author,
      authorConfidence: h.authorConfidence,
      // One pass reads "Шерло", another reads "Авантурите на Шерлок" — the same title,
      // one of them more completely. Pooling took whichever scored higher, which was
      // regularly the fragment. A reading that contains another reading is the fuller one.
      completeness: all.some(
        (other) =>
          other !== h &&
          other.title.length > 0 &&
          normalise(h.title).length > normalise(other.title).length &&
          normalise(h.title).includes(normalise(other.title)),
      )
        ? 0.08
        : 0,
      // Agreement across independent passes is genuine corroboration, capped so that a
      // weak reading repeated six times cannot outrank a strong one.
      score: Math.min(1, h.score * (1 + Math.min(0.3, (h.votes - 1) * 0.1))),
      reason: h.reason,
    }))
    .map(({ completeness, ...h }) => ({ ...h, score: Math.min(1, h.score + completeness) }))
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
