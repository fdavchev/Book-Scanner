import { useRef } from 'react'
import { LookupPill } from './LookupPill'
import { AiPill } from './AiPill'
import { useScanner } from './useScanner'
import type { SettingsApi } from './useSettings'
import type { ReviewItem } from '../pipeline/group'
import type { LanguageCode } from '../pipeline/ocr'
import { aiControlVisible, chooseReader } from '../pipeline/route'
import { describeFailure } from '../pipeline/ai-ocr'

export function ScanScreen({
  settings,
  onScanned,
  onOpenSettings,
}: {
  settings: SettingsApi
  onScanned: (items: ReviewItem[]) => void
  onOpenSettings: () => void
}) {
  const scanner = useScanner()
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  const current = settings.settings
  const hasKey = Boolean(current.geminiApiKey)
  const reader = chooseReader({ mode: current.aiMode, hasKey, online: settings.online })

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const items = await scanner.scan(Array.from(files), {
      languages: current.languages as LanguageCode[],
      lookupMode: current.lookupMode,
      online: settings.online,
      aiMode: current.aiMode,
      apiKey: current.geminiApiKey,
    })
    if (items.length > 0) onScanned(items)
  }

  const languages = current.languages

  function toggleLanguage(code: LanguageCode) {
    const next = languages.includes(code)
      ? languages.filter((l) => l !== code)
      : [...languages, code]
    void settings.update({ languages: (next.length === 0 ? ['mkd'] : next) as LanguageCode[] })
  }

  const done = scanner.jobs.filter((j) => j.stage === 'done').length

  return (
    <div className="fade-in">
      <h1>Scan</h1>

      <div className="row" style={{ marginBottom: 12 }}>
        <LookupPill
          mode={current.lookupMode}
          online={settings.online}
          onChange={(mode) => void settings.update({ lookupMode: mode })}
        />
        {aiControlVisible(hasKey) && (
          <AiPill
            mode={current.aiMode}
            online={settings.online}
            onChange={(mode) => void settings.update({ aiMode: mode })}
          />
        )}
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

      <p className="tiny faint" style={{ marginBottom: 14 }}>
        {reader === 'ai'
          ? 'Covers will be read by Gemini — the photo is sent to Google — with on-device reading as the fallback.'
          : 'Covers will be read on this device. Nothing is sent anywhere.'}
        {!hasKey && (
          <>
            {' '}
            <button type="button" className="link" onClick={onOpenSettings}>
              Set up AI reading
            </button>
          </>
        )}
      </p>

      {/* Only the two failures the user can act on interrupt; the rest fall back quietly. */}
      {scanner.aiFailure && (
        <div className="banner bad">
          <p className="small" style={{ margin: 0 }}>
            {describeFailure(scanner.aiFailure)}{' '}
            <button type="button" className="link" onClick={onOpenSettings}>
              Open Settings
            </button>
          </p>
        </div>
      )}

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
          onClick={() => cameraInput.current?.click()}
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

      {scanner.loadingEngine !== undefined && (
        <div className="banner" style={{ marginTop: 16 }}>
          <p className="small">Starting the on-device text recogniser…</p>
          <div className="progress">
            <div style={{ width: `${Math.round(scanner.loadingEngine * 100)}%` }} />
          </div>
        </div>
      )}

      {scanner.error && (
        <div className="banner bad" style={{ marginTop: 16 }}>
          <p className="small" style={{ margin: 0 }}>
            {scanner.error}
          </p>
        </div>
      )}

      {scanner.jobs.length > 0 && (
        <>
          <h2>
            Scanning {done}/{scanner.jobs.length}
          </h2>
          <div className="card" data-testid="scan-progress">
            {scanner.jobs.map((job) => (
              <div key={job.id} className="scan-item">
                <div className="row between nowrap">
                  <span className="meta">{job.title ?? job.name}</span>
                  <span className="dim small">{job.error ?? job.detail ?? 'waiting'}</span>
                </div>
                {job.stage !== 'done' && job.stage !== 'failed' && (
                  <div className="progress">
                    <div style={{ width: `${Math.round((job.progress ?? 0.08) * 100)}%` }} />
                  </div>
                )}
                {job.stage === 'done' && (
                  <div className="row">
                    <span className={`chip ${job.reader === 'ai' ? 'ai' : ''}`}>
                      {job.reader === 'ai' ? 'Read via AI' : 'Read on device'}
                    </span>
                    {job.ms !== undefined && (
                      <span className="chip">{(job.ms / 1000).toFixed(1)}s</span>
                    )}
                    {(job.warnings?.length ?? 0) > 0 && (
                      <span className="small dim">{job.warnings?.[0]}</span>
                    )}
                  </div>
                )}
                {/* The numbers that tell the three causes of a slow AI call apart:
                    thinking, a long answer, or the network. On the card rather than in a
                    console, because the device this runs on does not have one. */}
                {job.stage === 'done' && job.usage && (
                  <span className="tiny faint" data-testid="ai-usage">
                    {job.usage.model}
                    {job.usage.ms !== undefined && ` · ${(job.usage.ms / 1000).toFixed(1)}s call`}
                    {job.usage.thoughtsTokens !== undefined &&
                      ` · ${job.usage.thoughtsTokens} thinking`}
                    {job.usage.outputTokens !== undefined && ` · ${job.usage.outputTokens} out`}
                    {job.usage.promptTokens !== undefined && ` · ${job.usage.promptTokens} in`}
                  </span>
                )}
                {job.fellBack && <span className="tiny faint">{job.fellBack}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
