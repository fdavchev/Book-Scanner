import { describe, expect, it, vi } from 'vitest'
import {
  AiOcrError,
  createGeminiClient,
  describeFailure,
  evidenceFromAi,
  extractText,
  parseAiReading,
  readWithAi,
  type AiFailureKind,
} from './ai-ocr'

/** The shape Gemini actually returns, with the model's JSON in a text part. */
function envelope(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const GOOD = {
  title: 'Студија во скарлет',
  author: 'Артур Конан Дојл',
  confidence: 92,
  titleAlternates: ['Скарлет'],
  authorAlternates: ['Конан Дојл'],
  rawText: 'Студија во скарлет\nАртур Конан Дојл',
  reason: 'The largest text on the cover.',
}

const image = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' })

function client(fetcher: typeof fetch) {
  return createGeminiClient({ apiKey: 'test-key', fetcher })
}

describe('parseAiReading', () => {
  it('reads a well-formed response', () => {
    const reading = parseAiReading(JSON.stringify(GOOD))
    expect(reading.title).toBe('Студија во скарлет')
    expect(reading.author).toBe('Артур Конан Дојл')
    expect(reading.confidence).toBe(92)
    expect(reading.titleAlternates).toEqual(['Скарлет'])
  })

  // Asked for as application/json, but a fenced block still happens and is not a reason
  // to throw away a perfectly good reading.
  it('survives a markdown code fence', () => {
    expect(parseAiReading('```json\n' + JSON.stringify(GOOD) + '\n```').title).toBe(
      'Студија во скарлет',
    )
  })

  it('survives a sentence of preamble around the object', () => {
    expect(parseAiReading(`Here is the cover:\n${JSON.stringify(GOOD)}\nHope that helps.`).author)
      .toBe('Артур Конан Дојл')
  })

  it('treats a null title and author as a valid "I do not know"', () => {
    const reading = parseAiReading(
      JSON.stringify({ ...GOOD, title: null, author: null, confidence: 80 }),
    )
    expect(reading.title).toBeNull()
    expect(reading.author).toBeNull()
    // A reading with nothing in it cannot be 80% confident, whatever the model claims.
    expect(reading.confidence).toBe(0)
  })

  it('treats the word "null" and its friends as nothing read', () => {
    for (const word of ['null', 'None', 'n/a', 'UNKNOWN', 'unreadable', '   ']) {
      expect(parseAiReading(JSON.stringify({ ...GOOD, title: word })).title).toBeNull()
    }
  })

  it('rescales a model that answered on 0–1 instead of 0–100', () => {
    expect(parseAiReading(JSON.stringify({ ...GOOD, confidence: 0.85 })).confidence).toBe(85)
  })

  it('clamps a confidence outside the scale', () => {
    expect(parseAiReading(JSON.stringify({ ...GOOD, confidence: 500 })).confidence).toBe(100)
    expect(parseAiReading(JSON.stringify({ ...GOOD, confidence: -20 })).confidence).toBe(0)
    expect(parseAiReading(JSON.stringify({ ...GOOD, confidence: 'lots' })).confidence).toBe(0)
  })

  it('drops alternates that merely repeat the winner, and de-duplicates the rest', () => {
    const reading = parseAiReading(
      JSON.stringify({ ...GOOD, titleAlternates: ['Студија во скарлет', 'Скарлет', 'Скарлет'] }),
    )
    expect(reading.titleAlternates).toEqual(['Скарлет'])
  })

  it('copes with alternates that are not an array', () => {
    const reading = parseAiReading(JSON.stringify({ ...GOOD, titleAlternates: 'Скарлет' }))
    expect(reading.titleAlternates).toEqual([])
  })

  it('rejects text with no JSON object in it', () => {
    expect(() => parseAiReading('I could not read that cover.')).toThrow(AiOcrError)
    expect(() => parseAiReading('')).toThrow(/no JSON object/i)
  })

  it('rejects a truncated response with no closing brace', () => {
    expect(() => parseAiReading('{"title": "Half a')).toThrow(/no JSON object/i)
  })

  it('rejects JSON that will not parse', () => {
    expect(() => parseAiReading('{"title": "Half a", }')).toThrow(/could not parse/i)
  })

  it('unwraps an object the model wrapped in an array', () => {
    expect(parseAiReading(`[${JSON.stringify(GOOD)}]`).title).toBe('Студија во скарлет')
  })
})

describe('extractText', () => {
  it('joins a response split across several parts', () => {
    expect(extractText({ candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] }))
      .toBe('{"a":1}')
  })

  it('returns null for an empty or malformed envelope', () => {
    expect(extractText({})).toBeNull()
    expect(extractText({ candidates: [] })).toBeNull()
    expect(extractText({ candidates: [{ content: {} }] })).toBeNull()
    expect(extractText({ candidates: [{ content: { parts: [{ text: '  ' }] } }] })).toBeNull()
  })
})

