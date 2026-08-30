import { describe, expect, it, vi } from 'vitest'
import {
  lookupLabel,
  probeConnectivity,
  searchOpenLibrary,
  shouldLookUp,
  type OpenLibraryDoc,
} from './enrich'

function jsonFetcher(docs: OpenLibraryDoc[]) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    void url
    return new Response(JSON.stringify({ docs }), { status: 200 })
  })
}

describe('searchOpenLibrary', () => {
  it('asks only for the fields it needs and returns the docs', async () => {
    const fetcher = jsonFetcher([{ title: 'Dune', author_name: ['Frank Herbert'] }])
    const docs = await searchOpenLibrary('dune herbert', { fetcher })
    expect(docs).toHaveLength(1)
    const url = fetcher.mock.calls[0][0]
    expect(url).toContain('q=dune%20herbert')
    expect(url).toContain('fields=title,author_name,first_publish_year')
  })

  it('throws on a non-OK response', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 503 }))
    await expect(searchOpenLibrary('dune', { fetcher })).rejects.toThrow('503')
  })
})

describe('shouldLookUp', () => {
  it('follows the probe on auto', () => {
    expect(shouldLookUp('auto', true)).toBe(true)
    expect(shouldLookUp('auto', false)).toBe(false)
  })

  it('still attempts the call when forced on and the probe says offline', () => {
    expect(shouldLookUp('forced-on', false)).toBe(true)
  })

  it('never calls out when forced off, even with a connection', () => {
    expect(shouldLookUp('forced-off', true)).toBe(false)
  })
})

describe('lookupLabel', () => {
  it('reads the way the pill should read in each state', () => {
    expect(lookupLabel('auto', true)).toBe('Lookup: On · connected')
    expect(lookupLabel('auto', false)).toBe('Lookup: Off · offline')
    expect(lookupLabel('forced-on', false)).toBe('Lookup: On · no signal')
    expect(lookupLabel('forced-off', true)).toBe('Lookup: Off')
  })
})

describe('probeConnectivity', () => {
  it('is true when the request succeeds', async () => {
    await expect(
      probeConnectivity({ fetcher: vi.fn(async () => new Response('{}', { status: 200 })) }),
    ).resolves.toBe(true)
  })

  it('is false when the request fails, not a thrown error', async () => {
    await expect(
      probeConnectivity({
        fetcher: vi.fn(async () => {
          throw new Error('offline')
        }),
      }),
    ).resolves.toBe(false)
  })
})
