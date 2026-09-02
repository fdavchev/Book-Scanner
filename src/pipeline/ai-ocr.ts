/**
 * The AI reading path: a cover photo goes to Gemini, a title and author come back.
 *
 * This exists because tesseract is weak on Macedonian Cyrillic display type — measured, not
 * assumed, in `docs/accuracy-mk-offline.md`. It is a *second* reader, never a replacement:
 * `route.ts` decides which one runs, and every failure here falls back to the on-device
 * pipeline, so the app keeps working with the network off.
 *
 * The client is injectable for the same reason `ocr.ts` and `enrich.ts` inject theirs —
 * every rule in this file is unit-tested against canned responses, with no network and no
 * API key.
 */
import type { Detection, Hypothesis, OcrResult } from './types'

/** One constant to change when a newer Flash model is worth moving to. */
export const GEMINI_MODEL = 'gemini-3.6-flash'

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Long enough for a slow phone on mobile data, short enough that a dead connection does
 * not hold up a four-photo batch. On timeout the photo falls back to tesseract.
 */
export const AI_TIMEOUT_MS = 10_000

/** Why the AI path could not be used. Each one falls back; only `auth` is worth showing. */
export type AiFailureKind =
  | 'no-key'
  | 'timeout'
  | 'auth'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'malformed'

export class AiOcrError extends Error {
  readonly kind: AiFailureKind

  constructor(kind: AiFailureKind, message: string) {
    super(message)
    this.name = 'AiOcrError'
    this.kind = kind
  }
}

/** Plain-English text for the settings screen; the scan flow never surfaces these. */
export function describeFailure(kind: AiFailureKind): string {
  switch (kind) {
    case 'no-key':
      return 'No Gemini API key is set, so AI reading is off.'
    case 'auth':
      return 'Google rejected that API key. Check it in Settings — until it works, every scan quietly uses on-device reading instead.'
    case 'rate-limit':
      return 'That key has hit its Google quota for now. Scanning carries on using on-device reading.'
    case 'timeout':
      return 'Gemini did not answer in time, so the cover was read on the device instead.'
    case 'server':
      return 'Google returned an error, so the cover was read on the device instead.'
    case 'malformed':
      return 'Gemini answered with something this app could not read, so the cover was read on the device instead.'
    case 'network':
      return 'Gemini could not be reached, so the cover was read on the device instead.'
  }
}

/** What the model is asked to return. Nulls are wanted — see the prompt. */
export interface AiReading {
  title: string | null
  author: string | null
  /** 0–100, the same scale the OCR path reports. */
  confidence: number
  titleAlternates: string[]
  authorAlternates: string[]
  /** Every word the model could read off the cover, kept on the book record. */
  rawText: string
  reason: string
}

export interface AiClient {
  read(image: Blob, options?: { signal?: AbortSignal }): Promise<AiReading>
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

// ------------------------------------------------------------------ the prompt

/**
 * The instruction, written around the one failure mode that matters.
 *
 * The app's own accuracy metric is "confidently wrong" — a wrong book reported at 60% or
 * more, because those are the answers a person accepts without looking. A null costs a
 * few seconds at the review step; a confident invention gets saved. So the model is told,
 * explicitly, that returning nothing is the correct answer when it cannot read the cover.
 */
export const AI_PROMPT = `You are reading the front cover of a physical book from a photograph.

The text may be in Macedonian (Cyrillic script) or in English. Do not assume Latin script,
and do not transliterate: return the title and author exactly as they are printed, in the
script they are printed in.

Return:
- title: the book's title as printed on the cover.
- author: the author's name as printed on the cover.
- confidence: 0-100, how sure you are that BOTH the title and the author are correct.
- titleAlternates: other lines on the cover that could plausibly be the title, best first.
- authorAlternates: other lines that could plausibly be the author, best first.
- rawText: every piece of text you can read on the cover, in reading order, newline separated.
- reason: one short sentence, in plain English, saying how you decided.

Rules:
- If you cannot read the title, return null for title. If you cannot read the author,
  return null for author. Returning null is the correct answer when you are unsure.
- Never guess a book you think it might be from partial text, and never complete a title or
  a name from your own knowledge of publishing. Report only what is legibly printed.
- Ignore cover furniture: "A NOVEL", prize and bestseller flashes, blurbs, review quotes,
  series names, publisher and imprint names, prices, barcodes and ISBNs.
- If the photograph is too blurred, too dark or too small to read, return null for both
  title and author, set confidence to 0, and say so in reason.`

/** Gemini's structured-output schema, mirroring `AiReading` field for field. */
export const AI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', nullable: true },
    author: { type: 'STRING', nullable: true },
    confidence: { type: 'INTEGER' },
    titleAlternates: { type: 'ARRAY', items: { type: 'STRING' } },
    authorAlternates: { type: 'ARRAY', items: { type: 'STRING' } },
    rawText: { type: 'STRING' },
    reason: { type: 'STRING' },
  },
  required: [
    'title',
    'author',
    'confidence',
    'titleAlternates',
    'authorAlternates',
    'rawText',
    'reason',
  ],
} as const

