import { aiLabel, readerReason, type AiMode } from '../pipeline/route'

/**
 * The AI control, sitting beside the Open Library pill and behaving the same way: a visible,
 * always-tappable switch in the scan header rather than a hidden setting.
 *
 * It is rendered only when a key exists. A disabled toggle with no route to enabling it is
 * worse than no toggle at all, so with no key the scan screen shows a line pointing at
 * Settings instead.
 */
export function AiPill({
  mode,
  online,
  onChange,
}: {
  mode: AiMode
  online: boolean
  onChange: (mode: AiMode) => void
}) {
  const on = mode === 'auto'
  const state = { mode, hasKey: true, online }

  return (
    <button
      type="button"
      className={`pill ${on && online ? 'on' : 'off'}`}
      onClick={() => onChange(on ? 'off' : 'auto')}
      aria-pressed={on}
      title={`${readerReason(state)} Enabling this sends the photo to Google.`}
      data-testid="ai-pill"
      data-mode={mode}
    >
      <span className="dot" aria-hidden="true" />
      {aiLabel(state)}
    </button>
  )
}
