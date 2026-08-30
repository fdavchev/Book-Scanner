import { useState } from 'react'
import { CoverImage } from './CoverImage'
import { CropAndRescan } from './CropAndRescan'
import { mergeItems, splitItem, type ReviewItem } from '../pipeline/group'
import type { LanguageCode } from '../pipeline/ocr'
import { addBooks } from '../storage/db'

function confidenceClass(confidence: number): string {
  if (confidence >= 70) return 'chip high'
  if (confidence >= 55) return 'chip medium'
  return 'chip low'
}

/** Below this the app says plainly that it is guessing, rather than showing a number. */
export const UNSURE_BELOW = 55

function confidenceLabel(confidence: number): string {
  if (confidence >= 70) return `${confidence}% confident`
  if (confidence >= UNSURE_BELOW) return `${confidence}% — worth checking`
  return 'Not sure — please check'
}

export function ReviewScreen({
  items,
  languages,
  onChange,
  onDone,
}: {
  items: ReviewItem[]
  languages: LanguageCode[]
  onChange: (items: ReviewItem[]) => void
  onDone: () => void | Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [cropping, setCropping] = useState<ReviewItem>()
  const [saving, setSaving] = useState(false)

  function replace(id: string, changes: Partial<ReviewItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...changes } : item)))
  }

  function discard(id: string) {
    onChange(items.filter((item) => item.id !== id))
    setSelected((current) => current.filter((s) => s !== id))
  }

  function split(item: ReviewItem) {
    const index = items.findIndex((i) => i.id === item.id)
    const parts = splitItem(item)
    onChange([...items.slice(0, index), ...parts, ...items.slice(index + 1)])
  }

  function mergeSelected() {
    const chosen = items.filter((item) => selected.includes(item.id))
    if (chosen.length < 2) return
    const merged = mergeItems(chosen)
    const index = items.findIndex((i) => i.id === chosen[0].id)
    const rest = items.filter((item) => !selected.includes(item.id))
    onChange([...rest.slice(0, index), merged, ...rest.slice(index)])
    setSelected([])
  }

  async function saveAll() {
    setSaving(true)
    try {
      await addBooks(
        items.map((item) => ({
          title: item.title || 'Untitled',
          author: item.author,
          cover: item.cover,
          confidence: item.confidence,
          source: item.source,
          ocrText: item.ocrText,
          photoCount: item.images.length,
        })),
      )
      await onDone()
    } finally {
      setSaving(false)
    }
  }

  if (cropping) {
    return (
      <CropAndRescan
        item={cropping}
        languages={languages}
        onCancel={() => setCropping(undefined)}
        onResult={(rescanned) => {
          const index = items.findIndex((i) => i.id === cropping.id)
          onChange([...items.slice(0, index + 1), rescanned, ...items.slice(index + 1)])
          setCropping(undefined)
        }}
      />
    )
  }

  if (items.length === 0) {
    return (
      <>
        <h1>Review</h1>
        <p className="empty">Nothing to review. Scan some books first.</p>
      </>
    )
  }

  return (
    <>
      <h1>Review {items.length} book{items.length === 1 ? '' : 's'}</h1>
      <p className="dim small">
        Check each one, fix anything wrong, then save. Nothing is stored until you do.
      </p>

      {selected.length >= 2 && (
        <button type="button" onClick={mergeSelected} style={{ marginBottom: 12 }}>
          Merge {selected.length} selected into one book
        </button>
      )}

      <ul className="book-list">
        {items.map((item) => (
          <li key={item.id} className="card stack" data-testid="review-card">
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <CoverImage blob={item.cover} alt="" large />
              <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                <div className="field">
                  <label htmlFor={`title-${item.id}`}>Title</label>
                  <input
                    id={`title-${item.id}`}
                    value={item.title}
                    onChange={(event) => replace(item.id, { title: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`author-${item.id}`}>Author</label>
                  <input
                    id={`author-${item.id}`}
                    value={item.author}
                    onChange={(event) => replace(item.id, { author: event.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="row">
              <span className={confidenceClass(item.confidence)}>
                {confidenceLabel(item.confidence)}
              </span>
              <span className="chip">
                {item.source === 'openlibrary' ? 'Matched via Open Library' : 'OCR'}
              </span>
              {item.images.length > 1 && (
                <span className="chip">from {item.images.length} photos</span>
              )}
            </div>
            <p className="small dim" style={{ margin: 0 }}>
              {item.reason}
            </p>

            {item.confidence < UNSURE_BELOW && (
              <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>
                The cover was hard to read. Check the title and author before saving — or
                use <strong>Crop &amp; rescan</strong> to try again on just the cover.
              </p>
            )}

            {item.titleAlternates.length > 0 && (
              <div className="field">
                <label htmlFor={`alt-${item.id}`}>Other lines it could be</label>
                <select
                  id={`alt-${item.id}`}
                  value=""
                  onChange={(event) => {
                    if (event.target.value) replace(item.id, { title: event.target.value })
                  }}
                >
                  <option value="">Choose a different title…</option>
                  {item.titleAlternates.map((alt) => (
                    <option key={alt} value={alt}>
                      {alt}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {item.authorAlternates.length > 0 && (
              <div className="field">
                <label htmlFor={`altauthor-${item.id}`}>Other possible authors</label>
                <select
                  id={`altauthor-${item.id}`}
                  value=""
                  onChange={(event) => {
                    if (event.target.value) replace(item.id, { author: event.target.value })
                  }}
                >
                  <option value="">Choose a different author…</option>
                  {item.authorAlternates.map((alt) => (
                    <option key={alt} value={alt}>
                      {alt}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="row">
              <label className="row small" style={{ textTransform: 'none', margin: 0 }}>
                <input
                  type="checkbox"
                  style={{ width: 20, minHeight: 20 }}
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((s) => s !== item.id),
                    )
                  }
                />
                Select to merge
              </label>
              {item.images.length > 1 && (
                <button type="button" onClick={() => split(item)}>
                  Split
                </button>
              )}
              <button type="button" onClick={() => setCropping(item)}>
                Crop &amp; rescan
              </button>
              <button type="button" className="danger" onClick={() => discard(item.id)}>
                Discard
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="primary big"
        style={{ marginTop: 16 }}
        disabled={saving}
        onClick={saveAll}
        data-testid="save-all"
      >
        {saving ? 'Saving…' : `Save all ${items.length}`}
      </button>
    </>
  )
}
