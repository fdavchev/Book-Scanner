import { describe, expect, it, vi } from 'vitest'
import {
  buildEvidence,
  buildQueries,
  coverage,
  identify,
  sanitiseQuery,
  scoreDoc,
  tokenMatches,
  type EvidencePool,
} from './identify'
import type { Detection, Hypothesis, OcrLine, OcrResult } from './types'
import type { OpenLibraryDoc } from './enrich'

function line(text: string, confidence = 90): OcrLine {
  return {
    text,
    confidence,
    bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
    words: [{ text, confidence, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } }],
  }
}

function page(texts: string[]): OcrResult {
  const lines = texts.map((t) => line(t))
  return { lines, text: texts.join('\n'), width: 1000, height: 1500, meanConfidence: 90 }
}

function hypothesis(title: string, author = '', score = 0.8, authorConfidence = 95): Hypothesis {
  return { title, author, score, reason: 'test', authorConfidence }
}

function evidenceOf(texts: string[], ranked: Hypothesis[] = []): EvidencePool {
  return buildEvidence(page(texts), ranked)
}

function offlineDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    title: 'Unreadable',
    author: '',
    confidence: 20,
    reason: 'ocr',
    titleAlternates: [],
    authorAlternates: [],
    source: 'ocr',
    ...overrides,
  }
}

function fetcherFor(byQuery: Record<string, OpenLibraryDoc[]>) {
  return vi.fn(async (url: string) => {
    const query = decodeURIComponent(new URL(url).searchParams.get('q') ?? '')
    const docs = byQuery[query] ?? byQuery['*'] ?? []
    return new Response(JSON.stringify({ docs }), { status: 200 })
  })
}

describe('tokenMatches', () => {
  it('accepts the substitutions OCR actually makes', () => {
    expect(tokenMatches('neuromahcer', 'neuromancer')).toBe(true)
    expect(tokenMatches('ockingbird', 'mockingbird')).toBe(true)
    expect(tokenMatches('gatsry', 'gatsby')).toBe(true)
  })

  it('rejects different words', () => {
    expect(tokenMatches('harvest', 'handmaid')).toBe(false)
    expect(tokenMatches('tolkien', 'atwood')).toBe(false)
  })

  it('requires short words to be exact, because one edit changes what they are', () => {
    expect(tokenMatches('road', 'read')).toBe(false)
    expect(tokenMatches('road', 'road')).toBe(true)
  })
})

describe('coverage', () => {
  it('is 1 when every word of the title was read', () => {
    expect(coverage('The Road', ['the', 'road'])).toBe(1)
  })

  it('does not need the article to be read', () => {
    // "HOBBIT" alone on a cover should still identify The Hobbit.
    expect(coverage('The Hobbit', ['hobbit'])).toBeGreaterThan(0.8)
  })

  it('separates a short title from a longer one sharing its words', () => {
    const ocr = ['the', 'road']
    expect(coverage('The Road', ocr)).toBeGreaterThan(coverage('The Road to Oz', ocr))
    expect(coverage('The Road', ocr)).toBeGreaterThan(coverage('On the Road', ocr))
  })

  it('is 0 when nothing matches', () => {
    expect(coverage('Dune', ['neuromancer', 'gibson'])).toBe(0)
  })
})

describe('sanitiseQuery', () => {
  it('strips the stray punctuation OCR emits', () => {
    // An unbalanced quote made Open Library return nothing at all.
    expect(sanitiseQuery('"harper Lee')).toBe('harper Lee')
    expect(sanitiseQuery('anovel by J. D/SALINGER')).toBe('anovel by SALINGER')
  })

  it('drops single characters and keeps the words', () => {
    expect(sanitiseQuery('F. Scott Fitzgerald')).toBe('Scott Fitzgerald')
  })

  it('survives a string with nothing usable in it', () => {
    expect(sanitiseQuery('— , . |')).toBe('')
  })
})

