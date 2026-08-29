import { useState } from 'react'
import { downloadOfflineAssets, formatBytes, loadManifest, plan } from '../offline/ocrAssets'
import type { SettingsApi } from './useSettings'

const LANGUAGE_NAMES: Record<string, string> = { eng: 'English', mkd: 'Macedonian' }

/**
 * The first-run step that turns "works offline" from a claim into a fact: it pulls the
 * OCR engine and the chosen language data into the cache. Until it has run, scanning
 * needs the network to fetch them the first time.
 */
export function OfflineSetup({ settings }: { settings: SettingsApi }) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string[]>(settings.settings.languages)
  const [progress, setProgress] = useState<number>()
  const [error, setError] = useState<string>()
  const [estimate, setEstimate] = useState<number>()

  const ready = settings.offlineReady

  async function openPanel() {
    setOpen(true)
    setError(undefined)
    try {
      const manifest = await loadManifest()
      setEstimate(plan(manifest, chosen).bytes)
    } catch {
      setEstimate(undefined)
    }
  }

  function toggle(code: string) {
    const next = chosen.includes(code)
      ? chosen.filter((c) => c !== code)
      : [...chosen, code].sort()
    setChosen(next.length === 0 ? ['eng'] : next)
    void loadManifest()
      .then((m) => setEstimate(plan(m, next.length === 0 ? ['eng'] : next).bytes))
      .catch(() => setEstimate(undefined))
  }

  async function download() {
    setError(undefined)
    setProgress(0)
    try {
      await downloadOfflineAssets(chosen, (p) => setProgress(p.done / p.total))
      await settings.update({
        languages: chosen as ('eng' | 'mkd')[],
        offlineLanguages: chosen as ('eng' | 'mkd')[],
      })
      await settings.recheckOffline()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(undefined)
    }
  }

  if (ready && !open) {
    return (
      <div className="banner row" style={{ justifyContent: 'space-between' }}>
        <span className="small">
          <strong style={{ color: 'var(--good)' }}>●</strong> Offline scanning is ready (
          {settings.settings.languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(', ')})
        </span>
        <button type="button" className="link" onClick={openPanel}>
          Change languages
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="banner">
        <p className="small" style={{ marginBottom: 8 }}>
          <strong>Set up offline scanning</strong> — a one-time download of the text
          recogniser, so scanning works with no internet at all.
        </p>
        <button type="button" onClick={openPanel}>
          Set up offline scanning
        </button>
      </div>
    )
  }

  return (
    <div className="banner">
      <p className="small">
        <strong>Set up offline scanning</strong>
      </p>
      <p className="small dim">
        Choose the languages your books are printed in. Fewer languages means a smaller
        download. This happens once.
      </p>
      <div className="stack" style={{ marginBottom: 10 }}>
        {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
          <label key={code} className="row" style={{ textTransform: 'none', fontSize: '1rem' }}>
            <input
              type="checkbox"
              style={{ width: 20, minHeight: 20 }}
              checked={chosen.includes(code)}
              onChange={() => toggle(code)}
            />
            {name}
          </label>
        ))}
      </div>

      {estimate !== undefined && (
        <p className="small dim">About {formatBytes(estimate)} to download.</p>
      )}

      {progress !== undefined && (
        <div className="progress" style={{ margin: '10px 0' }}>
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {error && (
        <p className="small" style={{ color: 'var(--bad)' }}>
          {error} — check your connection and try again.
        </p>
      )}

      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={download}
          disabled={progress !== undefined}
        >
          {progress === undefined ? 'Download' : 'Downloading…'}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={progress !== undefined}>
          Not now
        </button>
      </div>
    </div>
  )
}
