/**
 * The whole persistence layer: IndexedDB, two stores, no query language.
 *
 * A book is five fields and a thumbnail, and a personal collection is hundreds of rows,
 * so records and cover Blobs go straight into IndexedDB and search runs in memory over
 * the loaded array. See DECISIONS.md for why there is no SQLite/WASM layer here.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AiMode } from '../pipeline/route'

/** Whether the book has been read yet. */
export type ReadStatus = 'read' | 'unread'

export interface Book {
  id: string
  title: string
  author: string
  /** Books are catalogued before they are read, so a new one starts unread. */
  status: ReadStatus
  /** Epoch milliseconds. */
  dateAdded: number
  dateModified: number
  /** 400px JPEG of the user's own photo — the only part of it that is kept. */
  cover?: Blob
  /** 0–100 detection confidence at capture time. */
  confidence?: number
  source: 'ocr' | 'ai' | 'openlibrary' | 'manual'
  /**
   * Which reader read the cover. Optional because records written before AI reading
   * existed do not carry it; absent means the on-device pipeline.
   */
  reader?: 'ocr' | 'ai'
  /** Raw OCR text, kept so a book can be re-matched against Open Library later. */
  ocrText?: string
  photoCount: number
}

export type LookupMode = 'auto' | 'forced-on' | 'forced-off'

/** `system` follows the phone's own setting; the other two override it. */
export type ThemeChoice = 'system' | 'light' | 'dark'

export interface Settings {
  lookupMode: LookupMode
  languages: ('eng' | 'mkd')[]
  /** Languages whose OCR data has been pulled into the Cache API for offline use. */
  offlineLanguages: ('eng' | 'mkd')[]
  /** Whether to read covers with Gemini when a key is set and the network is really there. */
  aiMode: AiMode
  /**
   * The user's own Gemini key. It is used for direct browser → Google calls and nothing
   * else: never bundled into the build, never logged, and deliberately left out of the JSON
   * backup, which is a file people mail to themselves.
   */
  geminiApiKey: string
  theme: ThemeChoice
}

export const DEFAULT_SETTINGS: Settings = {
  lookupMode: 'auto',
  // Macedonian, because that is what this collection is. English is one tap away, and
  // the Macedonian model is the smaller of the two to download for offline use.
  languages: ['mkd'],
  offlineLanguages: [],
  // On by default, but inert until a key exists — so nothing is ever sent to Google
  // because of a default the user did not choose.
  aiMode: 'auto',
  geminiApiKey: '',
  theme: 'system',
}

/**
 * What actually goes into the object store.
 *
 * The cover is held as raw bytes rather than as a Blob, because WebKit — and therefore
 * every browser on iOS — throws `UnknownError: Error preparing Blob/File data to be
 * stored in object store` when asked to store a Blob produced by a canvas. An
 * ArrayBuffer stores reliably in every engine, so the Blob is rebuilt on the way out.
 */
export interface StoredBook extends Omit<Book, 'cover' | 'status'> {
  coverBytes?: ArrayBuffer
  coverType?: string
  /** Optional: records written before reading status existed do not carry it. */
  status?: ReadStatus
}

interface BookScannerDB extends DBSchema {
  books: {
    key: string
    value: StoredBook
    indexes: { dateAdded: number }
  }
  settings: {
    key: string
    value: unknown
  }
  lookups: {
    key: string
    value: CachedLookup
  }
}

/** One remembered Open Library search. */
export interface CachedLookup {
  query: string
  docs: unknown[]
  cachedAt: number
}

const DB_NAME = 'book-scanner'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<BookScannerDB>> | null = null

export function getDb(): Promise<IDBPDatabase<BookScannerDB>> {
  dbPromise ??= openDB<BookScannerDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('books')) {
        const books = db.createObjectStore('books', { keyPath: 'id' })
        books.createIndex('dateAdded', 'dateAdded')
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings')
      }
      if (!db.objectStoreNames.contains('lookups')) {
        db.createObjectStore('lookups', { keyPath: 'query' })
      }
    },
  })
  return dbPromise
}

/** Test seam: forces the next `getDb()` to reopen. */
export function resetDbForTests(): void {
  dbPromise = null
}

async function toStored(book: Book): Promise<StoredBook> {
  const { cover, ...rest } = book
  if (!(cover instanceof Blob)) return rest
  return { ...rest, coverBytes: await cover.arrayBuffer(), coverType: cover.type || 'image/jpeg' }
}

function fromStored(stored: StoredBook | undefined): Book | undefined {
  if (!stored) return undefined
  const { coverBytes, coverType, ...rest } = stored
  return {
    ...rest,
    // Books saved before reading status existed have none; they are to-be-read.
    status: rest.status ?? 'unread',
    cover: coverBytes ? new Blob([coverBytes], { type: coverType ?? 'image/jpeg' }) : undefined,
  }
}

// ------------------------------------------------------------------ books

export interface NewBook {
  title: string
  author: string
  status?: ReadStatus
  cover?: Blob
  confidence?: number
  source?: Book['source']
  reader?: Book['reader']
  ocrText?: string
  photoCount?: number
}

export async function addBook(input: NewBook): Promise<Book> {
  const now = Date.now()
  const book: Book = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    author: input.author.trim(),
    dateAdded: now,
    dateModified: now,
    cover: input.cover,
    confidence: input.confidence,
    source: input.source ?? 'manual',
    reader: input.reader,
    ocrText: input.ocrText,
    photoCount: input.photoCount ?? 1,
    status: input.status ?? 'unread',
  }
  const db = await getDb()
  await db.put('books', await toStored(book))
  return book
}