describe('buildQueries', () => {
  it('asks title+author, then the author alone, then the title alone', () => {
    const evidence = evidenceOf(
      ['IRON HARVEST', 'D. K. WHITLOCK'],
      [hypothesis('Iron Harvest', 'D. K. Whitlock')],
    )
    const queries = buildQueries(evidence, page(['IRON HARVEST', 'D. K. WHITLOCK']))
    expect(queries[0]).toContain('Iron Harvest')
    // The plain author query is what rescues a cover whose title is unreadable, so it must
    // not be crowded out by title+author combinations.
    expect(queries.some((q) => q.trim() === 'Whitlock')).toBe(true)
  })

  it('still produces a query when only an author was read', () => {
    const evidence = evidenceOf(['HARPER LEE'], [hypothesis('', 'Harper Lee')])
    expect(buildQueries(evidence, page(['HARPER LEE'])).length).toBeGreaterThan(0)
  })

  it('never repeats the same query', () => {
    const evidence = evidenceOf(['DUNE'], [hypothesis('Dune'), hypothesis('Dune')])
    const queries = buildQueries(evidence, page(['DUNE']))
    expect(new Set(queries).size).toBe(queries.length)
  })
})

describe('scoreDoc', () => {
  it('accepts a book whose title and author were both read', () => {
    const evidence = evidenceOf(['TO KILL A', 'ockingbird', 'HARPER LEE'])
    const scored = scoreDoc(
      { title: 'To Kill a Mockingbird', author_name: ['Harper Lee'] },
      evidence,
    )
    expect(scored.accepted).toBe(true)
  })

  it('accepts a short title that was read completely', () => {
    const scored = scoreDoc(
      { title: 'The Road', author_name: ['Cormac McCarthy'] },
      evidenceOf(['THE ROAD']),
    )
    expect(scored.accepted).toBe(true)
  })

  it('rejects a book that merely contains the words that were read', () => {
    const evidence = evidenceOf(['THE ROAD'])
    expect(scoreDoc({ title: 'The Road to Oz', author_name: ['L. Frank Baum'] }, evidence).accepted).toBe(
      false,
    )
  })

  it('rejects a real book that happens to match OCR garbage', () => {
    // The old pipeline accepted exactly this and reported it with high confidence.
    const evidence = evidenceOf(['Ird', 'ITT'])
    expect(scoreDoc({ title: 'Ird', author_name: ['Ángel Gabaldón'] }, evidence).accepted).toBe(false)
  })

  it('rejects a same-titled book when the cover names a different author', () => {
    const evidence = evidenceOf(
      ['IRON HARVEST', 'D. K. WHITLOCK'],
      [hypothesis('Iron Harvest', 'D. K. Whitlock')],
    )
    const scored = scoreDoc({ title: 'Iron Harvest', author_name: ['C. P. Surendran'] }, evidence)
    expect(scored.accepted).toBe(false)
    expect(scored.reason).toMatch(/different author/i)
  })

  it('lets a badly-read author line veto nothing', () => {
    // The cover of Jane Eyre says "Charlotte Brontë"; OCR rendered it "Charjoy Bro".
    // A reading that damaged must not be allowed to rule out the correct book.
    const evidence = evidenceOf(
      ['Jane', 'Eyre', 'Charjoy Bro'],
      [hypothesis('Jane Eyre', 'Charjoy Bro', 0.8, 55)],
    )
    expect(scoreDoc({ title: 'Jane Eyre', author_name: ['Charlotte Brontë'] }, evidence).accepted).toBe(
      true,
    )
  })

  it('does not treat a misfiled title as a competing author', () => {
    // The detector often files the title under "author"; that must not veto the match.
    const evidence = evidenceOf(['THE ROAD'], [hypothesis('', 'The Road')])
    expect(scoreDoc({ title: 'The Road', author_name: ['Cormac McCarthy'] }, evidence).accepted).toBe(
      true,
    )
  })

  it('flags an author-only reading when the title could not be read', () => {
    const evidence = evidenceOf(['F. SCOTT FITZGERALD'], [hypothesis('', 'F. Scott Fitzgerald')])
    const scored = scoreDoc(
      { title: 'The Great Gatsby', author_name: ['F. Scott Fitzgerald'] },
      evidence,
    )
    expect(scored.accepted).toBe(false)
    expect(scored.authorOnly).toBe(true)
  })

  it('prefers the widely-published edition when the evidence is equal', () => {
    const evidence = evidenceOf(['BRAVE', 'NEW WORLD'])
    const famous = scoreDoc(
      { title: 'Brave New World', author_name: ['Aldous Huxley'], edition_count: 400 },
      evidence,
    )
    const obscure = scoreDoc(
      { title: 'Brave New World', author_name: ['Someone Else'], edition_count: 1 },
      evidence,
    )
    expect(famous.score).toBeGreaterThan(obscure.score)
  })
})