describe('the Gemini client', () => {
  it('refuses to exist without a key', () => {
    expect(() => createGeminiClient({ apiKey: '' })).toThrow(AiOcrError)
  })

  it('sends the key in a header and the image inline, and never in the URL', async () => {
    const fetcher = vi.fn(async () => jsonResponse(envelope(JSON.stringify(GOOD))))
    await client(fetcher as unknown as typeof fetch).read(image)

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('test-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key')

    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg')
    expect(body.contents[0].parts[1].inlineData.data).toBeTruthy()
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    // Reading printed text is not a creative task; a stable answer keeps the benchmark
    // reproducible.
    expect(body.generationConfig.temperature).toBe(0)
  })

  it('tells the model that the cover may be Cyrillic', async () => {
    const fetcher = vi.fn(async () => jsonResponse(envelope(JSON.stringify(GOOD))))
    await client(fetcher as unknown as typeof fetch).read(image)
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.contents[0].parts[0].text).toMatch(/macedonian \(cyrillic script\)/i)
    expect(body.contents[0].parts[0].text).toMatch(/returning null is the correct answer/i)
  })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [500, 'server'],
    [503, 'server'],
  ] as [number, AiFailureKind][])('reports HTTP %i as %s', async (status, kind) => {
    const fetcher = vi.fn(async () => new Response('nope', { status }))
    await expect(client(fetcher as unknown as typeof fetch).read(image)).rejects.toMatchObject({
      kind,
    })
  })

  // Google reports a bad key as a 400 with API_KEY_INVALID rather than a 401, so status
  // alone would file the single most likely user error under "server error".
  it('recognises a bad key behind a 400', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }),
    )
    await expect(client(fetcher as unknown as typeof fetch).read(image)).rejects.toMatchObject({
      kind: 'auth',
    })
  })

  it('reports a 400 that is not about the key as a server error', async () => {
    const fetcher = vi.fn(async () => new Response('bad image', { status: 400 }))
    await expect(client(fetcher as unknown as typeof fetch).read(image)).rejects.toMatchObject({
      kind: 'server',
    })
  })

  it('reports a timeout as a timeout, not as a network failure', async () => {
    const fetcher = vi.fn(async () => {
      const err = new Error('timed out')
      err.name = 'TimeoutError'
      throw err
    })
    await expect(client(fetcher as unknown as typeof fetch).read(image)).rejects.toMatchObject({
      kind: 'timeout',
    })
  })

  it('reports a dropped connection as a network failure', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(client(fetcher as unknown as typeof fetch).read(image)).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('reports an unparseable body as malformed', async () => {
    const fetcher = vi.fn(async () => new Response('not json at all', { status: 200 }))
    await expect(client(fetcher as unknown as typeof fetch).read(image)).rejects.toMatchObject({
      kind: 'malformed',
    })
  })

  it('reports an envelope with no text part as malformed', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ candidates: [] }))
    await expect(client(fetcher as unknown as typeof fetch).read(image)).rejects.toMatchObject({
      kind: 'malformed',
    })
  })

  it('gives up when the caller aborts', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort()
      const err = new Error('aborted')
      err.name = 'AbortError'
      expect(init?.signal?.aborted).toBe(true)
      throw err
    })
    await expect(
      client(fetcher as unknown as typeof fetch).read(image, { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('readWithAi', () => {
  it('produces the same Detection shape the OCR path produces', async () => {
    const fetcher = vi.fn(async () => jsonResponse(envelope(JSON.stringify(GOOD))))
    const { detection, rawText } = await readWithAi(client(fetcher as unknown as typeof fetch), image)

    expect(detection).toEqual({
      title: 'Студија во скарлет',
      author: 'Артур Конан Дојл',
      confidence: 92,
      reason: 'The largest text on the cover.',
      titleAlternates: ['Скарлет'],
      authorAlternates: ['Конан Дојл'],
      source: 'ai',
    })
    expect(rawText).toBe(GOOD.rawText)
  })

  // A null is a valid answer, not a failure: the review screen catches it, and that is
  // far cheaper than a confidently invented book.
  it('turns a "could not read it" into an empty, zero-confidence detection', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        envelope(
          JSON.stringify({
            title: null,
            author: null,
            confidence: 0,
            titleAlternates: [],
            authorAlternates: [],
            rawText: '',
            reason: 'The photograph is too blurred to read.',
          }),
        ),
      ),
    )
    const { detection } = await readWithAi(client(fetcher as unknown as typeof fetch), image)
    expect(detection.title).toBe('')
    expect(detection.author).toBe('')
    expect(detection.confidence).toBe(0)
    expect(detection.source).toBe('ai')
  })
})