// ------------------------------------------------------------------ defensive parsing

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  // Models return the *word* null as readily as the value, and both mean "I don't know".
  if (!trimmed || /^(null|none|n\/a|unknown|unreadable)$/i.test(trimmed)) return null
  return trimmed
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of value) {
    const text = asString(entry)
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    out.push(text)
  }
  return out
}

function asConfidence(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  // A model that reads the scale as 0–1 is a real and silent way to report 0.85 as 1%.
  const scaled = number > 0 && number <= 1 ? number * 100 : number
  return Math.max(0, Math.min(100, Math.round(scaled)))
}

/**
 * Pulls the JSON object out of whatever the model actually sent.
 *
 * `responseMimeType: application/json` is asked for, but it is a request rather than a
 * guarantee: a fenced ```json block, a sentence of preamble, or the object wrapped in a
 * one-element array all still happen, and none of them is a reason to throw away a good
 * reading. Slicing from the first `{` to the last `}` absorbs all three.
 */
export function parseAiReading(raw: string): AiReading {
  const unfenced = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new AiOcrError('malformed', 'The model returned no JSON object')
  }

  // The slice starts at `{` and ends at `}`, so JSON.parse either yields an object or
  // throws — there is no third case to guard against here.
  let record: Record<string, unknown>
  try {
    record = JSON.parse(unfenced.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new AiOcrError('malformed', 'The model returned JSON this app could not parse')
  }

  const title = asString(record.title)
  const author = asString(record.author)
  return {
    title,
    author,
    // A reading with nothing in it is a 0 whatever the model claims about itself.
    confidence: title || author ? asConfidence(record.confidence) : 0,
    titleAlternates: asStringList(record.titleAlternates).filter((a) => a !== title),
    authorAlternates: asStringList(record.authorAlternates).filter((a) => a !== author),
    rawText: asString(record.rawText) ?? '',
    reason: asString(record.reason) ?? 'Read from the cover by Gemini.',
  }
}

// ------------------------------------------------------------------ the Gemini client

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // Chunked, because spreading a megabyte of bytes into String.fromCharCode in one call
  // overflows the argument stack on Safari.
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function classifyStatus(status: number, body: string): AiFailureKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'server'
  // Google reports a bad key as a 400 with API_KEY_INVALID rather than a 401, so the
  // status alone would file the single most likely user error under "server error".
  if (status === 400 && /api.?key|credential|unauthenticated|permission/i.test(body)) return 'auth'
  return 'server'
}

export interface GeminiOptions {
  apiKey: string
  model?: string
  fetcher?: Fetcher
  timeoutMs?: number
  endpoint?: string
}

/**
 * A Gemini Flash client, called straight from the browser with the user's own key.
 *
 * Flash rather than Pro deliberately: reading large type off a cover is not a reasoning
 * problem, and a scan of four books should feel immediate.
 */
