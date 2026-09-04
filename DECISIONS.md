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

## AI cover reading is a second reader, not a replacement

Tesseract is weak on Macedonian Cyrillic display type. That is measured, not assumed: it is
what `docs/accuracy-hard-offline.md` and the Macedonian fixtures show, and it is the whole
reason this path exists.

The trade accepted is real and worth stating plainly: **when AI reading is on and the phone
is online, the cover photo is uploaded to Google.** The app is no longer strictly
offline-only for that one path.

Everything that made the offline guarantee true is kept:

- It is **opt-in and visible** — a tappable pill in the scan header beside the Open Library
  control, never a silent background behaviour, with a line under it saying what is sent.
- It needs the **user's own API key**. No key is bundled in the build, none is shared
  between users, and there is no proxy server — a proxy would reintroduce exactly the
  server this project exists without.
- It **always falls back** to the on-device pipeline: no key, no connection, a timeout, an
  auth error, a quota error, an unreachable host, or a reply that will not parse. Every one
  of those is a fallback, not an error the user has to deal with.
- Fallback is **per photo, not per batch**. Three covers read by Gemini and one that timed
  out and was read on the device is the correct outcome, not a failed scan.
- Every result still goes through the **same review step** before anything is saved.

Storage, review, grouping, Open Library enrichment and the offline-first default for
everything else are untouched.

## The AI reader returns null rather than guessing

The metric this project optimises for is "confidently wrong" — a wrong book reported at 60%
or more, because those are the answers a person accepts without checking. It was 8/15 on
the real covers before the scanner rebuild and 0/15 after.

An LLM asked to read a cover will happily complete a half-legible title from its own
knowledge of publishing, which is that failure mode with better spelling. So the prompt
says, explicitly, that returning `null` is the correct answer when unsure, and forbids
completing a title or a name from memory. `title: null, author: null` is treated as a valid
answer — the review card catches it — and never as a failure to retry.

The parser is defensive to match: structured JSON output is requested, but a fenced block,
a sentence of preamble, an array wrapper, the *word* "null", and a confidence answered on
0–1 instead of 0–100 all happen, and none of them should lose a good reading.

## The API key is left out of the backup file

`Settings` holds the key, and the JSON export deliberately contains books only. A backup is
a file people mail to themselves and drop in cloud storage; a Google API key billed to the
user has no business travelling in it.

## The AI path is sequential, like the OCR path

The plan for this feature suggested firing two or three Gemini calls at once. It is not
done, and the reason is the memory ceiling above: overlapping the calls means holding
several photos' worth of decoded `ImageData` at once, so the tesseract fallback still has
something to read if a call fails. On a batch of one to four photos the saving would have
been a few seconds, against the one failure mode that kills the tab outright.

## Provenance is tracked separately from `source`

A book carries both `source` (`ocr` | `ai` | `openlibrary` | `manual`) and `reader`
(`ocr` | `ai`). They look redundant and are not: the catalogue step overwrites `source` with
`openlibrary` when it corroborates a reading, so without `reader` a Gemini reading that Open
Library then confirmed would be indistinguishable from an on-device one. The review card
shows both facts because they answer different questions — which reader explains why one
card in a batch is sharper than the next, and the catalogue match explains why a title is
spelled better than the photo could justify.

## The AI benchmark is built but was not run

`npm run benchmark -- --hard --ai` routes the fixture sets through Gemini and writes
`docs/accuracy-<set>-ai-<online|offline>.md`, in the same format as the on-device runs and
under its own filename so it can never overwrite them.

**No numbers from it are published here, because it has not been run.** It needs a real API
key and bills a request per cover, and neither was available when it was written. The
`ai-ocr.ts` client is injectable and covered by unit tests against canned responses, so the
prompt, parsing and every fallback path are tested — but the *accuracy* of Gemini on the
Cyrillic set is currently an expectation, not a measurement. Run it with a key before
quoting any figure.

## The AI path pays for its own preparation, not tesseract's

`prepare()` used to compute six image buffers eagerly. Four of them — `binarised`,
`flattened`, `small`, `smallGray` — exist only for tesseract, and when Gemini reads the
cover none of them is ever touched.

