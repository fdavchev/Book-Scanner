import { useState } from 'react'
import { CoverImage } from './CoverImage'
import { searchBooks } from '../storage/search'
import type { Book, ReadStatus } from '../storage/db'
import { describeBackup, exportToFile, importFromFile } from '../storage/backup'
import type { BooksApi } from './useBooks'

type ViewMode = 'list' | 'grid'

export function LibraryScreen({
  books,
  query,
  onQueryChange,
}: {
  books: BooksApi
  query: string
  onQueryChange: (query: string) => void
}) {
  const [open, setOpen] = useState<Book>()
  const [notice, setNotice] = useState<string>()
  const [filter, setFilter] = useState<'all' | ReadStatus>('all')
  const [view, setView] = useState<ViewMode>('list')
  const results = searchBooks(books.books, query).filter(
    (book) => filter === 'all' || book.status === filter,
  )
  const unreadCount = books.books.filter((b) => b.status === 'unread').length

  const [busy, setBusy] = useState(false)

  async function handleExport() {
    setBusy(true)
    setNotice(undefined)
    try {
      setNotice(describeBackup(await exportToFile()))
    } catch (err) {
      // Closing the share sheet is a choice, not a failure.
      if (err instanceof Error && err.name === 'AbortError') setNotice(undefined)
      else setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setNotice(undefined)
    try {
      const result = await importFromFile(file)
      await books.reload()
      setNotice(
        result.added === 0 && result.skipped > 0
          ? `Nothing new — all ${result.skipped} books in that file are already here.`
          : `Added ${result.added} book${result.added === 1 ? '' : 's'}` +
              (result.skipped > 0 ? `, skipped ${result.skipped} already here.` : '.'),
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (open) {
    return (
      <BookEditor
        book={open}
        onClose={() => setOpen(undefined)}
        onSave={async (changes) => {
          await books.edit(open.id, changes)
          setOpen(undefined)
        }}
        onDelete={async () => {
          await books.remove(open.id)
          setOpen(undefined)
        }}
      />
    )
  }

  return (
    <div className="fade-in">
      <h1>My Books</h1>

      <label className="visually-hidden" htmlFor="library-search">
        Search your books
      </label>
      <input
        id="library-search"
        type="search"
        placeholder="Search title or author"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        data-testid="library-search"
      />

      <div className="row between" style={{ marginTop: 10 }}>
        <div className="row">
          {(
            [
              ['all', `All ${books.books.length}`],
              ['unread', `To read ${unreadCount}`],
              ['read', `Read ${books.books.length - unreadCount}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`pill ${filter === value ? 'on' : 'off'}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              data-testid={`filter-${value}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="segmented" role="group" aria-label="Layout">
          {(
            [
              ['list', 'List'],
              ['grid', 'Covers'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              data-testid={`view-${value}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="dim small" style={{ marginTop: 10 }}>
        Showing {results.length} of {books.books.length} book
        {books.books.length === 1 ? '' : 's'}
      </p>

      {results.length === 0 ? (
        <p className="empty">
          <span className="glyph" aria-hidden="true">
            ☰
          </span>
          {books.books.length === 0
            ? 'No books yet. Scan one from the Scan tab.'
            : 'Nothing matches that search.'}
        </p>
      ) : (
        <ul className={`book-list ${view === 'grid' ? 'grid' : ''}`}>
          {results.map((book) => (
            <li key={book.id} className="card book-row" data-testid="book-row">
              <button
                type="button"
                className="row-open"
                onClick={() => setOpen(book)}
                data-testid="open-book"
              >
                <CoverImage blob={book.cover} alt="" />
                <div className="meta">
                  <div className="title">{book.title || 'Untitled'}</div>
                  <div className="dim small">{book.author || 'Unknown author'}</div>
                </div>
              </button>
              <StatusButton
                status={book.status}
                onToggle={() =>
                  void books.edit(book.id, {
                    status: book.status === 'read' ? 'unread' : 'read',
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <h2>Backup &amp; moving to a new phone</h2>
      <div className="card stack">
        <p className="small dim" style={{ margin: 0 }}>
          Your books live only on this device. <strong>Export</strong> writes them, covers
          included, to a single file. On the new phone, install the app and{' '}
          <strong>Import</strong> that file — everything comes back.
        </p>
        <div className="row">
          <button type="button" onClick={handleExport} disabled={busy} data-testid="export-books">
            {busy ? 'Working…' : 'Export to a file'}
          </button>
          <label className="pill" style={{ textTransform: 'none', letterSpacing: 0, margin: 0 }}>
            Import a backup
            <input
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              data-testid="import-books"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
          </label>
        </div>
        {notice && (
          <p className="small dim" style={{ margin: 0 }}>
            {notice}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The read/unread control: green when read, red when still to be read.
 *
 * A button rather than a decoration, and separate from the row's own button, so marking a
 * book read is one tap from the list — that is the action you take most often, and it does
 * not deserve a trip through the editor. (Nesting it inside the row button would also be
 * invalid HTML.)
 */
function StatusButton({
  status,
  onToggle,
  wide = false,
}: {
  status: ReadStatus
  onToggle: () => void
  wide?: boolean
}) {
  const read = status === 'read'
  return (
    <button
      type="button"
      className={`status ${read ? 'read' : 'unread'}${wide ? ' wide' : ''}`}
      onClick={onToggle}
      aria-pressed={read}
      data-testid="status-toggle"
      data-status={status}
      title={read ? 'Read — tap to mark as still to read' : 'To read — tap to mark as read'}
    >
      <span className="dot" aria-hidden="true" />
      {read ? 'Read' : 'To read'}
    </button>
  )
}

function BookEditor({
  book,
  onClose,
  onSave,
  onDelete,
}: {
  book: Book
  onClose: () => void
  onSave: (changes: Partial<Book>) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.author)
  const [status, setStatus] = useState(book.status)

  return (
    <div className="fade-in">
      <h1>Edit book</h1>
      <div className="card stack">
        <CoverImage blob={book.cover} alt="" large />
        <div className="field">
          <label htmlFor="edit-title">Title</label>
          <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="edit-author">Author</label>
          <input id="edit-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="edit-status">Have you read it?</label>
          <StatusButton
            wide
            status={status}
            onToggle={() => setStatus(status === 'read' ? 'unread' : 'read')}
          />
        </div>
        <p className="small dim" style={{ margin: 0 }}>
          Added {new Date(book.dateAdded).toLocaleDateString()}
          {/* Books saved before AI reading existed carry no reader, and claiming one for
              them would be an invention. Those fall back to what was recorded: the source. */}
          {book.reader
            ? ` · ${book.reader === 'ai' ? 'read via AI' : 'read on device'}`
            : ` · ${book.source === 'openlibrary' ? 'matched via Open Library' : book.source}`}
          {book.reader && book.source === 'openlibrary' ? ' · matched in the catalogue' : ''}
          {book.photoCount > 1 ? ` · from ${book.photoCount} photos` : ''}
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => void onSave({ title, author, status })}
            data-testid="save-edit"
          >
            Save changes
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            data-testid="delete-book"
            onClick={() => {
              if (window.confirm(`Delete “${book.title}”? This cannot be undone.`)) {
                void onDelete()
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