export function createGeminiClient({
  apiKey,
  model = GEMINI_MODEL,
  fetcher = fetch,
  timeoutMs = AI_TIMEOUT_MS,
  endpoint = GEMINI_ENDPOINT,
}: GeminiOptions): AiClient {
  if (!apiKey) throw new AiOcrError('no-key', 'No Gemini API key configured')

  return {
    async read(image, options = {}) {
      const body = {
        contents: [
          {
            parts: [
              { text: AI_PROMPT },
              {
                inlineData: {
                  mimeType: image.type || 'image/jpeg',
                  data: await toBase64(image),
                },
              },
            ],
          },
        ],
        generationConfig: {
          // Reading printed text is not a creative task, and a stable answer makes the
          // benchmark reproducible.
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: AI_SCHEMA,
        },
      }

      const timeout = AbortSignal.timeout(timeoutMs)
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout

      let response: Response
      try {
        response = await fetcher(`${endpoint}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal,
        })
      } catch (err) {
        const name = err instanceof Error ? err.name : ''
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new AiOcrError('timeout', `Gemini did not answer within ${timeoutMs} ms`)
        }
        throw new AiOcrError('network', err instanceof Error ? err.message : String(err))
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new AiOcrError(
          classifyStatus(response.status, text),
          `Gemini returned ${response.status}`,
        )
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new AiOcrError('malformed', 'Gemini returned a body that was not JSON')
      }

      const text = extractText(payload)
      if (text === null) throw new AiOcrError('malformed', 'Gemini returned no text part')
      return parseAiReading(text)
    },
  }
}

/** Digs the model's text out of the candidates envelope, tolerating a split response. */
export function extractText(payload: unknown): string | null {
  const candidates = (payload as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts
  if (!Array.isArray(parts)) return null
  const text = parts
    .map((part) => (part as { text?: unknown }).text)
    .filter((value): value is string => typeof value === 'string')
    .join('')
  return text.trim() ? text : null
}

// ------------------------------------------------------------------ into the pipeline

/**
 * Turns an AI reading back into the evidence shape the catalogue step expects.
 *
 * `identify.ts` scores a catalogue entry against every word the cover was read to contain,
 * and the AI path has exactly that in `rawText`. Presenting it as lines keeps the noise
 * filter — blurbs, imprints, "A NOVEL" — working on the AI path too, so neither reader
 * gets to corroborate a book with a review quote.
 */
export function evidenceFromAi(
  rawText: string,
  detection: Detection,
): { result: OcrResult; ranked: Hypothesis[] } {
  const texts = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const empty = { x0: 0, y0: 0, x1: 0, y1: 0 }
  const ranked: Hypothesis[] = [
    {
      title: detection.title,
      author: detection.author,
      score: detection.confidence / 100,
      reason: detection.reason,
      authorConfidence: detection.confidence,
    },
    // The runner-ups the model offered, so a query can still be built from them when the
    // first reading finds nothing in the catalogue.
    ...detection.titleAlternates.slice(0, 2).map((title) => ({
      title,
      author: detection.author,
      score: Math.max(0, detection.confidence - 20) / 100,
      reason: 'An alternative reading offered by the AI.',
      authorConfidence: detection.confidence,
    })),
  ]
  return {
    result: {
      lines: texts.map((text) => ({
        text,
        confidence: detection.confidence,
        bbox: empty,
        words: [],
      })),
      text: rawText,
      // The AI path never measures the page, and nothing in `identify.ts` reads these.
      width: 0,
      height: 0,
      meanConfidence: detection.confidence,
    },
    ranked,
  }
}

/**
 * Runs the AI reader and returns the same `Detection` the OCR path produces.
 *
 * Keeping this contract identical is the whole design: `group.ts`, `identify.ts`, the
 * review screen and storage cannot tell which reader ran, and none of them needed changing.
 */
export async function readWithAi(
  client: AiClient,
  image: Blob,
  options: { signal?: AbortSignal } = {},
): Promise<{ detection: Detection; rawText: string }> {
  const reading = await client.read(image, options)
  return {
    detection: {
      title: reading.title ?? '',
      author: reading.author ?? '',
      confidence: reading.confidence,
      reason: reading.reason,
      titleAlternates: reading.titleAlternates,
      authorAlternates: reading.authorAlternates,
      source: 'ai',
    },
    rawText: reading.rawText,
  }
}
