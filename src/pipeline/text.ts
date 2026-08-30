/** Pure text helpers shared by candidate scoring, grouping and the Open Library gate. */

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalise(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokens(input: string): string[] {
  const n = normalise(input)
  return n.length === 0 ? [] : n.split(' ')
}

/** Levenshtein distance, iterative with a single row. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = row
  }
  return prev[b.length]
}

/** 0–1 similarity of two strings after normalisation. 1 means identical. */
export function similarity(a: string, b: string): number {
  const na = normalise(a)
  const nb = normalise(b)
  if (na.length === 0 && nb.length === 0) return 1
  if (na.length === 0 || nb.length === 0) return 0
  if (na === nb) return 1
  const longest = Math.max(na.length, nb.length)
  const char = 1 - editDistance(na, nb) / longest

  // Token overlap catches word-order differences and OCR dropping a word entirely,
  // which raw edit distance punishes far too hard.
  const ta = new Set(tokens(na))
  const tb = new Set(tokens(nb))
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  const token = shared === 0 ? 0 : (2 * shared) / (ta.size + tb.size)

  return Math.max(char, (char + token) / 2, token * 0.95)
}

/** Ratio of letters to all non-space characters, 0–1. Digit-heavy lines score low. */
export function letterRatio(input: string): number {
  const chars = input.replace(/\s/g, '')
  if (chars.length === 0) return 0
  const letters = chars.match(/\p{L}/gu)?.length ?? 0
  return letters / chars.length
}

export function isMostlyUpperCase(input: string): boolean {
  const letters = input.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return false
  const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length
  return upper / letters.length > 0.7
}

/** Title Case a line that OCR read as ALL CAPS, leaving mixed-case text alone. */
export function tidyTitle(input: string): string {
  const cleaned = input.replace(/\s+/g, ' ').trim()
  if (!isMostlyUpperCase(cleaned) || cleaned.length < 4) return cleaned
  const small = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'at'])
  return cleaned
    .toLowerCase()
    .split(' ')
    .map((word, i) =>
      i > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ')
}

/** Vowels in both scripts the app reads. */
const VOWELS = /[aeiouyаеиоу]/i

/**
 * How much a string reads like real words, 0–1: the share of its tokens that contain a
 * vowel and are long enough to be a word.
 *
 * OCR noise from cover artwork is overwhelmingly short consonant clusters — "VU", "BE",
 * "Nt", "SS", "ZR". They survived every other filter, and because decorative elements are
 * large they scored highly on glyph height and won the title slot outright. This is the
 * measure that tells them apart from "Dune".
 */
export function wordiness(input: string): number {
  const parts = normalise(input).split(' ').filter((t) => t.length > 0)
  if (parts.length === 0) return 0
  const wordLike = parts.filter((t) => t.length >= 2 && VOWELS.test(t)).length
  return wordLike / parts.length
}

/** Total letters, ignoring spaces and punctuation. */
export function letterCount(input: string): number {
  return (input.match(/\p{L}/gu) ?? []).length
}
