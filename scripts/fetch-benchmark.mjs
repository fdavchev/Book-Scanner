/**
 * Downloads a benchmark set of real book covers from covers.openlibrary.org.
 *
 * The images are gitignored — this script exists so the accuracy numbers in
 * docs/project-report.md can be reproduced from a clean checkout.
 *
 *   npm run fetch-benchmark
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'benchmark',
)

/** The books to benchmark against. The cover image and the ground-truth strings are
 *  both resolved from Open Library's search API, so the recorded title/author always
 *  match the artwork that was actually downloaded. */
export const WANTED = [
  'The Hobbit Tolkien',
  'Dune Frank Herbert',
  'The Great Gatsby Fitzgerald',
  'To Kill a Mockingbird Harper Lee',
  'Nineteen Eighty-Four George Orwell',
  'Pride and Prejudice Jane Austen',
  'The Catcher in the Rye Salinger',
  'Fahrenheit 451 Ray Bradbury',
  'Brave New World Aldous Huxley',
  'The Fellowship of the Ring Tolkien',
  'Slaughterhouse-Five Kurt Vonnegut',
  'Beloved Toni Morrison',
  "The Handmaid's Tale Margaret Atwood",
  'The Road Cormac McCarthy',
  'Neuromancer William Gibson',
]

async function resolve_(query) {
  const url =
    'https://openlibrary.org/search.json?q=' +
    encodeURIComponent(query) +
    '&limit=5&fields=title,author_name,cover_i,first_publish_year'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`search HTTP ${res.status}`)
  const data = await res.json()
  return (data.docs ?? []).find((d) => d.cover_i && d.title && d.author_name?.length)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const kept = []
  for (const query of WANTED) {
    const id = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    try {
      const doc = await resolve_(query)
      if (!doc) {
        console.log(`  skip ${id}: no result with a cover`)
        continue
      }
      const res = await fetch(`https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`)
      const bytes = Buffer.from(await res.arrayBuffer())
      if (!res.ok || bytes.length < 8000) {
        console.log(`  skip ${id}: cover unusable (${bytes.length} bytes)`)
        continue
      }
      await writeFile(join(outDir, `${id}.jpg`), bytes)
      kept.push({
        id,
        file: `${id}.jpg`,
        title: doc.title,
        author: doc.author_name[0],
        bytes: bytes.length,
      })
      console.log(`  got  ${id} — "${doc.title}" / ${doc.author_name[0]} (${(bytes.length / 1024).toFixed(0)} KB)`)
    } catch (err) {
      console.log(`  skip ${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  await writeFile(join(outDir, 'ground-truth.json'), JSON.stringify(kept, null, 2) + String.fromCharCode(10))
  console.log(`${String.fromCharCode(10)}${kept.length}/${WANTED.length} covers downloaded into ${outDir}`)
}

main()
