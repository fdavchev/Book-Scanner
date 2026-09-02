import { useCallback, useState } from 'react'
import { HomeScreen } from './ui/HomeScreen'
import { ScanScreen } from './ui/ScanScreen'
import { ReviewScreen } from './ui/ReviewScreen'
import { LibraryScreen } from './ui/LibraryScreen'
import { SettingsScreen } from './ui/SettingsScreen'
import { InstallHint } from './ui/InstallHint'
import { useBooks } from './ui/useBooks'
import { useSettings } from './ui/useSettings'
import { useTheme, useThemeColour } from './ui/useTheme'
import type { ReviewItem } from './pipeline/group'

export type Route = 'home' | 'scan' | 'review' | 'library' | 'settings'

/** The bottom bar. Review is reached by scanning, so it is not a tab. */
const TABS: [Route, string, string][] = [
  ['home', 'Home', '⌂'],
  ['scan', 'Scan', '⎙'],
  ['library', 'My Books', '☰'],
  ['settings', 'Settings', '⚙'],
]

/** Home says its own name in the hero, so the bar stays empty there. */
const TITLES: Record<Route, string> = {
  home: '',
  scan: 'Scan',
  review: 'Review',
  library: 'My Books',
  settings: 'Settings',
}

const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' } as const
const THEME_GLYPH = { system: '◐', light: '☀', dark: '☾' } as const

export default function App() {
  const [route, setRoute] = useState<Route>('home')
  const [pending, setPending] = useState<ReviewItem[]>([])
  const [query, setQuery] = useState('')
  const books = useBooks()
  const settings = useSettings()

  useTheme(settings.settings.theme)
  useThemeColour(settings.settings.theme)

  const goToReview = useCallback((items: ReviewItem[]) => {
    setPending(items)
    setRoute('review')
  }, [])

  const finishReview = useCallback(async () => {
    setPending([])
    await books.reload()
    setRoute('library')
  }, [books])

  // Leaving the review screen with unsaved cards is the one action in the app that can
  // silently lose work, so it is confirmed — and the cards are dropped once it is.
  const navigate = (next: Route) => {
    if (route === 'review' && pending.length > 0 && next !== 'review') {
      const ok = window.confirm(
        `Leave without saving ${pending.length} scanned book${pending.length === 1 ? '' : 's'}?`,
      )
      if (!ok) return
      setPending([])
    }
    setRoute(next)
  }

  // The theme cycles from the bar as well as from Settings: it is the one setting people
  // change on a whim, and three taps to reach it is two too many.
  const theme = settings.settings.theme

  return (
    <div className="app">
      <header className="topbar">
        <span className="mark" aria-hidden="true">
          <span className="spine" />
        </span>
        {/* Empty on Home, where the hero already says the name. */}
        <span className="where">{TITLES[route]}</span>
        <button
          type="button"
          className="icon"
          onClick={() => void settings.update({ theme: NEXT_THEME[theme] })}
          title={`Theme: ${theme}. Tap to change.`}
          aria-label={`Theme: ${theme}. Tap to change.`}
          data-testid="theme-toggle"
          data-theme-choice={theme}
        >
          <span aria-hidden="true">{THEME_GLYPH[theme]}</span>
        </button>
      </header>

      <main>
        {route === 'home' && (
          <HomeScreen
            books={books}
            settings={settings}
            onScan={() => navigate('scan')}
            onSearch={(q) => {
              setQuery(q)
              navigate('library')
            }}
          />
        )}
        {route === 'scan' && (
          <ScanScreen
            settings={settings}
            onScanned={goToReview}
            onOpenSettings={() => navigate('settings')}
          />
        )}
        {route === 'review' && (
          <ReviewScreen
            items={pending}
            languages={settings.settings.languages}
            onChange={setPending}
            onDone={finishReview}
          />
        )}
        {route === 'library' && (
          <LibraryScreen books={books} query={query} onQueryChange={setQuery} />
        )}
        {route === 'settings' && <SettingsScreen settings={settings} />}
      </main>

      <InstallHint />

      <nav className="tabs" aria-label="Main">
        {TABS.map(([id, label, glyph]) => (
          <button
            key={id}
            type="button"
            aria-current={route === id ? 'page' : undefined}
            onClick={() => navigate(id)}
          >
            <span className="glyph" aria-hidden="true">
              {glyph}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
