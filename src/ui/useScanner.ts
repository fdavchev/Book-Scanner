import { useCallback, useRef, useState } from 'react'
import { assessQuality, encodeJpeg, prepare } from '../pipeline/preprocess'
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
 * selection at once is the reliable way to have the tab killed mid-scan. That constraint
 * is also why the AI calls are sequential — the plan floated firing two or three at once,
 * but overlapping them means holding several photos' worth of decoded ImageData so the
 * tesseract fallback still has something to read, which is precisely what the ceiling
 * forbids. The saving would have been a few seconds on a four-photo batch.
 */
export function useScanner(): ScannerApi {
  const [jobs, setJobs] = useState<ScanJob[]>([])
  const [running, setRunning] = useState(false)
  const [loadingEngine, setLoadingEngine] = useState<number>()
  const [error, setError] = useState<string>()
  const [aiFailure, setAiFailure] = useState<AiFailureKind>()
  const poolRef = useRef<TesseractPool>(null)
  const poolLanguagesRef = useRef<string>('')
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
       */
      const ensurePool = async (): Promise<TesseractPool> => {
        const languageKey = options.languages.join('+')
        if (!poolRef.current || poolLanguagesRef.current !== languageKey) {
          await poolRef.current?.terminate()
          setLoadingEngine(0)
          poolRef.current = await TesseractPool.create(options.languages, undefined, (f) =>
            setLoadingEngine(f),
          )
          poolLanguagesRef.current = languageKey
          setLoadingEngine(undefined)
        }
        return poolRef.current
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
          try {
            update(job.id, { stage: 'preparing', detail: STAGE_DETAIL.preparing })
            const prepared = await prepare(file)
            const quality = assessQuality(prepared.grayscale)

            const wanted = chooseReader({
              mode: options.aiMode,
              hasKey: Boolean(ai),
              online: options.online,
            })

            let detection: Detection | undefined
            let rawText = ''
            let ranked: Hypothesis[] = []
            let evidence: OcrResult | undefined
            let reader: ReaderChoice = 'ocr'
            let fellBack: string | undefined

            if (wanted === 'ai' && ai) {
              update(job.id, {
                stage: 'reading',
                detail: 'reading the cover with AI',
                reader: 'ai',
                warnings: quality.warnings,
              })
              try {
                // The resized *colour* frame, not the binarised one: thresholding was tuned
                // for tesseract and only throws away information a multimodal model uses.
                const jpeg = await encodeJpeg(prepared.raw)
                const outcome = await readWithAi(ai, jpeg)
                detection = outcome.detection
                rawText = outcome.rawText
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
