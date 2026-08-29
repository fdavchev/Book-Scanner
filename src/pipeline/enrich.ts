/**
 * Open Library lookup — the one optional, online part of the pipeline.
 *
 * The rule that matters: a lookup result is only accepted when it *already agrees* with
 * what OCR read. It corrects spelling and fills in a missing author; it never replaces a
 * detection with an unrelated book because the query was noisy.
 */
import type { Detection } from './types'
import { similarity } from './text'

export interface OpenLibraryDoc {
  title?: string
  author_name?: string[]
  first_publish_year?: number
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export const SEARCH_URL = 'https://openlibrary.org/search.json'

/** Below this, a lookup result is considered a different book and discarded. */
export const MATCH_THRESHOLD = 0.6

export interface EnrichOptions {
  fetcher?: Fetcher
  signal?: AbortSignal
  limit?: number
}

export async function searchOpenLibrary(
  query: string,
  { fetcher = fetch, signal, limit = 5 }: EnrichOptions = {},
): Promise<OpenLibraryDoc[]> {
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(query)}&limit=${limit}` +
    '&fields=title,author_name,first_publish_year'
  const res = await fetcher(url, { signal })
  if (!res.ok) throw new Error(`Open Library returned ${res.status}`)
  const data = (await res.json()) as { docs?: OpenLibraryDoc[] }
  return data.docs ?? []
}

/**
 * Picks the result that best matches the OCR detection, or nothing.
 *
 * Scoring leans on the title, because that is what OCR reads most reliably; a matching
 * author is a bonus that breaks ties between editions, not a requirement — plenty of
 * covers put the author in a script tesseract cannot read at all.
 */
export function bestMatch(
  detection: Detection,
  docs: OpenLibraryDoc[],
  threshold = MATCH_THRESHOLD,
): { doc: OpenLibraryDoc; score: number } | undefined {
  const candidateTitles = [detection.title, ...detection.titleAlternates].filter(Boolean)
  if (candidateTitles.length === 0) return undefined

  let best: { doc: OpenLibraryDoc; score: number } | undefined
  for (const doc of docs) {
    if (!doc.title) continue
    const titleScore = Math.max(...candidateTitles.map((t) => similarity(t, doc.title ?? '')))
    const authorScore = detection.author
      ? Math.max(0, ...(doc.author_name ?? []).map((a) => similarity(detection.author, a)))
      : 0
    const score = titleScore * 0.8 + authorScore * 0.2
    if (titleScore >= threshold && (!best || score > best.score)) best = { doc, score }
  }
  return best
}

export interface EnrichOutcome {
  detection: Detection
  /** True when Open Library agreed and its spelling was taken. */
  matched: boolean
  /** Set when the lookup was attempted and failed — shown as a quiet note, not an error. */
  error?: string
}

/**
 * Runs the lookup for one detection. Any failure — offline, rate limited, timed out —
 * resolves to the untouched OCR detection. A book is never lost because the network was.
 */
export async function enrich(
  detection: Detection,
  query: string,
  options: EnrichOptions = {},
): Promise<EnrichOutcome> {
  if (query.trim().length < 3) return { detection, matched: false }
  try {
    const docs = await searchOpenLibrary(query, options)
    const match = bestMatch(detection, docs)
    if (!match) return { detection, matched: false }
    return {
      matched: true,
      detection: {
        ...detection,
        title: match.doc.title ?? detection.title,
        author: match.doc.author_name?.[0] ?? detection.author,
        confidence: Math.max(detection.confidence, Math.round(match.score * 100)),
        reason: `matched "${match.doc.title}" on Open Library`,
        source: 'openlibrary',
      },
    }
  } catch (err) {
    return {
      detection,
      matched: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ------------------------------------------------------------------ connectivity

export type LookupMode = 'auto' | 'forced-on' | 'forced-off'

/**
 * Whether a lookup should be attempted.
 *
 * `forced-on` attempts the call even when the probe says the device is offline: the
 * detection can be wrong, and the request failing softly costs nothing. Detection never
 * disables the control — that is a deliberate product decision, not an oversight.
 */
export function shouldLookUp(mode: LookupMode, online: boolean): boolean {
  if (mode === 'forced-off') return false
  if (mode === 'forced-on') return true
  return online
}

export function lookupLabel(mode: LookupMode, online: boolean): string {
  if (mode === 'forced-off') return 'Lookup: Off'
  if (mode === 'forced-on') return online ? 'Lookup: On · connected' : 'Lookup: On · no signal'
  return online ? 'Lookup: On · connected' : 'Lookup: Off · offline'
}

/**
 * A real reachability probe rather than `navigator.onLine` alone, which reports "online"
 * for any local network connection — including a hotel Wi-Fi that goes nowhere.
 */
export async function probeConnectivity(
  { fetcher = fetch, timeoutMs = 3000 }: { fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  try {
    const res = await fetcher(`${SEARCH_URL}?q=test&limit=1&fields=title`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}
