import { useState } from 'react'
import { CoverImage } from './CoverImage'
import { searchBooks } from '../storage/search'
import { exportBooks, importBooks, type Book } from '../storage/db'
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

  async function handleExport() {
    const file = await exportBooks()
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `book-scanner-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setNotice(`Exported ${file.books.length} books.`)
  }

  async function handleImport(file: File | undefined) {
    if (!file) return
    try {
      const result = await importBooks(JSON.parse(await file.text()))
      await books.reload()
      setNotice(`Added ${result.added} books, skipped ${result.skipped} already here.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
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

      <h2>Backup</h2>
      <p className="small dim">
        Your books live only on this device. Export a copy now and then — it is the way to
        move them to a new phone, and the way back if the browser ever clears its storage.
      </p>
      <div className="row">
        <button type="button" onClick={handleExport}>
          Export to a file
        </button>
        <label className="pill" style={{ textTransform: 'none', letterSpacing: 0 }}>
          Import a backup
          <input
            type="file"
            accept="application/json"
            className="visually-hidden"
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
