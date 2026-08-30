import { useState } from 'react'
import { CoverImage } from './CoverImage'
import { searchBooks } from '../storage/search'
import type { Book } from '../storage/db'
import { describeBackup, exportToFile, importFromFile } from '../storage/backup'
import type { BooksApi } from './useBooks'

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
  const results = searchBooks(books.books, query)

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
    <>
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

      <p className="dim small" style={{ marginTop: 8 }}>
        {results.length} of {books.books.length} book{books.books.length === 1 ? '' : 's'}
      </p>

      {results.length === 0 ? (
        <p className="empty">
          {books.books.length === 0
            ? 'No books yet. Scan one from the Scan tab.'
            : 'Nothing matches that search.'}
        </p>
      ) : (
        <ul className="book-list">
          {results.map((book) => (
            <li key={book.id}>
              <button
                type="button"
                className="card book-row"
                onClick={() => setOpen(book)}
                data-testid="book-row"
              >
                <CoverImage blob={book.cover} alt="" />
                <div className="meta">
                  <div className="title">{book.title || 'Untitled'}</div>
                  <div className="dim small">{book.author || 'Unknown author'}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2>Backup &amp; moving to a new phone</h2>
      <p className="small dim">
        Your books live only on this device. <strong>Export</strong> writes them, covers
        included, to a single file. On the new phone, install the app and{' '}
        <strong>Import</strong> that file — everything comes back.
      </p>
      <div className="row">
        <button type="button" onClick={handleExport} disabled={busy} data-testid="export-books">
          {busy ? 'Working…' : 'Export to a file'}
        </button>
        <label className="pill" style={{ textTransform: 'none', letterSpacing: 0 }}>
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
      {notice && <p className="small dim">{notice}</p>}
    </>
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

  return (
    <>
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
        <p className="small dim" style={{ margin: 0 }}>
          Added {new Date(book.dateAdded).toLocaleDateString()} ·{' '}
          {book.source === 'openlibrary' ? 'matched via Open Library' : book.source}
          {book.photoCount > 1 ? ` · from ${book.photoCount} photos` : ''}
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => void onSave({ title, author })}
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
    </>
  )
}
