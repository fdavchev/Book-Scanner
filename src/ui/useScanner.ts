import { useCallback, useRef, useState } from 'react'
import { assessQuality, prepare } from '../pipeline/preprocess'
import { TesseractPool, readImage, type LanguageCode } from '../pipeline/ocr'
import { detect, hypotheses } from '../pipeline/candidates'
import { shouldLookUp } from '../pipeline/enrich'
import { identify } from '../pipeline/identify'
import type { OpenLibraryDoc } from '../pipeline/enrich'
import { groupDetections, type ReviewItem, type ScannedImage } from '../pipeline/group'
import { createLookupCache, type LookupMode } from '../storage/db'

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
  /** Advice about the photo itself, when it is the problem. */
  warnings?: string[]
  error?: string
}

export interface ScanOptions {
  languages: LanguageCode[]
  lookupMode: LookupMode
  online: boolean
}

export interface ScannerApi {
  jobs: ScanJob[]
  running: boolean
  loadingEngine?: number
  error?: string
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
 */
export function useScanner(): ScannerApi {
  const [jobs, setJobs] = useState<ScanJob[]>([])
  const [running, setRunning] = useState(false)
  const [loadingEngine, setLoadingEngine] = useState<number>()
  const [error, setError] = useState<string>()
  const poolRef = useRef<TesseractPool>(null)
  const poolLanguagesRef = useRef<string>('')
  // One cache for the life of the app: scanning a shelf asks the catalogue the same
  // questions repeatedly, and a remembered answer needs no network at all.
  const cacheRef = useRef(createLookupCache<OpenLibraryDoc>())

  const reset = useCallback(() => {
    setJobs([])
    setError(undefined)
  }, [])

  const update = useCallback((id: string, changes: Partial<ScanJob>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...changes } : job)))
  }, [])

  const scan = useCallback(
    async (files: File[], options: ScanOptions): Promise<ReviewItem[]> => {
      setError(undefined)
      setRunning(true)
      const initial: ScanJob[] = files.map((file, i) => ({
        id: `${Date.now()}-${i}`,
        name: file.name || `Photo ${i + 1}`,
        stage: 'queued',
      }))
      setJobs(initial)

      try {
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
        const pool = poolRef.current

        const scanned: ScannedImage[] = []
        for (const [index, file] of files.entries()) {
          const job = initial[index]
          try {
            update(job.id, { stage: 'preparing', detail: STAGE_DETAIL.preparing })
            const prepared = await prepare(file)
            const quality = assessQuality(prepared.grayscale)

            update(job.id, {
              stage: 'reading',
              detail: STAGE_DETAIL.reading,
              warnings: quality.warnings,
            })
            const ocr = await readImage(pool, prepared, {
              onPass: (done, total) =>
                update(job.id, {
                  progress: done / total,
                  detail: `reading the cover (${done}/${total})`,
                }),
            })

            const ranked = hypotheses(ocr)
            let detection = detect(ocr)

            if (shouldLookUp(options.lookupMode, options.online)) {
              update(job.id, {
                stage: 'matching',
                progress: undefined,
                detail: STAGE_DETAIL.matching,
                title: detection.title,
              })
              const outcome = await identify(ocr, ranked, detection, {
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
              ocrText: ocr.text,
            })
            update(job.id, {
              stage: 'done',
              progress: 1,
              detail: STAGE_DETAIL.done,
              title: detection.title || '(nothing readable)',
              confidence: detection.confidence,
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

  return { jobs, running, loadingEngine, error, scan, reset }
}
