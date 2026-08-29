/**
 * In-memory search over the loaded collection.
 *
 * A personal library is hundreds of rows, so filtering the array the UI already holds is
 * both simpler and faster than any index — and it keeps working with the network off.
 */
import { normalise, tokens } from '../pipeline/text'
import type { Book } from './db'

type Searchable = Pick<Book, 'title' | 'author'>

/**
 * Every token in the query must appear in the title or author, as a prefix of a word.
 * Prefix matching is what makes the list narrow as you type.
 */
export function searchBooks<T extends Searchable>(books: T[], query: string): T[] {
  const needles = tokens(query)
  if (needles.length === 0) return books

  return books.filter((book) => {
    const haystack = normalise(`${book.title} ${book.author}`)
    const words = haystack.split(' ')
    return needles.every((needle) => words.some((word) => word.startsWith(needle)))
  })
}
