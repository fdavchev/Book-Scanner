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

/**
 * Tried, in order, if `GEMINI_MODEL` stops existing (Google retires versioned models
 * periodically). Each entry here is a real network request on top of the first, so keep
 * this short — it is a safety net for "the pinned model was retired", not a general retry
 * mechanism. `gemini-flash-latest` is Google's floating alias: not meant for production,
 * but reasonable as a last resort so the AI path recovers on its own instead of silently
 * reverting to on-device reading forever until someone notices and edits this file.
 */
export const GEMINI_MODEL_FALLBACKS = ['gemini-flash-latest']

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * The total budget for one photo, across every attempt.
 *
 * This used to be applied per attempt, inside the model-fallback loop — so a photo could
 * spend this long on the pinned model and then the same again on the fallback before
 * giving up, and a four-photo batch had a worst case measured in minutes. The budget is
 * now started once per `read()` and shared: both model attempts and any rate-limit retry
 * draw from the same 30 seconds, so the worst case is bounded by this number rather than
 * by a multiple of it.
 */
export const AI_TIMEOUT_MS = 30_000

/**
 * How many tokens of hidden reasoning the model may spend before answering. Zero.
 *
 * Recent Flash models reason internally by default. That is the right default for most
 * callers and the wrong one here: the title is printed on the cover in large type, there
 * is nothing to reason about, and every thinking token is latency the user waits through
 * and tokens they pay for, producing no visible output.
 *
 * The field name for this control has changed across model generations, so a model that
 * rejects it is an expected case rather than a bug: the client notices, drops the field
 * and retries once — see `thinkingSupported` in `createGeminiClient`. To confirm it is
 * actually taking effect, watch `usage.thoughtsTokens` on the returned reading; it should
 * be 0.
 */
export const AI_THINKING_BUDGET = 0

/**
 * Ceiling on the answer, guarding against one cluttered cover generating for ever.
 *
 * Generous on purpose. A truncated response is not a shorter answer — it is invalid JSON,
 * which `parseAiReading` rejects, so the photo falls back to on-device reading having paid
 * the full network cost for nothing. With `rawText` capped in the prompt, a normal reading
 * is a few hundred tokens, so this is several times the headroom it needs.
 *
 * Only sent alongside a thinking budget: on some model generations thinking tokens count
 * against this same ceiling, and a limit tuned for the answer alone would starve them.
 */
export const AI_MAX_OUTPUT_TOKENS = 1536

/**
 * Backoff before retrying a rate-limited or overloaded request, doubled on each step.
 *
 * A 429 or a 503 "high demand" is transient — Google is telling you to come back shortly,
 * not that the request was wrong. Giving up on it costs the better reading for that photo,
 * so it is worth one retry inside the photo's existing budget. A `Retry-After` header, if
 * present, wins over this.
 */
export const AI_RETRY_BACKOFF_MS = 900
export const AI_MAX_RETRIES = 1

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

/**
 * What the call actually cost, read straight off the response's `usageMetadata`.
 *
 * Surfaced rather than logged because it is the only way to tell the three causes of a
 * slow call apart: `thoughtsTokens` high means the model is thinking (it should be 0 —
 * see `AI_THINKING_BUDGET`), `outputTokens` high means the answer itself is long, and both
 * low while the call is still slow means the network or Google's queue. Guessing between
 * those three wastes far more time than carrying the numbers around.
 */
