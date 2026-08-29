import { describe, expect, it, vi } from 'vitest'
import {
  bestMatch,
  enrich,
  lookupLabel,
  probeConnectivity,
  searchOpenLibrary,
  shouldLookUp,
  type OpenLibraryDoc,
} from './enrich'
import type { Detection } from './types'

function detection(overrides: Partial<Detection> = {}): Detection {
  return {
    title: 'Iron Harvest',
    author: 'D. K. Whitlock',
    confidence: 70,
    reason: 'largest text, upper third',
    titleAlternates: [],
    authorAlternates: [],
    source: 'ocr',
    ...overrides,
  }
}

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

describe('bestMatch', () => {
  it('accepts a result that agrees with the OCR title', () => {
    const match = bestMatch(detection({ title: 'Iron Harvst' }), [
      { title: 'Iron Harvest', author_name: ['D. K. Whitlock'] },
    ])
    expect(match?.doc.title).toBe('Iron Harvest')
  })

  it('rejects an unrelated result rather than overwriting the detection', () => {
    const match = bestMatch(detection({ title: 'Iron Harvest' }), [
      { title: 'Pride and Prejudice', author_name: ['Jane Austen'] },
    ])
    expect(match).toBeUndefined()
  })

  it('will match on an alternate when the winning title was the wrong line', () => {
    const match = bestMatch(
      detection({ title: 'A Sequel', titleAlternates: ['Winter Letters'] }),
      [{ title: 'Winter Letters', author_name: ['Jonas Lindqvist'] }],
    )
    expect(match?.doc.title).toBe('Winter Letters')
  })

  it('prefers the edition whose author also matches', () => {
    const match = bestMatch(detection({ title: 'Dune', author: 'Frank Herbert' }), [
      { title: 'Dune', author_name: ['Someone Else'] },
      { title: 'Dune', author_name: ['Frank Herbert'] },
    ])
    expect(match?.doc.author_name?.[0]).toBe('Frank Herbert')
  })

  it('matches on title alone when OCR could not read the author', () => {
    const match = bestMatch(detection({ title: 'Dune', author: '' }), [
      { title: 'Dune', author_name: ['Frank Herbert'] },
    ])
    expect(match?.doc.author_name?.[0]).toBe('Frank Herbert')
  })

  it('returns nothing when there is no detection to gate against', () => {
    expect(bestMatch(detection({ title: '', titleAlternates: [] }), [{ title: 'Dune' }])).toBeUndefined()
  })
})

describe('enrich', () => {
  it('takes the looked-up spelling and marks the source', async () => {
    const outcome = await enrich(detection({ title: 'Iron Harvst', author: '' }), 'iron harvst', {
      fetcher: jsonFetcher([{ title: 'Iron Harvest', author_name: ['D. K. Whitlock'] }]),
    })
    expect(outcome.matched).toBe(true)
    expect(outcome.detection.title).toBe('Iron Harvest')
    expect(outcome.detection.author).toBe('D. K. Whitlock')
    expect(outcome.detection.source).toBe('openlibrary')
    expect(outcome.detection.reason).toContain('Open Library')
  })

  it('keeps the OCR detection when the network fails', async () => {
    const outcome = await enrich(detection(), 'iron harvest', {
      fetcher: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })
    expect(outcome.matched).toBe(false)
    expect(outcome.detection.title).toBe('Iron Harvest')
    expect(outcome.detection.source).toBe('ocr')
    expect(outcome.error).toContain('Failed to fetch')
  })

  it('keeps the OCR detection when nothing matches', async () => {
    const outcome = await enrich(detection(), 'iron harvest', {
      fetcher: jsonFetcher([{ title: 'Something Unrelated' }]),
    })
    expect(outcome.matched).toBe(false)
    expect(outcome.detection.source).toBe('ocr')
  })

  it('does not call out at all for a query too short to mean anything', async () => {
    const fetcher = jsonFetcher([])
    const outcome = await enrich(detection({ title: '', author: '' }), 'a', { fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    expect(outcome.matched).toBe(false)
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
