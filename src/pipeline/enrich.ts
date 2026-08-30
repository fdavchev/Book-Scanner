/**
 * The Open Library client and the connectivity probe behind the lookup pill.
 *
 * Deciding *which* result is the right book lives in `identify.ts`; this file only knows
 * how to ask the catalogue a question and whether the network is really there.
 */

export interface OpenLibraryDoc {
  title?: string
  author_name?: string[]
  first_publish_year?: number
  /** How many editions the catalogue knows of — a proxy for how common the book is. */
  edition_count?: number
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export const SEARCH_URL = 'https://openlibrary.org/search.json'

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
    '&fields=title,author_name,first_publish_year,edition_count'
  const res = await fetcher(url, { signal })
  if (!res.ok) throw new Error(`Open Library returned ${res.status}`)
  const data = (await res.json()) as { docs?: OpenLibraryDoc[] }
  return data.docs ?? []
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
