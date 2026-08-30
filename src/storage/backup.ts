/**
 * Getting a collection off one phone and onto another.
 *
 * The books live only on the device, so this file is the only way to move them — and the
 * only way back after a browser clears its storage. It has to work on a phone, which is
 * the whole difficulty: an installed iOS web app cannot reliably save a file by clicking a
 * link, and fails silently when it can't, so the user is told the backup worked when
 * nothing was written. The share sheet is used where it exists and the link only as a
 * fallback, and the result says which happened.
 */
import { exportBooks, importBooks, type ImportResult } from './db'

/** The file name a backup is offered under. Dated, so successive backups do not collide. */
export function backupFilename(now = new Date()): string {
  return `book-scanner-${now.toISOString().slice(0, 10)}.json`
}

export type DeliveryMethod = 'shared' | 'downloaded'

export interface BackupResult {
  books: number
  bytes: number
  method: DeliveryMethod
  filename: string
}

/**
 * Plain JSON, with each cover inlined as a data URL.
 *
 * A zip would avoid base64's third-of-a-file overhead, but it needs either a library or a
 * hand-written archive writer, and the covers are already-compressed JPEG so the archive
 * would barely shrink. A single readable file that any phone, laptop or mail client can
 * carry — and that can be inspected if a restore ever goes wrong — is worth more than the
 * megabytes. A thousand books is roughly 20 MB.
 */
export async function createBackupBlob(): Promise<{ blob: Blob; books: number }> {
  const file = await exportBooks()
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
  return { blob, books: file.books.length }
}

/**
 * Hands the backup to the user by whatever route this device actually supports.
 *
 * `navigator.share` with a file opens the system share sheet — Save to Files, AirDrop,
 * Mail — which is the only route that works inside an installed app on iOS. Cancelling
 * the sheet is not an error, and is reported as such rather than as a failure.
 */
export async function deliverBackup(
  blob: Blob,
  filename: string,
  navigatorRef: Navigator = navigator,
): Promise<DeliveryMethod> {
  const file = new File([blob], filename, { type: 'application/json' })

  if (navigatorRef.canShare?.({ files: [file] })) {
    try {
      await navigatorRef.share({ files: [file], title: 'Book Scanner backup' })
      return 'shared'
    } catch (err) {
      // AbortError means the user closed the sheet; anything else falls back to a download.
      if (err instanceof Error && err.name === 'AbortError') throw err
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    return 'downloaded'
  } finally {
    // Revoked on the next tick so the browser has started the download first.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

export async function exportToFile(navigatorRef: Navigator = navigator): Promise<BackupResult> {
  const { blob, books } = await createBackupBlob()
  const filename = backupFilename()
  const method = await deliverBackup(blob, filename, navigatorRef)
  return { books, bytes: blob.size, method, filename }
}

/**
 * Reads a backup file back in.
 *
 * The parse is guarded separately from the import so that a wrong file — a photo, a PDF,
 * a truncated download — produces a sentence a person can act on instead of a raw
 * `SyntaxError: Unexpected token`.
 */
export async function importFromFile(file: File): Promise<ImportResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error(
      `“${file.name}” is not a readable backup file. Pick the .json file the app exported.`,
    )
  }
  return importBooks(parsed)
}

export function describeBackup(result: BackupResult): string {
  const size =
    result.bytes < 1024 * 1024
      ? `${Math.round(result.bytes / 1024)} KB`
      : `${(result.bytes / (1024 * 1024)).toFixed(1)} MB`
  return result.method === 'shared'
    ? `${result.books} books (${size}) — choose where to save it.`
    : `${result.books} books (${size}) saved as ${result.filename}.`
}