export interface AiUsage {
  promptTokens?: number
  outputTokens?: number
  thoughtsTokens?: number
  totalTokens?: number
  /** Wall-clock time of the request that produced the answer. */
  ms?: number
  /** Which model answered — the pinned one, or a fallback if it had been retired. */
  model?: string
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
  /** What the call cost and how long it took. Absent when the response omitted it. */
  usage?: AiUsage
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
- rawText: the cover's own text - title, author, series, subtitle - in reading order, newline
  separated. Keep this under 200 characters: it exists to identify the book, not to
  transcribe the cover. Leave out blurbs, review quotes and back-cover paragraphs.
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

/**
 * True only for "this model id does not exist / is no longer available" — Google's
 * retirement message, as opposed to any other 404 (a typo in the endpoint, a routing
 * problem, etc). Narrow on purpose: this is the one case worth silently retrying with a
 * different model, and it should not swallow errors that mean something else.
 */
function isModelRetired(status: number, body: string): boolean {
  if (status !== 404) return false
  return /model|no longer available|not_found/i.test(body)
}

/**
 * A transient "come back shortly" rather than "your request was wrong".
 *
 * 429 is the documented rate limit; 503 is the "model is overloaded / high demand" that a
 * free-tier key sees when Google is busy. Both are worth one retry — the request itself is
 * fine. 500 and 502 are included because they are retried by every Google client library,
 * but 501 and 505 are not: those mean the request will never work.
 */
function isTransient(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

/**
 * True when a 400 is complaining specifically about the thinking control.
 *
 * The name of this field has changed across model generations, so "this model does not
 * accept that field" is an expected answer, not a failure — the client drops it and retries
 * once. Deliberately narrow: a 400 about anything else must not be silently retried.
 */
function isThinkingRejected(status: number, body: string): boolean {
  if (status !== 400) return false
  return /thinking|thought|thinking_config|thinkingConfig|thinkingBudget|thinking_budget/i.test(body)
}

/** Reads `Retry-After`, which may be seconds or an HTTP date. Undefined when absent or junk. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers?.get?.('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

function readUsage(payload: unknown): AiUsage {
  const meta = (payload as { usageMetadata?: Record<string, unknown> }).usageMetadata
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  if (!meta) return {}
  return {
    promptTokens: num(meta.promptTokenCount),
    outputTokens: num(meta.candidatesTokenCount),
    thoughtsTokens: num(meta.thoughtsTokenCount),
    totalTokens: num(meta.totalTokenCount),
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface GeminiOptions {
  apiKey: string
  model?: string
  /** Overrides the built-in retirement fallback list. Exposed for tests. */
  fallbackModels?: string[]
  fetcher?: Fetcher
  /** Total budget for one photo, shared across every attempt. */
  timeoutMs?: number
  endpoint?: string
  /** Thinking tokens the model may spend. 0 disables it. Exposed for tests. */
  thinkingBudget?: number
  /** Retries for a transient 429/503, within the same budget. Exposed for tests. */
  maxRetries?: number
  /** Base backoff before a transient retry, doubled per step. Exposed for tests. */
  retryBackoffMs?: number
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
  fallbackModels = GEMINI_MODEL_FALLBACKS,
  fetcher = fetch,
  timeoutMs = AI_TIMEOUT_MS,
  endpoint = GEMINI_ENDPOINT,
  thinkingBudget = AI_THINKING_BUDGET,
  maxRetries = AI_MAX_RETRIES,
  retryBackoffMs = AI_RETRY_BACKOFF_MS,
}: GeminiOptions): AiClient {
  if (!apiKey) throw new AiOcrError('no-key', 'No Gemini API key configured')

  // The pinned model first, then whichever fallbacks aren't already that same model.
  const models = [model, ...fallbackModels.filter((m) => m !== model)]

  // Sticky for the life of the client. Once a model has told us it does not accept the
  // thinking control, asking again on every subsequent photo would waste a request per
  // photo re-learning the same thing.
  let thinkingSupported = true

  /** Raised internally when a 400 says the thinking field is not accepted. */
  class ThinkingRejectedError extends Error {}

  async function attempt(
    currentModel: string,
    image: { mimeType: string; data: string },
    signal: AbortSignal,
  ): Promise<AiReading> {
    const generationConfig: Record<string, unknown> = {
      // Reading printed text is not a creative task, and a stable answer makes the
      // benchmark reproducible.
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: AI_SCHEMA,
    }
    if (thinkingSupported) {
      generationConfig.thinkingConfig = { thinkingBudget }
      // Paired with the thinking budget on purpose — see AI_MAX_OUTPUT_TOKENS.
      generationConfig.maxOutputTokens = AI_MAX_OUTPUT_TOKENS
    }

    const body = {
      contents: [{ parts: [{ text: AI_PROMPT }, { inlineData: image }] }],
      generationConfig,
    }

    const started = Date.now()
    let response: Response
    try {
      response = await fetcher(`${endpoint}/${currentModel}:generateContent`, {
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
      if (isModelRetired(response.status, text)) {
        // A distinct, non-AiOcrError signal so the caller's loop can tell "try the next
        // model" apart from every other failure, which should fall back to on-device
        // reading immediately rather than spend a second request on it.
        throw new ModelRetiredError(currentModel)
      }
      if (thinkingSupported && isThinkingRejected(response.status, text)) {
        // This model generation names the control differently, or does not have one.
        // Remember that and retry without it rather than losing the reading over it.
        thinkingSupported = false
        throw new ThinkingRejectedError(currentModel)
      }
      const error = new AiOcrError(
        classifyStatus(response.status, text),
        `Gemini returned ${response.status}`,
      )
      if (isTransient(response.status)) {
        transientHint = retryAfterMs(response)
        throw Object.assign(error, { transient: true })
      }
      throw error
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new AiOcrError('malformed', 'Gemini returned a body that was not JSON')
    }

    // A response cut off at the token ceiling is not a short answer, it is invalid JSON.
    // Saying so plainly beats letting parseAiReading report a mystery parse failure.
    const finish = (payload as { candidates?: { finishReason?: string }[] }).candidates?.[0]
      ?.finishReason
    if (finish === 'MAX_TOKENS') {
      throw new AiOcrError(
        'malformed',
        `Gemini hit the ${AI_MAX_OUTPUT_TOKENS}-token ceiling before finishing its answer`,
      )
    }

    const text = extractText(payload)
    if (text === null) throw new AiOcrError('malformed', 'Gemini returned no text part')
    const reading = parseAiReading(text)
    return {
      ...reading,
      usage: { ...readUsage(payload), ms: Date.now() - started, model: currentModel },
    }
  }

  /** Set by `attempt` from a Retry-After header, consumed by the retry loop below. */
  let transientHint: number | undefined

  return {
    async read(image, options = {}) {
      const encoded = {
        mimeType: image.type || 'image/jpeg',
        data: await toBase64(image),
      }

      // One deadline for the whole photo, started here and shared by every attempt below:
      // the two models, the thinking-rejected retry, and any transient backoff all draw
      // from it. Previously each attempt got a fresh `timeoutMs`, so the real worst case
      // was a multiple of the number everyone read as the limit.
      const deadline = Date.now() + timeoutMs
      const remaining = () => deadline - Date.now()

      const signalFor = (): AbortSignal => {
        const left = remaining()
        if (left <= 0) {
          throw new AiOcrError('timeout', `Gemini did not answer within ${timeoutMs} ms`)
        }
        const timeout = AbortSignal.timeout(left)
        return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      }

      let lastError: unknown
      for (const currentModel of models) {
        let retries = 0
        // Retries for this model: a transient 429/503, and a one-off retry when the model
        // turns out not to accept the thinking control.
        for (;;) {
          try {
            return await attempt(currentModel, encoded, signalFor())
          } catch (err) {
            if (err instanceof ThinkingRejectedError) {
              // `thinkingSupported` is already false; the next attempt omits the field.
              // Not counted against `retries` — nothing was wrong with the request itself.
              continue
            }
            if (err instanceof ModelRetiredError) {
              lastError = new AiOcrError('server', `Gemini returned 404 for ${currentModel}`)
              break
            }
            const transient = (err as { transient?: boolean }).transient === true
            const backoff = transientHint ?? retryBackoffMs * 2 ** retries
            transientHint = undefined
            // Only worth waiting if the answer can still arrive inside the budget.
            if (transient && retries < maxRetries && remaining() > backoff + 1000) {
              retries += 1
              await sleep(backoff)
              continue
            }
            throw err
          }
        }
        // `break` above lands here: this model is retired, try the next one.
      }
      // Every model in the list, including the fallback, is retired or unreachable.
      throw lastError instanceof Error
        ? lastError
        : new AiOcrError('server', 'No configured Gemini model is available')
    },
  }
}

/** Internal-only: signals "this model id doesn't exist", never seen outside this file. */
class ModelRetiredError extends Error {
  readonly model: string
  constructor(model: string) {
    super(`Model ${model} is retired or unavailable`)
    this.model = model
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
): Promise<{ detection: Detection; rawText: string; usage?: AiUsage }> {
  const reading = await client.read(image, options)
  return {
    usage: reading.usage,
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