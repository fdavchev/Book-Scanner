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
  const total = books.books.length
  const read = books.books.filter((b) => b.status === 'read').length

  return (
    <div className="fade-in">
      <div className="hero">
        <h1>Book Scanner</h1>
        <p className="dim">
          {books.loading
            ? 'Opening your collection…'
            : total === 0
              ? 'Your collection is empty. Photograph a cover to start it.'
              : `${total} book${total === 1 ? '' : 's'}, kept on this device.`}
        </p>
      </div>

      {total > 0 && (
        <div className="stats">
          <div className="stat">
            <span className="n">{total}</span>
            <span className="k">In total</span>
          </div>
          <div className="stat read">
            <span className="n">{read}</span>
            <span className="k">Read</span>
          </div>
          <div className="stat unread">
            <span className="n">{total - read}</span>
            <span className="k">To read</span>
          </div>
        </div>
      )}

      <OfflineSetup settings={settings} />

      <button type="button" className="primary big" onClick={onScan}>
        Scan Books
      </button>

      <form
        className="row"
        style={{ marginTop: 14 }}
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

      {books.loading && (
        <>
          <h2>Recently added</h2>
          <div className="stack tight" aria-hidden="true">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        </>
      )}

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
    </div>
  )
}
