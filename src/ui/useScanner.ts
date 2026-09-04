import { useCallback, useRef, useState } from 'react'
import { assessQuality, prepare } from '../pipeline/preprocess'
import { TesseractPool, readImage, type LanguageCode } from '../pipeline/ocr'
import { detect, hypotheses } from '../pipeline/candidates'
import { shouldLookUp } from '../pipeline/enrich'
import { identify } from '../pipeline/identify'
import type { OpenLibraryDoc } from '../pipeline/enrich'
import { groupDetections, type ReviewItem, type ScannedImage } from '../pipeline/group'
import { createLookupCache, type LookupMode } from '../storage/db'
import { chooseReader, type AiMode, type ReaderChoice } from '../pipeline/route'
import {
  AiOcrError,
  createGeminiClient,
  describeFailure,
  evidenceFromAi,
  readWithAi,
  type AiClient,
  type AiFailureKind,
  type AiUsage,
} from '../pipeline/ai-ocr'
import type { Detection, Hypothesis, OcrResult } from '../pipeline/types'

export type JobStage = 'queued' | 'preparing' | 'reading' | 'matching' | 'done' | 'failed'

export interface ScanJob {
  id: string
  name: string
  stage: JobStage
  /** 0–1 within the current stage, when it is known. */
  progress?: number
  detail?: string
  title?: string
  confidence?: number
  /** Which reader actually produced the result, after any fallback. */
  reader?: ReaderChoice
  /** Set when the AI path was tried and failed, so the card can say why it fell back. */
  fellBack?: string
  /** Advice about the photo itself, when it is the problem. */
  warnings?: string[]
  error?: string
  /** How long this photo took end to end, from decode to detection. */
  ms?: number
  /**
   * What the AI call cost, when there was one. Shown on the card rather than logged: the
   * three causes of a slow scan — thinking, a long answer, and the network — are otherwise
   * indistinguishable, and they call for different fixes.
   */
  usage?: AiUsage
}

export interface ScanOptions {
  languages: LanguageCode[]
  lookupMode: LookupMode
  online: boolean
  aiMode: AiMode
  apiKey: string
}

export interface ScannerApi {
  jobs: ScanJob[]
  running: boolean
  loadingEngine?: number
  error?: string
  /**
   * The last AI failure worth acting on. Only `auth` and `rate-limit` reach here; the rest
   * fall back silently, which is the whole point of the design.
   */
  aiFailure?: AiFailureKind
  scan: (files: File[], options: ScanOptions) => Promise<ReviewItem[]>
  reset: () => void
}

const STAGE_DETAIL: Record<JobStage, string> = {
  queued: 'waiting',
  preparing: 'checking the photo',
  reading: 'reading the cover',
  matching: 'checking the catalogue',
  done: 'done',
  failed: 'failed',
}

/**
 * Drives a batch of photos through the pipeline.
 *
 * Images are processed strictly one at a time. On a phone that is not a limitation but
 * the point: iOS Safari enforces a per-tab memory ceiling, and decoding a whole gallery
 * selection at once is the reliable way to have the tab killed mid-scan.
 *
 * The AI calls are sequential for the same reason, though the margin is now wider than it
 * was: deferring `binarised` and `flattened` took ~13 MB per in-flight photo off the heap,
 * so a photo waiting on Gemini pins `raw`, `grayscale` and the small pair rather than six
 * full buffers. Overlapping requests is therefore closer to safe than it used to be — but
 * it is still several photos' worth of decoded `ImageData` held at once purely so the
 * tesseract fallback has something to read, and that is the failure that kills the tab
 * outright rather than merely making a scan slow. Measure the ceiling before trading it.
 */
