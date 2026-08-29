# Book Scanner — project report

Written 29 August 2026. Readable without opening a single source file.

Every claim below is labelled **VERIFIED by automated test**, **VERIFIED by live run**, or
**NOT VERIFIED**. Nothing is reported that was not actually run.

---

## 1. What was built

A working application, not a skeleton. You open it, photograph a book or pick images from
the gallery, the title and author are recognised automatically, you correct anything wrong
on a review card, and it saves into a collection on your own device that you can browse,
search, edit and delete.

It installs to the home screen on Android and iPhone, and once set up it works with the
network switched off. There is no account, no server and no cloud database. Photos never
leave the device.

**Everything the plan asked for was built.** The optional Android APK (phase 8, "cut
first") was not attempted — see §8.

## 2. Where the code is

```
src/
  pipeline/        the recognition pipeline, pure and testable
    preprocess.ts    EXIF rotation, resize, grayscale, contrast, Otsu, cover thumbnail
    ocr.ts           tesseract.js worker pool, vendored assets, retry logic
    candidates.ts    noise filtering, line grouping, title/author scoring   ← the heart
    enrich.ts        Open Library client, fuzzy match gate, connectivity probe
    group.ts         merging several photos of one book
    text.ts          normalising, similarity, title-casing
  storage/
    db.ts            IndexedDB, CRUD, settings, JSON export/import
    search.ts        in-memory token search
  offline/
    ocrAssets.ts     the "set up offline scanning" download
  ui/                screens, hooks, the lookup pill, crop-and-rescan
scripts/
  vendor-ocr.mjs     copies OCR assets out of node_modules (runs on npm install)
  make-fixtures.mjs  renders the cover fixtures
  fetch-benchmark.mjs downloads real covers from Open Library
  benchmark.mjs      measures accuracy through the real browser pipeline
  make-icons.mjs     renders the app icons
  deploy.mjs         publishes dist/ to GitHub Pages
tests/e2e/           Playwright: the full flow, and the offline guarantee
```

## 3. How scanning, OCR and detection work

**Preprocess.** The photo is decoded with its EXIF rotation applied, resized so its long
edge is 1600px, and a 400px JPEG cover thumbnail is produced. That thumbnail is the only
part of the photo that is ever stored — the original is discarded.

**OCR.** A small pool of tesseract.js workers (2 on a phone, up to 4 elsewhere) reads the
image entirely on the device. Everything they need — the worker script, the WASM core and
the language data — is served from the app itself, never from a CDN.

The resized colour image is read first, un-thresholded. That ordering is measured, not
assumed: pre-binarising the image lost covers outright (see §5). If the first pass comes
back weak, the binarised version gets a second attempt and the better result wins. Tall
narrow images are treated as spines and read in sparse-text mode.

**Detection.** The dominant signal is glyph height — on nearly every cover the title is the
largest text on the page. Lines that are never a title are dropped first (`A NOVEL`,
bestseller flashes, prize mentions, imprint names, ISBNs, prices, URLs). Remaining lines
are grouped into visual blocks so a two-line title is scored as one phrase. Then title
score = height + upper position + word count + letter ratio + confidence; author score =
`by …` prefix + name shape + edge position + being smaller than the title.

The card shows the winner, the runners-up in a dropdown, a 0–100 confidence and a reason in
words — "largest text, upper third, 96% OCR confidence".

**Open Library (optional).** The detection is queried against the catalogue and a result is
accepted **only if it already agrees** with what OCR read. It corrects spelling and fills
in a missing author; it never replaces a book with an unrelated one.

## 4. What was tested

### Unit tests — 103, all passing (VERIFIED by automated test)

`npm test`. Run against the real modules with `fake-indexeddb` for storage.

| Area | What is covered |
|---|---|
| Noise filtering | 15 cover-noise strings rejected, 6 real titles kept, publisher words inside a title kept |
| Name shape | initials, function-word penalty, `by` prefix handling |
| Line grouping | two-line titles merged, author kept separate, columns not merged, noise dropped, low-confidence lines dropped |
| Title/author detection | title at top / middle / bottom, `by` lines, all-caps tidying, alternates, empty input, the human-readable reason, confidence falling when the race is close |
| Text utilities | normalising incl. Cyrillic, edit distance, similarity under OCR damage, letter ratio, title-casing |
| Open Library | query shape, HTTP errors, the match gate accepting and rejecting, matching via an alternate, edition tie-break, offline failure keeping the OCR result |
| Connectivity | `auto` / `forced-on` / `forced-off` behaviour and the pill's wording in each state |
| Grouping | one card per photo, duplicates merged, most-confident reading kept, blank titles never merged, split and merge |
| Storage | CRUD, trimming, defaults, ordering, cover bytes round-tripping, settings merge, export/import incl. malformed files |
| Search | title and author, case/accents, multi-token narrowing, Cyrillic, prefix matching |

### End-to-end tests — 25 passing, 2 skipped (VERIFIED by automated test)

`npm run test:e2e`. Run against the **built** app served by `vite preview`, so the service
worker and manifest are real. Three device profiles: Desktop Chrome, **Pixel 7**
(Chromium), and **iPhone 14 (WebKit — the same engine Safari uses)**.

- scan a cover → title and author detected → save → appears in My Books
- correct a wrong detection before saving, and the correction is what is stored
- **reload the page and the books are still there, cover image included** — the image is
  re-rendered from storage with a non-zero natural width, so the bytes really persisted
- search narrows the library → open a book → edit → delete
- two photos of the same book collapse into one card reading "from 2 photos"
- the lookup pill cycles auto → off → on and stays enabled throughout
- the manifest exists, is `standalone`, has 192/512/maskable icons and an apple-touch-icon,
  and every icon file actually resolves
- the app is built for a **GitHub Pages subpath**, served from one, and scanned through it —
  the case the recommended install route actually produces

Both skips are on the iPhone/WebKit project: the offline cold start, for the reason given
below, and the subpath build, where one engine is enough to prove the URLs resolve.

### The offline guarantee (VERIFIED by automated test, Chromium)

Tested as a first-class case, in the real sequence:

1. load the built app and wait for the service worker to become active
2. run the first-run **Set up offline scanning** download
3. `context.setOffline(true)`
4. **reload — a genuine cold start with no network**
5. the app boots, the lookup pill reads `Off · offline` **and is still clickable**
6. a cover is scanned, OCR runs, the title is detected correctly (`Thirteen Doors`)
7. the book saves, and survives another offline reload

This is the claim most worth distrusting, so it is checked end to end rather than asserted.
It runs on Chromium and Pixel; WebKit is skipped because service-worker-aware offline
emulation is a Chromium capability, not because the app behaves differently there.

### Mobile behaviour (VERIFIED by automated test)

The whole flow passes at Pixel 7 and iPhone 14 viewports with touch emulation. The WebKit
run is the one that found the storage bug in §5.

## 5. Two real bugs the tests found

Worth recording, because both would have shipped.

**Saving a book failed on every iPhone.** WebKit refuses to store a canvas-produced Blob
in IndexedDB — `UnknownError: Error preparing Blob/File data to be stored in object store`.
Scanning worked, the review card appeared, and pressing Save did nothing. Covers are now
stored as raw bytes and rebuilt as Blobs on read. Fixed and covered by tests.

**Offline setup cached the wrong OCR engine.** Six WASM cores are vendored and the browser
picks one by feature detection. The first implementation guessed — and guessed wrong on
Chromium, which takes the relaxed-SIMD build. Setup said "ready" while caching a file that
was never requested, so offline scanning failed in exactly the situation the feature exists
for. Setup now boots a real worker so the browser fetches the core it will actually use.
"Ready" now means the engine has demonstrably run once.

## 6. Measured accuracy

Numbers, not adjectives. Full per-cover tables are in `docs/accuracy-*.md`. All figures are
OCR-only, with no Open Library lookup, run through the real browser pipeline.

### Rendered covers at photo resolution — the representative case

15 covers at 1200×1800, varied layouts: title at top / centre / bottom, all-caps and title
case, serif and sans, light-on-dark and dark-on-light, multi-line titles, `by` prefixes, and
the usual cover noise.

| Set | Title exact | Title fuzzy | Author found | Median time |
|---|---|---|---|---|
| Clean | **15/15 (100%)** | 15/15 | **15/15 (100%)** | 200 ms |
| Degraded — 3° rotation, blur, 85% brightness, JPEG q40 | **13/15 (87%)** | 13/15 | **14/15 (93%)** | 235 ms |

### Real Open Library covers — the documented limit

15 genuine covers downloaded from `covers.openlibrary.org`. These arrive as **300×500
artwork thumbnails**.

| Set | Title exact | Title fuzzy | Author found |
|---|---|---|---|
| Clean | 1/15 (7%) | 3/15 (20%) | 0/15 (0%) |
| Degraded | 0/15 | 0/15 | 0/15 |

**This is reported deliberately rather than buried.** Tesseract cannot read low-resolution
stylised cover artwork, and no amount of tuning changed that: page-segmentation mode,
assumed DPI, upscale factor from 1× to 4×, and the full 10.9 MB language model instead of
the 2.9 MB one were all swept, and nothing exceeded 3/15.

The reason the two sets differ so much is resolution, not luck. A photo of a physical book
is thousands of pixels wide, with the title hundreds of pixels tall — the upper table's
conditions. A 500px-tall thumbnail of the same cover has a title barely 80px tall, and
tesseract's LSTM engine has nothing to work with. Filip will be photographing physical
books, so the upper table is the case that matters; the lower table is the honest boundary
of what the app can do.

### Other measurements

- **Median scan time:** 200 ms per cover (Chromium, desktop). A phone will be slower.
- **Cover thumbnail:** 6–17 KB per book. A thousand books is under 20 MB.
- **App shell:** 275 KB precached; the JS bundle is 253 KB (82 KB gzipped).
- **Offline download:** ~7 MB for English, ~8 MB for English + Macedonian. The plan
  estimated ~14 MB per language; the integer-quantised models are far smaller and,
  measured, no less accurate.

### The published site (VERIFIED by live run)

The app is deployed at **https://fdavchev.github.io/Book-Scanner/** and was driven against
that live address, not a local server:

- the page loads and the manifest resolves with `start_url` and `scope` of `/Book-Scanner/`
- the vendored OCR asset list resolves under the subpath
- a cover was scanned through the live site and detected as
  **"The Glass Cathedral" / "Amara Osei"** — correct
- it saved and appeared in My Books

This matters because GitHub Pages serves a project site from a subpath rather than the
domain root, which breaks any app that assumes it is at `/`. That case has its own
end-to-end test (`tests/e2e/subpath.spec.ts`) as well as this live run.

## 7. What is NOT VERIFIED

Stated plainly.

- **Installing on a physical iPhone.** There is no iPhone in this environment. The site
  it would install from is live and verified (above). The iOS
  install steps in `docs/install-on-your-phone.md` are written from Apple's documented
  behaviour. The app's side of it *is* verified: the manifest, the apple-touch-icon, the
  iOS meta tags, and the Add-to-Home-Screen hint that only appears on iOS Safari. The
  WebKit test run means the app logic works on Safari's engine.
- **Installing on a physical Android phone.** Same: the manifest and icons are verified,
  the install prompt is standard Chrome behaviour, but no APK-side install was performed.
  **The Android emulator install and airplane-mode launch described in the plan were not
  run** — the emulator was not started in this session.
- **The offline cold start on WebKit.** Verified on Chromium and Pixel only; the test is
  skipped on WebKit because Playwright's offline emulation does not cover service workers
  there.
- **Real camera capture.** The `<input capture>` path cannot be exercised by an automated
  test; the file-picker path through the identical code is verified.
- **Open Library against the live API during tests.** The client is unit-tested with a
  mocked fetch, including the offline path. The live API was confirmed reachable and
  accurate while building the benchmark set (**VERIFIED by live run**: 15/15 books resolved
  correctly by title and author), but the e2e tests do not depend on the network.
- **Long-term iOS storage retention.** Cannot be tested in an afternoon. This is why JSON
  export exists.

## 8. What was not built

**The Android APK (plan phase 8, marked "cut first").** Not attempted. It was explicitly a
stretch item to be done only after everything else was finished and verified, it does
nothing for the iPhone — which was the harder half of the requirement — and the remaining
budget was better spent on the two real bugs in §5 and on the accuracy measurement. The
groundwork is unaffected: the build is a static bundle, Capacitor wraps it without a
rewrite, and the SDK and JDK 21 are on this machine.

## 9. Known limitations

- Heavy typography, handwriting, reflective or textured covers, and small print all degrade
  detection. The review step exists because of this.
- One book per photo by default; shelves are handled by *Crop & rescan*, one at a time.
- English and Macedonian only.
- iOS may evict a web app's storage when the phone is very low on space.
  `navigator.storage.persist()` is requested where supported and Safari ignores it. Export
  regularly.
- The Open Library lookup needs the internet. Everything else does not.

## 10. If you have five minutes

1. Follow `docs/install-on-your-phone.md`, Part 0 Route B, to publish the app.
2. Install it on the iPhone (Part 2) and confirm the icon opens without an address bar.
3. Do Part 3 (offline setup) and Part 4 (airplane-mode test).

That would move the three largest NOT VERIFIED items into verified, and it is the only
thing this environment could not do for itself.