Measured on a 4x-throttled phone profile with a real cover photograph: `binarise` is ~240 ms
and `flattenIllumination` ~870 ms, so roughly a second per photo went on images that were
immediately discarded, plus ~13 MB of `ImageData` pinned for the whole network wait.

`binarised` and `flattened` are now memoised getters, computed on first access. Nothing
about the OCR path changes — `readImage` reads the same properties and gets the same pixels,
a moment later — and an AI-read photo never pays for them at all. Deferring rather than
skipping is what keeps `Prepared` one shape and the fallback working unchanged.

`small` and `smallGray` stay eager. They are drawn from the decoded bitmap, which is closed
before `prepare()` returns, so making them lazy would mean deriving them from `raw` instead
— a different downscale, feeding the OCR pass that was tuned on the current one. Not worth
the accuracy risk for ~75 ms.

A/B measured under identical conditions: an AI-read photo went from 3,877 ms to 2,968 ms.

## The frame sent to Gemini is smaller than the one tesseract reads

`OCR_LONG_EDGE = 1600` is a tesseract number: classical OCR segments glyphs and needs a
minimum number of pixels per character. A multimodal model tiles and downsamples internally,
so past a point the resolution is discarded server-side after the phone has paid to upload
it. `AI_LONG_EDGE = 1280` at q0.8 sends 237 KB of base64 instead of 397 KB.

It is produced inside `prepare()`, from the same decoded bitmap as the thumbnail, and only
when the caller asks for it. The first attempt re-encoded `raw` afterwards instead — that
needed a full-size canvas and a second scaled draw, measured at 627 ms against 286 ms for a
plain encode, so the scaling cost more CPU than the smaller upload saved. Drawing once from
a bitmap that is already open costs a fraction of it.

`raw` is still `OCR_LONG_EDGE`, so a failed AI call falls back to exactly the image the
on-device pipeline was tuned for. Only the copy that goes over the network is smaller.

1280 is the conservative step, not the smallest that would work — and it has **not** been
validated against the accuracy benchmark, because that needs a real API key. Cover titles
are large type and survive downscaling; author names are often small, and losing those is
the quiet failure. Before going lower, run `npm run benchmark -- --hard --ai` and `--mk --ai`.

## Thinking is switched off, and the client recovers if that field is refused

Recent Flash models reason internally before answering. For most callers that is the right
default; here the title is printed on the cover in large type, there is nothing to reason
about, and every thinking token is latency the user waits through for no visible output.

The control's field name has moved between model generations, so a model rejecting it is an
expected answer rather than a bug: a 400 that names the thinking field makes the client drop
it and retry once, and remember for the rest of the session. Guessing wrong would otherwise
surface as a `server` failure and silently fall back to on-device reading — the feature
would look broken rather than misconfigured.

`usage` on each reading carries `promptTokens`, `outputTokens`, `thoughtsTokens` and the
call's wall-clock time, and the scan card shows them. Those three numbers are the only way
to tell the causes of a slow call apart — thinking, a long answer, or the network — and they
call for completely different fixes.

## One deadline per photo, and a transient 503 is retried

`AI_TIMEOUT_MS` was applied per attempt, inside the model-fallback loop, so a photo could
spend the full budget on the pinned model and the same again on the fallback. Everyone read
"30 seconds" and the real worst case was a minute. The budget is now started once per
`read()` and shared by every attempt.

Within it, a 429 or a 503 is retried once with backoff, honouring `Retry-After`. Those are
transient — Google saying "come back shortly", not "your request was wrong" — and giving up
on them cost the better reading for that photo. The unconditional 1.5 s pause between AI
calls is gone: it paid the cost on every request including the ones that were fine, and
still had no answer for the one that was actually refused.

## The OCR engine warms up during the first AI request

The pool is created lazily so an all-AI batch never downloads ~30 MB it will not use. That
left a cliff: if the first AI call timed out *and* the engine had never been fetched, the
user waited the full timeout, then an unexpected 30 MB download, then the OCR read.

The download now starts alongside the first AI request and is awaited only if the fallback
actually needs it. It costs nothing when the AI call succeeds — a warmed pool is simply left
unused — and the in-flight promise is shared, so the warm-up and the fallback can never race
into creating two pools. A failed warm-up is discarded silently rather than poisoning the
fallback, which surfaces its own errors properly.
