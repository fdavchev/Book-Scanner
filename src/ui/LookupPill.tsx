import { lookupLabel } from '../pipeline/enrich'
import type { LookupMode } from '../storage/db'

/**
 * The Open Library control, in the scan header where it is used — not buried in a
 * settings screen.
 *
 * It shows what connectivity detection currently believes, but detection never disables
 * it: tapping always cycles the mode, because the probe can be wrong and forcing the
 * lookup on while it says "offline" is a legitimate thing to want.
 */
export function LookupPill({
  mode,
  online,
  onChange,
}: {
  mode: LookupMode
  online: boolean
  onChange: (mode: LookupMode) => void
}) {
  const next: Record<LookupMode, LookupMode> = {
    auto: 'forced-off',
    'forced-off': 'forced-on',
    'forced-on': 'auto',
  }
  const on = mode === 'forced-on' || (mode === 'auto' && online)

  return (
    <button
      type="button"
      className={`pill ${on ? 'on' : 'off'}`}
      onClick={() => onChange(next[mode])}
      title="Look book details up on Open Library. Tap to change; this is never locked."
      data-testid="lookup-pill"
      data-mode={mode}
    >
      <span className="dot" aria-hidden="true" />
      {lookupLabel(mode, online)}
      {mode !== 'auto' && <span className="dim small">(manual)</span>}
    </button>
  )
}
