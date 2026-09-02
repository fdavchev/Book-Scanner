import { describe, expect, it } from 'vitest'
import { aiControlVisible, aiLabel, chooseReader, readerReason, type RouteInput } from './route'

const input = (changes: Partial<RouteInput> = {}): RouteInput => ({
  mode: 'auto',
  hasKey: true,
  online: true,
  ...changes,
})

describe('chooseReader', () => {
  it('uses AI when a key exists, the mode is auto and the network is really there', () => {
    expect(chooseReader(input())).toBe('ai')
  })

  it('never uses AI without a key, however good the connection is', () => {
    expect(chooseReader(input({ hasKey: false }))).toBe('ocr')
  })

  it('never uses AI when the mode is off, even with a key and a connection', () => {
    expect(chooseReader(input({ mode: 'off' }))).toBe('ocr')
  })

  it('falls to the device when offline', () => {
    expect(chooseReader(input({ online: false }))).toBe('ocr')
  })

  // The whole point of the feature is that it cannot take the app's offline guarantee
  // away, so every combination is pinned rather than a representative sample.
  it.each([
    [{ mode: 'off', hasKey: false, online: false }, 'ocr'],
    [{ mode: 'off', hasKey: false, online: true }, 'ocr'],
    [{ mode: 'off', hasKey: true, online: false }, 'ocr'],
    [{ mode: 'off', hasKey: true, online: true }, 'ocr'],
    [{ mode: 'auto', hasKey: false, online: false }, 'ocr'],
    [{ mode: 'auto', hasKey: false, online: true }, 'ocr'],
    [{ mode: 'auto', hasKey: true, online: false }, 'ocr'],
    [{ mode: 'auto', hasKey: true, online: true }, 'ai'],
  ] as [RouteInput, string][])('%o routes to %s', (given, expected) => {
    expect(chooseReader(given)).toBe(expected)
  })
})

describe('labels', () => {
  it('says why the device was used, rather than just that AI is on', () => {
    expect(readerReason(input({ hasKey: false }))).toMatch(/no gemini api key/i)
    expect(readerReason(input({ online: false }))).toMatch(/no connection/i)
    expect(readerReason(input({ mode: 'off' }))).toMatch(/switched off/i)
    expect(readerReason(input())).toMatch(/gemini/i)
  })

  it('distinguishes on-but-unreachable from off', () => {
    expect(aiLabel(input())).toBe('AI: On · connected')
    expect(aiLabel(input({ online: false }))).toBe('AI: On · no signal')
    expect(aiLabel(input({ mode: 'off' }))).toBe('AI: Off')
    expect(aiLabel(input({ hasKey: false }))).toBe('AI: No key')
  })

  it('hides the control until a key makes it mean something', () => {
    expect(aiControlVisible(false)).toBe(false)
    expect(aiControlVisible(true)).toBe(true)
  })
})
