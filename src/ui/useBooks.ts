import { useCallback, useEffect, useState } from 'react'
import {
  addBooks,
  deleteBook,
  listBooks,
  requestPersistence,
  updateBook,
  type Book,
  type NewBook,
} from '../storage/db'

export interface BooksApi {
  books: Book[]
  loading: boolean
  reload: () => Promise<void>
  save: (inputs: NewBook[]) => Promise<Book[]>
  edit: (id: string, changes: Partial<Book>) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** The collection, loaded once and kept in memory — search and filtering run over it. */
export function useBooks(): BooksApi {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setBooks(await listBooks())
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    // Asked for once, at startup: it is the browser's own prompt-free API where it
    // exists, and the JSON export is the fallback where it does not.
    void requestPersistence()
  }, [reload])

  const save = useCallback(
    async (inputs: NewBook[]) => {
      const saved = await addBooks(inputs)
      await reload()
      return saved
    },
    [reload],
  )

  const edit = useCallback(
    async (id: string, changes: Partial<Book>) => {
      await updateBook(id, changes)
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteBook(id)
      await reload()
    },
    [reload],
  )

  return { books, loading, reload, save, edit, remove }
}