export async function addBooks(inputs: NewBook[]): Promise<Book[]> {
  const saved: Book[] = []
  for (const input of inputs) saved.push(await addBook(input))
  return saved
}

/** Newest first. */
export async function listBooks(): Promise<Book[]> {
  const db = await getDb()
  const books = await db.getAllFromIndex('books', 'dateAdded')
  return books.reverse().map((b) => fromStored(b)!)
}

export async function getBook(id: string): Promise<Book | undefined> {
  return fromStored(await (await getDb()).get('books', id))
}

export async function updateBook(
  id: string,
  changes: Partial<Omit<Book, 'id' | 'dateAdded'>>,
): Promise<Book> {
  const db = await getDb()
  const existing = fromStored(await db.get('books', id))
  if (!existing) throw new Error(`No book with id ${id}`)
  const updated: Book = { ...existing, ...changes, id, dateModified: Date.now() }
  await db.put('books', await toStored(updated))
  return updated
}

export async function deleteBook(id: string): Promise<void> {
  await (await getDb()).delete('books', id)
}

export async function countBooks(): Promise<number> {
  return (await getDb()).count('books')
}

// ------------------------------------------------------------------ settings

export async function getSettings(): Promise<Settings> {
  const db = await getDb()
  const stored = (await db.get('settings', 'settings')) as Partial<Settings> | undefined
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function saveSettings(changes: Partial<Settings>): Promise<Settings> {
  const db = await getDb()
  const next = { ...(await getSettings()), ...changes }
  await db.put('settings', next, 'settings')
  return next
}

// ------------------------------------------------------------------ export / import

/** A book with its cover inlined as a data URL, so the backup is a single JSON file. */
interface ExportedBook extends Omit<Book, 'cover'> {
  cover?: string
}

export interface ExportFile {
  format: 'book-scanner-export'
  version: 1
  exported: string
  books: ExportedBook[]
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  // Built from the bytes rather than with FileReader, so it works in a worker and in the
  // test environment as well as on the main thread.
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const [header, base64] = dataUrl.split(',')
  const type = /data:([^;]+)/.exec(header)?.[1] ?? 'image/jpeg'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

export async function exportBooks(): Promise<ExportFile> {
  const books = await listBooks()
  return {
    format: 'book-scanner-export',
    version: 1,
    exported: new Date().toISOString(),
    books: await Promise.all(
      books.map(async ({ cover, ...rest }) => ({
        ...rest,
        // A record whose cover did not survive storage must not take the whole backup
        // down with it — the title and author are what matter most in a restore.
        cover: cover instanceof Blob ? await blobToDataUrl(cover) : undefined,
      })),
    ),
  }
}

export interface ImportResult {
  added: number
  skipped: number
}

/**
 * Restores a backup. Books already present (same id) are left untouched rather than
 * overwritten, so importing the same file twice cannot duplicate or clobber a
 * collection that has moved on since the export.
 */
export async function importBooks(file: unknown): Promise<ImportResult> {
  if (
    typeof file !== 'object' ||
    file === null ||
    (file as ExportFile).format !== 'book-scanner-export' ||
    !Array.isArray((file as ExportFile).books)
  ) {
    throw new Error('That file is not a Book Scanner backup')
  }

  const db = await getDb()
  let added = 0
  let skipped = 0
  for (const entry of (file as ExportFile).books) {
    if (typeof entry?.id !== 'string' || typeof entry.title !== 'string') {
      skipped++
      continue
    }
    if (await db.get('books', entry.id)) {
      skipped++
      continue
    }
    const { cover, ...rest } = entry
    await db.put(
      'books',
      await toStored({
        ...rest,
        author: rest.author ?? '',
        source: rest.source ?? 'manual',
        photoCount: rest.photoCount ?? 1,
        status: rest.status === 'read' ? 'read' : 'unread',
        dateAdded: rest.dateAdded ?? Date.now(),
        dateModified: rest.dateModified ?? Date.now(),
        cover: cover ? await dataUrlToBlob(cover) : undefined,
      }),
    )
    added++
  }
  return { added, skipped }
}

/**
 * Asks the browser to keep this data even under storage pressure. Supported on Chrome
 * and Firefox; Safari ignores it, which is exactly why JSON export exists.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ lookup cache

/** How long a remembered search stays usable. The catalogue barely moves; a month is safe. */
export const LOOKUP_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Remembers Open Library searches on the device.
 *
 * Scanning a shelf asks the same few questions over and over — the same author, the same
 * series — and Open Library throttles a client that repeats itself, which showed up in
 * testing as `Failed to fetch` and a 20-second stall. Caching removes both the wait and
 * the load, and it means a book scanned once can be identified again with no network.
 */
export function createLookupCache<T = unknown>(ttlMs = LOOKUP_TTL_MS) {
  const memory = new Map<string, T[]>()

  return {
    async get(query: string): Promise<T[] | undefined> {
      const key = query.toLowerCase().trim()
      const hit = memory.get(key)
      if (hit) return hit
      try {
        const stored = await (await getDb()).get('lookups', key)
        if (!stored || Date.now() - stored.cachedAt > ttlMs) return undefined
        memory.set(key, stored.docs as T[])
        return stored.docs as T[]
      } catch {
        return undefined
      }
    },
    async set(query: string, docs: T[]): Promise<void> {
      const key = query.toLowerCase().trim()
      memory.set(key, docs)
      try {
        await (await getDb()).put('lookups', { query: key, docs, cachedAt: Date.now() })
      } catch {
        // A full or unavailable store must never fail a scan.
      }
    },
  }
}