export function useScanner(): ScannerApi {
  const [jobs, setJobs] = useState<ScanJob[]>([])
  const [running, setRunning] = useState(false)
  const [loadingEngine, setLoadingEngine] = useState<number>()
  const [error, setError] = useState<string>()
  const [aiFailure, setAiFailure] = useState<AiFailureKind>()
  const poolRef = useRef<TesseractPool>(null)
  const poolLanguagesRef = useRef<string>('')
  // The in-flight creation, so a background warm-up and a later fallback share one download.
  const poolPromiseRef = useRef<Promise<TesseractPool> | null>(null)
  // Engine download progress is always recorded; whether it is shown depends on whether
  // anything is actually waiting for it. See `ensurePool` / `warmPool`.
  const engineProgressRef = useRef(0)
  const showEngineProgressRef = useRef(false)
  // One cache for the life of the app: scanning a shelf asks the catalogue the same
  // questions repeatedly, and a remembered answer needs no network at all.
  const cacheRef = useRef(createLookupCache<OpenLibraryDoc>())

  const reset = useCallback(() => {
    setJobs([])
    setError(undefined)
    setAiFailure(undefined)
  }, [])

  const update = useCallback((id: string, changes: Partial<ScanJob>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...changes } : job)))
  }, [])

  const scan = useCallback(
    async (files: File[], options: ScanOptions): Promise<ReviewItem[]> => {
      setError(undefined)
      setAiFailure(undefined)
      setRunning(true)
      const initial: ScanJob[] = files.map((file, i) => ({
        id: `${Date.now()}-${i}`,
        name: file.name || `Photo ${i + 1}`,
        stage: 'queued',
      }))
      setJobs(initial)

      /**
       * The OCR engine is booted on demand rather than up front.
       *
       * A batch read entirely by Gemini should never pay for a tesseract worker pool — on a
       * cold install that pool is a 30 MB download. It is still created the instant one
       * photo needs it, including a photo that needs it only because the AI call failed
       * halfway through the batch.
       *
       * The in-flight promise is held, not just the finished pool, so that starting it in
       * the background (see `warmPool`) and then awaiting it on the fallback path share one
       * download rather than racing to create two.
       */
      const languageKey = options.languages.join('+')
      // Whether anyone is actually waiting on the engine. A background warm-up must not put
      // a progress bar on screen — the user is watching an AI scan, and "starting the text
      // recogniser" would be a lie about what is happening — but if the fallback later ends
      // up waiting on that same download, the bar has to appear mid-flight. So progress is
      // always recorded and only conditionally displayed.
      engineProgressRef.current = 0
      showEngineProgressRef.current = false

      const startPool = (): Promise<TesseractPool> => {
        poolLanguagesRef.current = languageKey
        const previous = poolRef.current
        const promise = (async () => {
          await previous?.terminate()
          const pool = await TesseractPool.create(options.languages, undefined, (fraction) => {
            engineProgressRef.current = fraction
            if (showEngineProgressRef.current) setLoadingEngine(fraction)
          })
          poolRef.current = pool
          setLoadingEngine(undefined)
          return pool
        })()
        poolPromiseRef.current = promise
        // A failed warm-up must not poison the fallback path — drop it so the real call
        // retries, where its error is surfaced properly instead of silently reused.
        promise.catch(() => {
          if (poolPromiseRef.current === promise) {
            poolPromiseRef.current = null
            poolLanguagesRef.current = ''
          }
        })
        return promise
      }

      const ensurePool = (): Promise<TesseractPool> => {
        const ready = poolPromiseRef.current && poolLanguagesRef.current === languageKey
        // Someone is waiting now, so show whatever the download has reached — including a
        // warm-up already in flight, which would otherwise finish behind a frozen bar.
        showEngineProgressRef.current = true
        if (!poolRef.current) setLoadingEngine(engineProgressRef.current)
        return ready ? poolPromiseRef.current! : startPool()
      }

      /**
       * Starts the engine download alongside the first AI request, without waiting for it.
       *
       * Without this the failure path is three waits stacked: the full AI timeout, then a
       * ~30 MB engine download the user never expected, then the OCR read itself. Starting
       * it now means the download overlaps the network wait, and costs nothing when the AI
       * call succeeds — a warmed pool is simply left unused.
       */
      const warmPool = () => {
        if (poolPromiseRef.current && poolLanguagesRef.current === languageKey) return
        startPool().catch(() => {
          // Nothing to report: this is speculative work, and the fallback path surfaces any
          // real failure when it actually needs the engine.
        })
      }

      let ai: AiClient | undefined
      if (options.apiKey) {
        try {
          ai = createGeminiClient({ apiKey: options.apiKey })
        } catch {
          // A key that cannot even build a client is the same as no key at all.
          ai = undefined
        }
      }

      try {
        const scanned: ScannedImage[] = []
        for (const [index, file] of files.entries()) {
          const job = initial[index]
          const startedAt = Date.now()
          try {
            update(job.id, { stage: 'preparing', detail: STAGE_DETAIL.preparing })

            // Decided before the photo is decoded, not after: the routing inputs are the
            // mode, the key and connectivity, none of which depend on the image. Knowing
            // it first lets `prepare` produce the scaled upload frame from the bitmap it
            // already has open, and skip it entirely on an on-device scan.
            const wanted = chooseReader({
              mode: options.aiMode,
              hasKey: Boolean(ai),
              online: options.online,
            })

            const prepared = await prepare(file, undefined, undefined, {
              aiFrame: wanted === 'ai',
            })
            const quality = assessQuality(prepared.grayscale)

            let detection: Detection | undefined
            let rawText = ''
            let ranked: Hypothesis[] = []
            let evidence: OcrResult | undefined
            let reader: ReaderChoice = 'ocr'
            let fellBack: string | undefined
            let usage: AiUsage | undefined

            if (wanted === 'ai' && ai) {
              update(job.id, {
                stage: 'reading',
                detail: 'reading the cover with AI',
                reader: 'ai',
                warnings: quality.warnings,
              })
              // Speculative, and free when the AI call succeeds: this is the only chance to
              // overlap the engine download with a wait the user is already having.
              warmPool()
              try {
                // The *colour* frame, not the binarised one: thresholding was tuned for
                // tesseract and only throws away information a multimodal model uses. It is
                // also scaled down — `prepared.raw` stays full size, so the on-device
                // fallback below still reads the image it was tuned for.
                const jpeg = prepared.aiFrame
                if (!jpeg) throw new AiOcrError('malformed', 'No frame was prepared for the AI')
                const outcome = await readWithAi(ai, jpeg)
                detection = outcome.detection
                rawText = outcome.rawText
                usage = outcome.usage
                const synthesised = evidenceFromAi(rawText, detection)
                evidence = synthesised.result
                ranked = synthesised.ranked
                reader = 'ai'
              } catch (err) {
                // Every AI failure falls back to the device, for this photo only. A batch
                // where three covers reach Gemini and one times out is working correctly.
                const kind = err instanceof AiOcrError ? err.kind : 'network'
                fellBack = describeFailure(kind)
                // Only the two the user can actually act on are surfaced.
                if (kind === 'auth' || kind === 'rate-limit') setAiFailure(kind)
              }
            }

            if (!detection) {
              update(job.id, {
                stage: 'reading',
                detail: STAGE_DETAIL.reading,
                reader: 'ocr',
                fellBack,
                warnings: quality.warnings,
              })
              const pool = await ensurePool()
              const ocr = await readImage(pool, prepared, {
                onPass: (done, total) =>
                  update(job.id, {
                    progress: done / total,
                    detail: `reading the cover (${done}/${total})`,
                  }),
              })
              detection = detect(ocr)
              ranked = hypotheses(ocr)
              evidence = ocr
              rawText = ocr.text
              reader = 'ocr'
            }

            if (evidence && shouldLookUp(options.lookupMode, options.online)) {
              update(job.id, {
                stage: 'matching',
                progress: undefined,
                detail: STAGE_DETAIL.matching,
                title: detection.title,
              })
              const outcome = await identify(evidence, ranked, detection, {
                cache: cacheRef.current,
                onQuery: (_query, i, total) =>
                  update(job.id, { detail: `checking the catalogue (${i + 1}/${total})` }),
              })
              detection = outcome.detection
            }

            scanned.push({
              id: job.id,
              blob: file,
              detection,
              cover: prepared.thumbnail,
              ocrText: rawText,
              reader,
            })
            update(job.id, {
              stage: 'done',
              progress: 1,
              detail: STAGE_DETAIL.done,
              title: detection.title || '(nothing readable)',
              confidence: detection.confidence,
              reader,
              fellBack,
              ms: Date.now() - startedAt,
              usage,
              // Only worth mentioning when the result is poor; a blurry photo that still
              // came out right is not something to nag about.
              warnings: detection.confidence < 55 ? quality.warnings : [],
            })
          } catch (err) {
            update(job.id, {
              stage: 'failed',
              detail: STAGE_DETAIL.failed,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return groupDetections(scanned)
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message}. If this is the first scan, set up offline scanning from the Home screen while you have a connection.`
            : String(err),
        )
        return []
      } finally {
        setRunning(false)
        setLoadingEngine(undefined)
      }
    },
    [update],
  )

  return { jobs, running, loadingEngine, error, aiFailure, scan, reset }
}