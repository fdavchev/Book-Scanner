import { useEffect, useMemo, useRef, useState } from 'react'
import { cropBlob, prepare } from '../pipeline/preprocess'
import { TesseractPool, readImage, type LanguageCode } from '../pipeline/ocr'
import { detect } from '../pipeline/candidates'
import type { ReviewItem } from '../pipeline/group'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Several books in one photo, handled the practical way: drag a box around one of them
 * and the pipeline re-runs on that crop alone, producing a new review card.
 *
 * Automatic multi-book segmentation is the tempting alternative and it is not reliable
 * on a shelf photo — a two-second drag is.
 */
export function CropAndRescan({
  item,
  languages,
  onCancel,
  onResult,
}: {
  item: ReviewItem
  /** The languages the user is scanning in — the repair path must use them too. */
  languages: LanguageCode[]
  onCancel: () => void
  onResult: (item: ReviewItem) => void
}) {
  const source = item.images[0]?.blob
  const areaRef = useRef<HTMLDivElement>(null)
  const url = useMemo(() => (source ? URL.createObjectURL(source) : undefined), [source])
  const [rect, setRect] = useState<Rect>()
  const [start, setStart] = useState<{ x: number; y: number }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  function toLocal(event: React.PointerEvent) {
    const bounds = areaRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  async function rescan() {
    if (!source || !rect || rect.width < 0.05 || rect.height < 0.05) return
    setBusy(true)
    setError(undefined)
    let pool: TesseractPool | undefined
    try {
      const cropped = await cropBlob(source, rect)
      const prepared = await prepare(cropped)
      // Hardcoding English here re-read a Macedonian cover with the wrong model on the
      // very screen provided to fix a bad reading.
      pool = await TesseractPool.create(languages, 1)
      const ocr = await readImage(pool, prepared)
      const detection = detect(ocr)
      onResult({
        id: `${item.id}-crop-${Date.now()}`,
        title: detection.title,
        author: detection.author,
        confidence: detection.confidence,
        reason: `${detection.reason} (from a crop)`,
        titleAlternates: detection.titleAlternates,
        authorAlternates: detection.authorAlternates,
        source: detection.source,
        ocrText: ocr.text,
        cover: prepared.thumbnail,
        images: [{ id: `${item.id}-crop`, blob: cropped, detection, ocrText: ocr.text }],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      await pool?.terminate()
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Crop &amp; rescan</h1>
      <p className="dim small">
        Drag a box around one book, then rescan. The result is added as a new card — the
        original is left as it is.
      </p>

      {url ? (
        <div
          ref={areaRef}
          className="crop-area"
          onPointerDown={(event) => {
            ;(event.target as Element).setPointerCapture?.(event.pointerId)
            const point = toLocal(event)
            setStart(point)
            setRect({ x: point.x, y: point.y, width: 0, height: 0 })
          }}
          onPointerMove={(event) => {
            if (!start) return
            const point = toLocal(event)
            setRect({
              x: Math.min(start.x, point.x),
              y: Math.min(start.y, point.y),
              width: Math.abs(point.x - start.x),
              height: Math.abs(point.y - start.y),
            })
          }}
          onPointerUp={() => setStart(undefined)}
        >
          <img src={url} alt="The photo being cropped" />
          {rect && (
            <div
              className="crop-box"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
            />
          )}
        </div>
      ) : (
        <p className="empty">The original photo is no longer available for this card.</p>
      )}

      {error && (
        <p className="small" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="primary"
          disabled={busy || !rect || rect.width < 0.05}
          onClick={rescan}
        >
          {busy ? 'Rescanning…' : 'Rescan this area'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </>
  )
}
