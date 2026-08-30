import { useCallback, useState } from 'react'
import { HomeScreen } from './ui/HomeScreen'
import { ScanScreen } from './ui/ScanScreen'
import { ReviewScreen } from './ui/ReviewScreen'
import { LibraryScreen } from './ui/LibraryScreen'
import { InstallHint } from './ui/InstallHint'
import { useBooks } from './ui/useBooks'
import { useSettings } from './ui/useSettings'
import type { ReviewItem } from './pipeline/group'

export type Route = 'home' | 'scan' | 'review' | 'library'

export default function App() {
  const [route, setRoute] = useState<Route>('home')
  const [pending, setPending] = useState<ReviewItem[]>([])
  const [query, setQuery] = useState('')
  const books = useBooks()
  const settings = useSettings()

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

  return (
    <div className="app">
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
        {route === 'scan' && <ScanScreen settings={settings} onScanned={goToReview} />}
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
      </main>

      <InstallHint />

      <nav className="tabs" aria-label="Main">
        {(
          [
            ['home', 'Home', '⌂'],
            ['scan', 'Scan', '⎙'],
            ['library', 'My Books', '☰'],
          ] as const
        ).map(([id, label, glyph]) => (
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
