import { useRef, useState } from 'react'
import { LookupPill } from './LookupPill'
import { useScanner } from './useScanner'
import type { SettingsApi } from './useSettings'
import type { ReviewItem } from '../pipeline/group'
import type { LanguageCode } from '../pipeline/ocr'

export function ScanScreen({
  settings,
  onScanned,
}: {
  settings: SettingsApi
  onScanned: (items: ReviewItem[]) => void
}) {
  const scanner = useScanner()
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const [cameraError, setCameraError] = useState<string>()

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const items = await scanner.scan(Array.from(files), {
      languages: settings.settings.languages as LanguageCode[],
      lookupMode: settings.settings.lookupMode,
      online: settings.online,
    })
    if (items.length > 0) onScanned(items)
  }

  const languages = settings.settings.languages

  function toggleLanguage(code: LanguageCode) {
    const next = languages.includes(code)
      ? languages.filter((l) => l !== code)
      : [...languages, code]
    void settings.update({ languages: (next.length === 0 ? ['mkd'] : next) as LanguageCode[] })
  }

  return (
    <>
      <h1>Scan</h1>

      <div className="row" style={{ marginBottom: 14 }}>
        <LookupPill
          mode={settings.settings.lookupMode}
          online={settings.online}
          onChange={(mode) => void settings.update({ lookupMode: mode })}
        />
        {(
          [
            ['mkd', 'Macedonian'],
            ['eng', 'English'],
          ] as const
        ).map(([code, name]) => (
          <button
            key={code}
            type="button"
            className={`pill ${languages.includes(code) ? 'on' : 'off'}`}
            aria-pressed={languages.includes(code)}
            onClick={() => toggleLanguage(code)}
          >
            <span className="dot" aria-hidden="true" />
            {name}
          </button>
        ))}
      </div>

      <div className="stack">
        {/* `capture` opens the camera directly. It is preferred over getUserMedia
            because it is the path that works reliably inside an iOS home-screen app. */}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="visually-hidden"
          data-testid="camera-input"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          data-testid="file-input"
          onChange={(event) => void handleFiles(event.target.files)}
        />

        <button
          type="button"
          className="primary big"
          disabled={scanner.running}
          onClick={() => {
            setCameraError(undefined)
            cameraInput.current?.click()
          }}
        >
          Open Camera
        </button>
        <button
          type="button"
          className="big"
          disabled={scanner.running}
          onClick={() => fileInput.current?.click()}
        >
          Select Photos
        </button>
      </div>

      {cameraError && <p className="small dim">{cameraError}</p>}

      {scanner.loadingEngine !== undefined && (
        <div className="banner" style={{ marginTop: 16 }}>
          <p className="small">Starting the text recogniser…</p>
          <div className="progress">
            <div style={{ width: `${Math.round(scanner.loadingEngine * 100)}%` }} />
          </div>
        </div>
      )}

      {scanner.error && (
        <div className="banner" style={{ marginTop: 16, color: 'var(--bad)' }}>
          <p className="small">{scanner.error}</p>
        </div>
      )}

      {scanner.jobs.length > 0 && (
        <>
          <h2>
            Scanning {scanner.jobs.filter((j) => j.stage === 'done').length}/
            {scanner.jobs.length}
          </h2>
          <div className="card" data-testid="scan-progress">
            {scanner.jobs.map((job) => (
              <div key={job.id} className="scan-item stack" style={{ gap: 4 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="meta">{job.title ?? job.name}</span>
                  <span className="dim">{job.error ?? job.detail ?? 'waiting'}</span>
                </div>
                {job.stage !== 'done' && job.stage !== 'failed' && (
                  <div className="progress">
                    <div style={{ width: `${Math.round((job.progress ?? 0.08) * 100)}%` }} />
                  </div>
                )}
                {job.stage === 'done' && (job.warnings?.length ?? 0) > 0 && (
                  <span className="small dim">{job.warnings?.[0]}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
