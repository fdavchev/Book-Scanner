import { useState } from 'react'
import { OfflineSetup } from './OfflineSetup'
import type { SettingsApi } from './useSettings'
import { GEMINI_MODEL } from '../pipeline/ai-ocr'
import { readerReason } from '../pipeline/route'
import type { ThemeChoice } from '../storage/db'

const THEMES: [ThemeChoice, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]

export function SettingsScreen({ settings }: { settings: SettingsApi }) {
  const current = settings.settings
  const [key, setKey] = useState(current.geminiApiKey)
  const [revealed, setRevealed] = useState(false)
  const [saved, setSaved] = useState(false)
  const hasKey = Boolean(current.geminiApiKey)

  async function saveKey() {
    await settings.update({ geminiApiKey: key.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function clearKey() {
    setKey('')
    await settings.update({ geminiApiKey: '' })
  }

  return (
    <div className="fade-in">
      <h1>Settings</h1>

      <section className="section">
        <h2>Appearance</h2>
        <div className="card stack">
          <div className="row between nowrap">
            <span className="small">Theme</span>
            <div className="segmented" role="group" aria-label="Theme">
              {THEMES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={current.theme === value}
                  onClick={() => void settings.update({ theme: value })}
                  data-testid={`theme-${value}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="tiny faint" style={{ margin: 0 }}>
            <strong>System</strong> follows your phone, so the app turns dark when it does.
          </p>
        </div>
      </section>

      <section className="section">
        <h2>AI cover reading</h2>
        <div className="card stack">
          <p className="small dim" style={{ margin: 0 }}>
            On-device reading struggles with Macedonian Cyrillic display type. With a Google
            Gemini key, covers are read by <strong>{GEMINI_MODEL}</strong> instead — and if
            that fails or you are offline, the on-device reader takes over automatically.
          </p>

          <div className="banner warn" style={{ margin: 0 }}>
            <p className="small" style={{ margin: 0 }}>
              <strong>What this sends.</strong> When AI reading is on, the cover photo is
              uploaded to Google. Everything else about the app is unchanged: nothing is sent
              when it is off or when you have no connection, and your books never leave the
              phone either way.
            </p>
          </div>

          <div className="field">
            <label htmlFor="gemini-key">Gemini API key</label>
            <input
              id="gemini-key"
              type={revealed ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your key here"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              data-testid="gemini-key"
            />
          </div>

          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={saveKey}
              disabled={key.trim() === current.geminiApiKey}
              data-testid="save-key"
            >
              {saved ? 'Saved' : 'Save key'}
            </button>
            <button type="button" onClick={() => setRevealed(!revealed)}>
              {revealed ? 'Hide' : 'Show'}
            </button>
            {hasKey && (
              <button type="button" className="danger" onClick={clearKey} data-testid="clear-key">
                Remove
              </button>
            )}
          </div>

          <p className="tiny faint" style={{ margin: 0 }}>
            The key is your own, stored only on this phone, sent only to Google, and left out
            of the backup file on purpose. Get one free at{' '}
            <strong>aistudio.google.com/apikey</strong>.
          </p>

          {hasKey && (
            <>
              <div className="row between nowrap" style={{ marginTop: 4 }}>
                <span className="small">Use AI when online</span>
                <div className="segmented" role="group" aria-label="AI reading">
                  {(
                    [
                      ['auto', 'On'],
                      ['off', 'Off'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={current.aiMode === value}
                      onClick={() => void settings.update({ aiMode: value })}
                      data-testid={`ai-mode-${value}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="tiny faint" style={{ margin: 0 }}>
                {readerReason({ mode: current.aiMode, hasKey, online: settings.online })}
              </p>
            </>
          )}
        </div>
      </section>

      <section className="section">
        <h2>Offline scanning</h2>
        <OfflineSetup settings={settings} />
        <p className="tiny faint">
          The on-device reader is what makes this app work with no signal. It stays the
          fallback for every AI failure, so it is worth setting up even with a key saved.
        </p>
      </section>

      <section className="section">
        <h2>About</h2>
        <div className="card">
          <div className="kv">
            <span className="k">Connection</span>
            <span>{settings.online ? 'Reachable' : 'No connection'}</span>
          </div>
          <div className="kv">
            <span className="k">Offline reading</span>
            <span>{settings.offlineReady ? 'Ready' : 'Not set up'}</span>
          </div>
          <div className="kv">
            <span className="k">AI reading</span>
            <span>{hasKey ? (current.aiMode === 'auto' ? 'On' : 'Off') : 'No key'}</span>
          </div>
          <div className="kv">
            <span className="k">Catalogue lookup</span>
            <span>{current.lookupMode === 'forced-off' ? 'Off' : 'On'}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
