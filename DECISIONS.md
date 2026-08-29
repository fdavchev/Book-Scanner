# Decisions

One entry per non-obvious call, with the reasoning. Several of these were forced by
measurement rather than chosen up front; those say so and give the numbers.

---

## An installable PWA, not a native app

**Both** Android and iPhone were required, from one codebase, with no Mac and no store
account. That rules out native Kotlin (Android only), Flutter and React Native (iOS still
needs a Mac to build), and anything server-based (kills local-first and phone ergonomics).

An installable PWA gives a home-screen icon, a standalone window, camera access, local
storage and genuine offline operation on both platforms. Capacitor can wrap the same build
into an APK later without a rewrite.

The cost is the install flow: iOS shows no install prompt, so the app detects iOS Safari
and explains *Share → Add to Home Screen* itself.

## No database

A book is five fields and a thumbnail; a personal collection is hundreds of rows. IndexedDB
stores the records directly and search runs in memory over the array the UI already holds.

SQLite-on-WASM would have added a ~1 MB dependency, a persistence shim to get the database
file into IndexedDB anyway, and a query layer — for a dataset that fits comfortably in a
`filter()` call. It would also have been another thing to load before the app could start.

If the collection ever reached tens of thousands of books this would be worth revisiting.
It will not.

## Cover images are stored as bytes, not as Blobs

**This one is a real bug fix, found by testing in WebKit.**

The obvious design is `cover?: Blob` written straight into IndexedDB. It works in Chromium
and fails in WebKit — the engine behind every browser on iOS — with:

```
UnknownError: Error preparing Blob/File data to be stored in object store
```

Saving a scanned book therefore failed silently on iPhone, which is half the target
platform. The storage layer now converts the cover to an `ArrayBuffer` on the way in and
rebuilds a `Blob` on the way out. The public `Book` type still exposes `cover?: Blob`, so
nothing above `storage/db.ts` knows about it.

A side benefit: `ArrayBuffer` survives `fake-indexeddb`'s structured clone, which Blobs do
not, so the unit tests can now assert the cover bytes round-trip rather than just checking
the field exists.

## OCR reads the un-thresholded image first

The plan called for grayscale → contrast stretch → Otsu binarisation before OCR, which is
the textbook preprocessing recipe. Measured on the benchmark set, it **lost covers
outright**:

| Cover | Binarised | Untouched |
|---|---|---|
| *The Road* (white type on black) | 0 lines | `THE ROAD`, 96% confidence |
| *Neuromancer* | `New yo` | `Neuromancer` |

Tesseract 5 does its own adaptive thresholding, and it is better at it than a single global
threshold applied to cover art with gradients and photographic backgrounds. Pre-binarising
throws away the information it needs.

The pipeline now reads the resized colour image first and falls back to the binarised
version only when the first pass comes back weak — which is the case binarisation genuinely
helps: a flat, evenly-lit photo of a matte cover.

The aggressive 2%/98% contrast stretch was also cut to 0.5%/99.5%, and is skipped entirely
when the image already uses most of the tonal range, for the same reason.

## Tesseract is told the resolution instead of estimating it

Tesseract logs `Estimating resolution as 157` on cover images and then discards text as too
small to be text. Its LSTM engine expects roughly 300 DPI. Setting `user_defined_dpi: 300`
recovered covers that had previously returned nothing.

Related: `SetVariable` takes **strings**. Passing `tessedit_pageseg_mode` as a number is
silently ignored — a whole parameter sweep came back with ten identical rows before that
was spotted.

## The line-merge rule is loose on height, tight on gap

A title wrapped across two lines has to be merged back into one candidate. The natural test
— "similar glyph height and close together" — failed, because tesseract reports the two
halves of one title at wildly different heights (164px and 85px for the same words, since
it pads the first line's boxes up to whatever sits above it).

So the height tolerance is deliberately loose (ratio > 0.45) and the vertical gap does the
real work (under 0.6 × the taller line), backed by a horizontal-overlap test so two columns
never merge. That change took the rendered benchmark from 13/15 to **15/15** exact titles.

## `best_int` language data, not the full `best` model

`@tesseract.js-data` ships both. Measured over the benchmark set they were
indistinguishable — identical exact/fuzzy/author counts at every setting tried — while
`best_int` is 2.9 MB against 10.9 MB for English.

Since this is a file the user downloads onto a phone, the smaller one wins on evidence
rather than on faith.

## Offline setup boots a real OCR worker

Six WASM cores are vendored (plain, SIMD and relaxed-SIMD, each in an LSTM build). Which
one the browser asks for is decided by its own feature detection.

The first implementation feature-detected the variant and cached that file. It guessed
wrong on Chromium — which takes the relaxed-SIMD build — so setup reported "ready" while
caching a core that was never requested, and offline scanning failed in exactly the
situation the feature exists for. The end-to-end offline test caught it.

Setup now downloads the worker and language data, then **starts a real tesseract worker**.
The browser fetches whichever core it actually wants, through the service worker, so the
right file is cached by definition — and "ready" now means the engine has demonstrably run
once, not that a list of URLs was fetched.

## The OCR assets are vendored, never fetched from a CDN

`scripts/vendor-ocr.mjs` runs on `postinstall` and copies the worker, the WASM cores and
the language data out of `node_modules` into `public/tesseract/`, with `workerPath`,
`corePath` and `langPath` pointed there. tesseract.js defaults to a CDN, which would mean
the app silently required the internet to scan.

They are deliberately **not** precached by the service worker — 30 MB of cores for a device
that needs one of them. They are cached on demand by a CacheFirst route instead.

## The lookup control lives in the scan header and is never disabled

Per Filip's instruction. Connectivity is decided by a real reachability probe rather than
`navigator.onLine`, which reports "online" for any local connection including hotel Wi-Fi
that goes nowhere.

Detection *sets* the control; it never *locks* it. Tapping always cycles
auto → off → on, and forcing it on while the probe says offline still attempts the call,
failing softly to the OCR result for that book. The probe can be wrong, and the user
overruling it is a legitimate thing to want.

## Open Library can correct a detection but never replace it

A result is accepted only when it already agrees with what OCR read — the best title
similarity against the detection or one of its alternates must clear 0.6. Otherwise a noisy
query would confidently overwrite a book with an unrelated one, which is worse than the
imperfect OCR text.

The author is a tie-breaker between editions, not a requirement: plenty of covers set the
author in type tesseract cannot read at all.

## One book per photo, with crop-and-rescan for shelves

Automatic multi-book segmentation of a shelf photo is a research problem and unreliable in
practice. Dragging a box around one book and re-running the pipeline on that crop takes two
seconds and works every time. It is the honest trade.

## Images are processed strictly one at a time

WebKit enforces a per-tab memory ceiling, and decoding a whole gallery selection at once is
a reliable way to have the tab killed mid-scan. Each photo is decoded, processed and its
`ImageBitmap` closed before the next one starts. The worker pool is capped at 2 on mobile
and 4 elsewhere.

## Two benchmark sets, and both are reported

The real covers pulled from Open Library are 300×500 artwork thumbnails, and OCR does
badly on them (1/15). That is a true measurement of an input the app will never actually
see: a photo of a physical book is thousands of pixels wide.

Rather than quietly dropping the inconvenient set or claiming the flattering number alone,
both are reported: rendered covers at photo resolution (15/15) as the representative case,
and the low-resolution artwork (1/15) as the documented limit.