describe('identify', () => {
  it('identifies a book the detector read wrongly, from the pooled evidence', async () => {
    // The detector picked the wrong line as the title; the right words are still in the pool.
    const ocr = page(['THE AUTHORIZED EDITION', 'HOBBIT', 'FRR TOLKIEN'])
    const ranked = [hypothesis('Frr Tolkien', ''), hypothesis('Hobbit', 'Frr Tolkien')]
    const result = await identify(ocr, ranked, offlineDetection({ title: 'Frr Tolkien' }), {
      fetcher: fetcherFor({
        '*': [{ title: 'The Hobbit', author_name: ['J.R.R. Tolkien'], edition_count: 300 }],
      }),
    })
    expect(result.matched).toBe(true)
    expect(result.detection.title).toBe('The Hobbit')
    expect(result.detection.author).toBe('J.R.R. Tolkien')
    expect(result.detection.source).toBe('openlibrary')
  })

  it('keeps the offline reading when nothing is corroborated', async () => {
    const offline = offlineDetection({ title: 'Sas', confidence: 30 })
    const result = await identify(page(['Sas', 'aig']), [hypothesis('Sas')], offline, {
      fetcher: fetcherFor({ '*': [{ title: 'Something Unrelated', author_name: ['A Stranger'] }] }),
    })
    expect(result.matched).toBe(false)
    expect(result.detection).toEqual(offline)
  })

  it('falls back to the offline reading when the network fails', async () => {
    const offline = offlineDetection({ title: 'Dune' })
    const result = await identify(page(['DUNE']), [hypothesis('Dune')], offline, {
      fetcher: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })
    expect(result.matched).toBe(false)
    expect(result.detection.title).toBe('Dune')
    expect(result.error).toContain('Failed to fetch')
  })

  it('names the author and offers their books when only the author was legible', async () => {
    const ocr = page(['F. SCOTT FITZGERALD'])
    const ranked = [hypothesis('', 'F. Scott Fitzgerald')]
    const result = await identify(ocr, ranked, offlineDetection(), {
      fetcher: fetcherFor({
        '*': [
          { title: 'The Great Gatsby', author_name: ['F. Scott Fitzgerald'], edition_count: 500 },
          { title: 'Tender is the Night', author_name: ['F. Scott Fitzgerald'] },
        ],
      }),
    })
    expect(result.matched).toBe(false)
    expect(result.identifiedAuthor).toBe(true)
    expect(result.detection.author).toBe('F. Scott Fitzgerald')
    expect(result.detection.titleAlternates).toContain('The Great Gatsby')
    // The book is not known, and the score must say so.
    expect(result.detection.confidence).toBeLessThan(50)
  })

  it('stops querying as soon as a book is identified', async () => {
    const fetcher = fetcherFor({
      '*': [{ title: 'The Road', author_name: ['Cormac McCarthy'], edition_count: 200 }],
    })
    await identify(page(['THE ROAD']), [hypothesis('The Road', 'Cormac McCarthy')], offlineDetection(), {
      fetcher,
    })
    expect(fetcher.mock.calls.length).toBe(1)
  })

  it('uses the cache instead of the network when the query is remembered', async () => {
    const fetcher = fetcherFor({ '*': [] })
    const store = new Map<string, OpenLibraryDoc[]>()
    const cache = {
      get: async (q: string) => store.get(q),
      set: async (q: string, docs: OpenLibraryDoc[]) => void store.set(q, docs),
    }
    const ocr = page(['THE ROAD'])
    const ranked = [hypothesis('The Road', 'Cormac McCarthy')]
    const [firstQuery] = buildQueries(buildEvidence(ocr, ranked), ocr)
    store.set(firstQuery, [
      { title: 'The Road', author_name: ['Cormac McCarthy'], edition_count: 200 },
    ])
    const result = await identify(ocr, ranked, offlineDetection(), { fetcher, cache })
    expect(result.matched).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports low confidence rather than a wrong book for an unreadable cover', async () => {
    const offline = offlineDetection({ title: 'Nt', confidence: 25 })
    const result = await identify(page(['Nt', 'icy']), [hypothesis('Nt')], offline, {
      fetcher: fetcherFor({ '*': [] }),
    })
    expect(result.matched).toBe(false)
    expect(result.detection.confidence).toBeLessThan(40)
  })
})