describe('evidenceFromAi', () => {
  const detection = {
    title: 'Дом од песок',
    author: 'Ана Петровска',
    confidence: 88,
    reason: 'The largest text on the cover.',
    titleAlternates: ['Песок', 'Дом'],
    authorAlternates: [],
    source: 'ai' as const,
  }

  it('presents the raw text as lines, so the noise filter still applies', () => {
    const { result } = evidenceFromAi('Дом од песок\nАна Петровска\nA NOVEL', detection)
    expect(result.lines.map((l) => l.text)).toEqual(['Дом од песок', 'Ана Петровска', 'A NOVEL'])
    expect(result.text).toBe('Дом од песок\nАна Петровска\nA NOVEL')
  })

  it('drops blank lines and trims, so a stray newline is not a line', () => {
    const { result } = evidenceFromAi('  Дом од песок  \n\n\n  Ана Петровска\n', detection)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].text).toBe('Дом од песок')
  })

  it('leads with the reading itself, then the alternates it offered', () => {
    const { ranked } = evidenceFromAi('x', detection)
    expect(ranked[0].title).toBe('Дом од песок')
    expect(ranked[0].score).toBeCloseTo(0.88)
    expect(ranked.slice(1).map((h) => h.title)).toEqual(['Песок', 'Дом'])
    // Alternates must rank below the primary reading, never above it.
    for (const alternate of ranked.slice(1)) {
      expect(alternate.score).toBeLessThan(ranked[0].score)
    }
  })

  // `identify.ts` only lets a *confidently read* author contradict a catalogue entry, and
  // it reads that confidence off the hypothesis rather than the detection.
  it('carries the confidence onto the author, so the catalogue step can weigh it', () => {
    expect(evidenceFromAi('x', detection).ranked[0].authorConfidence).toBe(88)
    expect(
      evidenceFromAi('x', { ...detection, confidence: 10 }).ranked[0].authorConfidence,
    ).toBe(10)
  })

  it('copes with a reading that found nothing at all', () => {
    const { result, ranked } = evidenceFromAi('', {
      ...detection,
      title: '',
      author: '',
      confidence: 0,
      titleAlternates: [],
    })
    expect(result.lines).toEqual([])
    expect(ranked).toHaveLength(1)
    expect(ranked[0].score).toBe(0)
  })
})

describe('describeFailure', () => {
  it('has plain-English text for every failure kind', () => {
    const kinds: AiFailureKind[] = [
      'no-key',
      'timeout',
      'auth',
      'rate-limit',
      'server',
      'network',
      'malformed',
    ]
    for (const kind of kinds) expect(describeFailure(kind).length).toBeGreaterThan(10)
    expect(describeFailure('auth')).toMatch(/settings/i)
  })
})
