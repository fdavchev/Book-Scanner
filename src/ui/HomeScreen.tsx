import { useState } from 'react'
import { CoverImage } from './CoverImage'
import { OfflineSetup } from './OfflineSetup'
import type { BooksApi } from './useBooks'
import type { SettingsApi } from './useSettings'

export function HomeScreen({
  books,
  settings,
  onScan,
  onSearch,
}: {
  books: BooksApi
  settings: SettingsApi
  onScan: () => void
  onSearch: (query: string) => void
}) {
  const [query, setQuery] = useState('')
  const recent = books.books.slice(0, 4)

  return (
    <>
      <h1>Book Scanner</h1>
      <p className="dim">
        {books.loading
          ? 'Opening your collection…'
          : books.books.length === 0
            ? 'Your collection is empty. Scan a book to start it.'
            : `${books.books.length} book${books.books.length === 1 ? '' : 's'} on this device.`}
      </p>

      <OfflineSetup settings={settings} />

      <button type="button" className="primary big" onClick={onScan}>
        Scan Books
      </button>

      <form
        className="row"
        style={{ marginTop: 16 }}
        onSubmit={(event) => {
          event.preventDefault()
          onSearch(query)
        }}
      >
        <label className="visually-hidden" htmlFor="home-search">
          Search your books
        </label>
        <input
          id="home-search"
          type="search"
          placeholder="Search your books"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>

      {recent.length > 0 && (
        <>
          <h2>Recently added</h2>
          <ul className="book-list">
            {recent.map((book) => (
              <li key={book.id} className="card book-row">
                <CoverImage blob={book.cover} alt="" />
                <div className="meta">
                  <div className="title">{book.title || 'Untitled'}</div>
                  <div className="dim small">{book.author || 'Unknown author'}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
