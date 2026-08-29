import { useCallback, useRef, useState } from 'react'
import { prepare } from '../pipeline/preprocess'
import { TesseractPool, readImage, type LanguageCode } from '../pipeline/ocr'
import { detect, searchQuery } from '../pipeline/candidates'
import { enrich, shouldLookUp } from '../pipeline/enrich'
import { groupDetections, type ReviewItem, type ScannedImage } from '../pipeline/group'
import type { LookupMode } from '../storage/db'

export type JobStatus = 'queued' | 'reading' | 'matching' | 'done' | 'failed'

export interface ScanJob {
  id: string
  name: string
  status: JobStatus
  title?: string
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
  /** Set while the OCR engine is still loading, 0–1. */
  loadingEngine?: number
  error?: string
  scan: (files: File[], options: ScanOptions) => Promise<ReviewItem[]>
  reset: () => void
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
        status: 'queued',
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
          update(job.id, { status: 'reading' })
          try {
            const prepared = await prepare(file)
            const ocr = await readImage(pool, prepared)
            let detection = detect(ocr)

            if (shouldLookUp(options.lookupMode, options.online) && detection.title) {
              update(job.id, { status: 'matching', title: detection.title })
              const outcome = await enrich(detection, searchQuery(ocr, detection))
              detection = outcome.detection
            }

            scanned.push({
              id: job.id,
              blob: file,
              detection,
              cover: prepared.thumbnail,
              ocrText: ocr.text,
            })
            update(job.id, { status: 'done', title: detection.title || '(nothing readable)' })
          } catch (err) {
            update(job.id, {
              status: 'failed',
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
