import { useEffect } from 'react'
import type { ThemeChoice } from '../storage/db'

/**
 * Applies the chosen theme to the document.
 *
 * `system` deliberately removes the attribute rather than resolving the phone's setting
 * into a value: the stylesheet already follows `prefers-color-scheme` when no attribute is
 * present, so a phone that switches to dark at sunset switches the app with it, with no
 * listener and no re-render here.
 */
export function useTheme(theme: ThemeChoice): void {
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])
}

/** Keeps the browser chrome — the iOS status bar, Android's address bar — in step. */
export function useThemeColour(theme: ThemeChoice): void {
  useEffect(() => {
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    const colour = dark ? '#131218' : '#f7f4ee'
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    meta.content = colour
  }, [theme])
}
