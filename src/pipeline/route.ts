/**
 * Which reader gets the photo: Gemini, or the on-device pipeline.
 *
 * Deliberately a pure function of three booleans and nothing else. The decision is made
 * once per photo, before any work is done, so it can be unit-tested exhaustively and shown
 * to the user as a label rather than being an emergent property of the scan loop.
 */

/** `auto` means "use AI whenever it is actually available"; `off` means never. */
export type AiMode = 'auto' | 'off'

export type ReaderChoice = 'ai' | 'ocr'

export interface RouteInput {
  mode: AiMode
  /** Whether a Gemini API key has been saved. */
  hasKey: boolean
  /** The result of the real reachability probe, not `navigator.onLine` alone. */
  online: boolean
}

/**
 * The decision, in the order the plan specifies.
 *
 * No key beats everything, including connectivity: with nothing to authenticate with there
 * is no call to attempt, so the probe is not even consulted.
 */
export function chooseReader({ mode, hasKey, online }: RouteInput): ReaderChoice {
  if (mode === 'off') return 'ocr'
  if (!hasKey) return 'ocr'
  if (!online) return 'ocr'
  return 'ai'
}

/**
 * Why that reader was chosen — shown on the pill, so "AI is on but nothing happened" is
 * never a mystery the user has to solve.
 */
export function readerReason({ mode, hasKey, online }: RouteInput): string {
  if (mode === 'off') return 'AI reading is switched off.'
  if (!hasKey) return 'No Gemini API key is set, so covers are read on the device.'
  if (!online) return 'No connection, so covers are read on the device.'
  return 'Covers are read by Gemini, with on-device reading as the fallback.'
}

export function aiLabel({ mode, hasKey, online }: RouteInput): string {
  if (mode === 'off') return 'AI: Off'
  if (!hasKey) return 'AI: No key'
  return online ? 'AI: On · connected' : 'AI: On · no signal'
}

/**
 * Whether the AI control is worth showing at all.
 *
 * A disabled toggle with no route to enabling it is worse than no toggle, so the scan
 * screen hides it entirely until a key exists — Settings is where a key gets added, and
 * that is where the app points you.
 */
export function aiControlVisible(hasKey: boolean): boolean {
  return hasKey
}
