# Book Scanner — Personal Book Collection

## Context

Filip wants a working application, not a skeleton: open it, photograph or select book
images, have the title and author recognised automatically, correct anything wrong, and
save into a local collection he can browse, search and edit. The collection stays on his
device, works offline, and needs no account or server.

He also asked whether a web app can actually be **downloaded onto a phone**, and confirmed
that an Add-to-Home-Screen install is fine **provided it genuinely works offline**, because
he needs it on **both Android and iOS**. That makes the installable PWA the primary and only
required delivery target, and it makes the offline guarantee a hard requirement rather than
a nice-to-have — the plan below treats it as one.

Target folder: **`C:\Users\Davchev\Projects\Book Scanner Project`** (currently empty). It
is a sibling of `DocuMind-AI` and `graphify` — neither is touched. The new project gets
its own `git init`.

Environment verified: Node 24.19, npm 11.17, Chrome + Edge, npm registry reachable, Open
Library answering correctly (`hobbit tolkien` → *The Hobbit* / *J.R.R. Tolkien*), both
`@tesseract.js-data/eng` and `@tesseract.js-data/mkd` published — **and** Android SDK
(build-tools 34/36/36.1, platforms 35/36.1, `adb`), Android Studio's bundled **JDK 21**,
an x86_64 Android 36 system image and an existing AVD `Testing_phone_for_apps`.

---

## Decision: an installable, offline-first PWA (Vite + React + TS)

One codebase that installs to the home screen on Android **and** iOS — the only option on
this list that covers both without a Mac, a second language, or a store account.

| Requirement | Why this wins |
|---|---|
| Both platforms | Chrome *Install app* and Safari *Add to Home Screen* both give a standalone icon, own window, no browser chrome |
| Camera | `getUserMedia({facingMode:'environment'})` for live capture, `<input capture="environment">` as the always-works path (and the preferred one on iOS) |
| Multi-image select | `<input type="file" multiple>` — native gallery multi-select on both platforms |
| OCR locally | `tesseract.js` (WASM) in a Web Worker — genuinely on-device |
| Offline | Service worker precache + Cache API for the OCR data + IndexedDB for the books |
| Local storage | IndexedDB — same API and behaviour on both platforms |
| Ease of running/testing | `npm run dev`, and the whole flow is drivable by Playwright **in this environment** |
| Privacy | Images never leave the device; only OCR *text* does, and only when lookup is on |
| Future expansion | Capacitor can wrap the same code into a real APK/IPA later without a rewrite |

**Rejected:** a native Kotlin app (ML Kit OCR is better, but it abandons iOS and doubles
the work); Flutter/React Native (toolchain weight, and iOS still needs a Mac to build);
anything Python/Streamlit (needs a running server — kills local-first and phone ergonomics).

**No database.** A book is five fields and a thumbnail; a personal collection is hundreds
of rows. IndexedDB stores records and cover Blobs directly, and search runs in memory.
SQLite/WASM would add a dependency, a persistence shim and a query layer for zero gain —
recorded in `DECISIONS.md`.

### Stack

`vite` 8 · `react` 19 + TypeScript · `tesseract.js` 7 (+ `tesseract.js-core`,
`@tesseract.js-data/eng`, `@tesseract.js-data/mkd`) · `idb` 8 · `vite-plugin-pwa` 1.3 ·
`@vitejs/plugin-basic-ssl` (HTTPS on the LAN, so the camera works on a phone) ·
`vitest` + `@testing-library/react` + `fake-indexeddb` · `@playwright/test`.
Hand-written CSS with design tokens — no UI framework, keeps the offline bundle small.

---

## Getting it onto the phone, and the offline guarantee

**Install.** Build once (`npm run build`) and serve `dist/` over HTTPS — either from the LAN
for a quick trial (`npm run dev:https -- --host`, phone on the same Wi-Fi) or from any static
host for a permanent install (a `deploy` script for GitHub Pages is included; the build is
static files, so any host works). Then *Install app* on Android Chrome, *Share → Add to Home
Screen* on iOS Safari. Both give a standalone icon with no browser UI.

**The host serves the app, never the data.** Books, covers and OCR all stay on the device;
the URL exists only to deliver the app once. Nothing about this makes it non-local-first.

**Making offline real.** A service worker that caches only the app shell would leave the
scanner broken on a plane, so the OCR assets are treated as first-class:

- shell, JS/CSS, icons and the ~4 MB WASM core are **precached** at install
- the language data (~14 MB per language) is fetched into the Cache API by a prominent
  first-run step — *"Set up offline scanning"* with a progress bar and a per-language choice,
  so he can take English only and halve it
- once that completes the app is **fully functional with the network off**: scanning, OCR,
  detection, saving, browsing, searching, editing. Only the Open Library lookup needs the
  network, and it degrades to the OCR result per book
- a persistent indicator shows whether offline scanning is ready, so the state is never a
  surprise

**iOS specifics, designed for rather than discovered.** `<input capture>` is preferred over
`getUserMedia` on iOS (more reliable inside a home-screen app); WebKit's per-tab memory
ceiling means images are processed strictly one at a time with `ImageBitmap.close()` after
each and a worker pool of 1–2 on mobile; `navigator.storage.persist()` is requested where
supported, and because iOS storage eviction cannot be fully ruled out, **JSON export/import**
ships as the backup path and the README says so plainly. iOS shows no install prompt, so the
app detects iOS Safari and displays a short "Share → Add to Home Screen" hint.

**Optional, cut first:** this machine has the Android SDK, JDK 21 and an AVD, so wrapping the
same build into a real installable APK with Capacitor is cheap. It is a stretch item at the
very end — attempted only once everything above is done and verified, and dropped without
regret otherwise, since it does nothing for iOS.

---

## Architecture

```
  Camera  (getUserMedia | input capture) ─┐
  Picker  (input type=file multiple)     ─┴─►  intake/  ── Blob[] + job queue
                                  │
                                  ▼
                      pipeline/preprocess.ts   EXIF-correct → downscale 1600px
                                  │            → grayscale → contrast → Otsu
                                  ▼            (+ 400px q0.72 JPEG cover thumb)
                      pipeline/ocr.ts          tesseract.js worker pool (2–4)
                                  │            recognize(img, {}, {blocks:true})
                                  ▼            → lines/words + bbox + confidence
                      pipeline/candidates.ts   noise filter → title/author scoring
                                  │            → {title, author, confidence, alternates}
                                  ▼
                      pipeline/enrich.ts       Open Library, fuzzy-gated  [optional]
                                  │
                                  ▼
                      pipeline/group.ts        similar detections → one book, N photos
                                  │
                                  ▼
       review/  ── edit · merge · split · crop&rescan · discard · confirm
                                  │
                                  ▼
                      storage/db.ts (IndexedDB: books, settings)
                                  │
                                  ▼
       library/  ── list · search · open · edit · delete · export/import JSON
```

Everything under `pipeline/` is pure and synchronously testable except `ocr.ts` and
`enrich.ts`, which take injectable clients so unit tests never touch WASM or the network.

---

## Recognition pipeline

**1 — Preprocess.** `createImageBitmap(blob, {imageOrientation:'from-image'})` fixes
rotation; downscale the long edge to 1600px (the OCR accuracy knee, and it keeps a 20-image
batch inside phone memory); grayscale → contrast stretch → Otsu binarisation. If the first
pass returns low mean word confidence, retry once on the un-binarised grayscale — stylised
covers often lose to thresholding.

**2 — OCR.** Worker pool sized `min(hardwareConcurrency, 4)`, 2 on mobile. `PSM.AUTO` for
covers; re-run tall/narrow images (spines) with `PSM.SPARSE_TEXT`. Language from the
visible selector — `eng`, `mkd`, or both.

**3 — Candidates** (`pipeline/candidates.ts`, the heart of it, all pure functions):
- merge Tesseract lines into visual groups by proximity + similar glyph height
- drop noise: `A NOVEL`, `BESTSELLER`, `#1 NEW YORK TIMES`, publisher/imprint names, ISBN
  and barcode digits, prices, stray single glyphs, words under ~40 confidence
- **title score** = normalised glyph height (dominant signal — the title is the biggest
  text on almost every cover) + upper-60% position + 1–10 words + letter ratio + confidence
- **author score** = `by …` / `written by` prefix (strong) + name shape (2–4 capitalised
  tokens, initials like `J.R.R.`) + top-or-bottom edge + smaller than the chosen title +
  confidence
- output the winner **plus ranked alternates** and a 0–100 confidence with a human reason
  ("largest text, upper third") shown on the review card

**4 — Enrich (Open Library, visible toggle).** Query
`search.json?q=<ocr text>&limit=5&fields=title,author_name,first_publish_year`. A result is
accepted **only** if it fuzzy-matches an OCR candidate above threshold — it never blindly
overwrites. Cards are badged `OCR` or `Matched via Open Library`.
Per Filip's instruction the control lives **in the scan header, not in settings**: a pill
reading `Lookup: On · connected` / `Off · offline`, driven by `navigator.onLine` plus a real
reachability probe, and **always clickable** — a manual override sticks (`auto` /
`forced-on` / `forced-off`), and forcing it on while detection says offline still attempts
the call, failing softly to the OCR result per book. Detection never disables the control.

**5 — Group.** One image = one book by default. Detections whose normalised (title, author)
similarity ≥ 0.85 auto-merge into one book showing "from 2 photos", undoable. For several
books in one photo, the review card offers **Crop & rescan**: drag a box, the pipeline
re-runs on that crop and yields a new card — practical and reliable, where automatic
multi-book segmentation is not.

---

## Data model & storage

```ts
Book { id: string           // crypto.randomUUID()
       title: string
       author: string
       dateAdded: number     // epoch ms
       dateModified: number
       cover?: Blob          // 400px JPEG q0.72, ~40 KB — the user's own photo
       confidence?: number   // 0–100 at capture time
       source: 'ocr' | 'openlibrary' | 'manual'
       ocrText?: string      // raw text, kept for re-matching later
       photoCount: number }
```

IndexedDB (`idb`), two stores: `books` (keyPath `id`, index on `dateAdded`) and `settings`
(lookup mode, OCR languages). Search is normalised token matching over title+author in
memory. Originals are never stored — only the 400px thumbnail. JSON export/import for backup.

---

## UI

Mobile-first, three routes, bottom tab bar. **Home**: book count, big `Scan Books`, recent
additions, search. **Scan**: `Open Camera` / `Select Photos` as sketched, with the lookup
pill and language selector in the header, then a live per-image progress list
(queued → reading → matched) for large batches. **Review**: one card per detected book —
cover thumb, editable Title/Author, confidence chip, alternates dropdown,
`Merge` / `Split` / `Crop & rescan` / `Discard`, and `Save all`. **My Books**: searchable
list, tap to open, edit, delete. Dark/light via `prefers-color-scheme`.

---

## Build phases

1. **Scaffold & offline OCR** — Vite+React+TS in the target folder, `git init`, deps,
   `scripts/vendor-ocr.mjs` (postinstall) copying `worker.min.js`, the four
   `tesseract-core*.wasm.js` + wasm, and `eng`/`mkd` traineddata into `public/tesseract/`,
   with `workerPath`/`corePath`/`langPath` pointed there so **no CDN is ever hit**.
   *Spike first:* OCR one cover end to end before building UI on top of it.
2. **Pipeline** — preprocess, worker pool, candidates, grouping, with unit tests alongside.
3. **Storage + library** — `db.ts`, CRUD, search, export/import.
4. **UI** — intake (camera + picker), batch progress, review cards, library, edit/delete.
5. **Enrichment + connectivity pill** — Open Library client, fuzzy gate, override logic.
6. **Install + offline** — manifest, icons, `apple-touch-icon` and iOS meta tags, precache
   shell + WASM core, CacheFirst route for `/tesseract/*`, the first-run "Set up offline
   scanning" step with progress and per-language choice, the readiness indicator, the iOS
   Add-to-Home-Screen hint, `storage.persist()`, JSON export/import, `dev:https` and a
   static `deploy` script.
7. **Benchmark, docs, report** — below. Written to disk, since Filip cannot run anything
   right now: every result lands in markdown in the project folder.
8. **Stretch, cut first — Android APK.** `@capacitor/android`, `JAVA_HOME` pinned to Android
   Studio's **JDK 21** (the system default is JDK 25, which AGP rejects), `local.properties`
   → the existing SDK, then `gradlew assembleDebug` and an install on the AVD. *Known risk:*
   the folder name contains spaces; if Gradle objects, build through a spaceless directory
   junction rather than fighting it. Attempted only after 1–7 are done and verified.

---

## Verification

**Fixtures.** Playwright renders HTML cover templates to PNG (no extra deps), plus a *real*
benchmark set: ~15 genuine covers pulled from `covers.openlibrary.org` (script included,
images gitignored). Each gets photographic degradation — 3° rotation, blur, darkening,
JPEG q40 — so the numbers reflect photos, not clean artwork.

**Unit (vitest).** Title/author scoring, noise filters, similarity + grouping, the fuzzy
match gate, storage CRUD via `fake-indexeddb`, and the enrichment client with mocked fetch
including the offline path.

**End-to-end (Playwright, headless Chrome).** Start app → open scanner → `setInputFiles`
with multiple fixtures → processing completes → title/author detected → correct a wrong one
→ save → appears in My Books → search finds it → edit → delete → **reload and confirm
persistence** → `context.setOffline(true)` and confirm scanning still works while the pill
flips to `Off · offline`.

**The offline guarantee, tested as a first-class case.** Install the built app in a
Playwright context, run the first-run offline setup, then `context.setOffline(true)`, reload,
and confirm from a cold start that the app boots, scans, OCRs, detects, saves and searches
with no network — and that the lookup pill reads `Off · offline` while remaining clickable.

**Mobile behaviour.** Playwright device emulation (Pixel + iPhone viewports, touch, reduced
memory path) over the real flow; the Android emulator's Chrome for a genuine
Add-to-Home-Screen install plus an airplane-mode launch. A physical iPhone install is the
one thing this environment cannot reach — it will be marked NOT VERIFIED with exact steps
for Filip to confirm it in two minutes when he has a moment.

**Accuracy report.** Exact/fuzzy title and author hit-rate over the benchmark set, OCR-only
vs OCR + Open Library, reported as measured numbers, not adjectives.

**Everything lands in the folder as markdown**, since Filip cannot run the project right now:

- `README.md` — what it is, why a PWA, architecture, stack, OCR approach, how detection
  works, storage, how to run, how to install on Android and iOS, limitations, future work
- `DECISIONS.md` — one entry per non-obvious call, including why no database
- `docs/project-report.md` — the final report: what was built, structure, how scanning, OCR
  and detection work, what was tested, measured accuracy, what works, what is
  NOT VERIFIED and why, and known limitations — readable without opening a single source file
- `docs/install-on-your-phone.md` — the install tutorial, specified in full below

Claims are labelled the way the DocuMind-AI report labels them: VERIFIED by automated test,
VERIFIED by live run, or NOT VERIFIED. No result gets reported that was not actually run.

---

## `docs/install-on-your-phone.md` — its own deliverable

A standalone, plain-language tutorial. Written for someone who has never heard the words
"PWA" or "service worker" — no jargon, and any unavoidable term explained in the sentence
that uses it. Numbered steps, one action per step, each saying what you should see on screen
before moving on. Contents:

**Part 0 — Put the app somewhere your phone can open.** The one genuinely fiddly part, so it
comes first and gets two routes, each written out completely:
- *Quick trial over Wi-Fi* — run one command on the laptop, read the printed address, type it
  into the phone. Includes what the "this site isn't secure" warning looks like on both
  Android and iOS, why the self-signed certificate causes it, and exactly which button to tap
  to continue.
- *Permanent install* — publish the `dist/` folder to a free static host with the included
  script, giving a normal `https://…` address that works from anywhere with no laptop
  involved. This is the one to use for a real install.

**Part 1 — Android (Chrome).** Open the address → the *Install app* prompt, plus the
three-dot-menu route for when the prompt doesn't appear → confirm → find the icon in the app
drawer → open it and confirm there is no browser address bar.

**Part 2 — iPhone / iPad (Safari).** Stresses **Safari specifically**, since Chrome on iOS
cannot install web apps — the single most common reason this fails. Open the address in
Safari → the Share button (with a description of the icon and where it sits on both a modern
and an older iPhone) → scroll to *Add to Home Screen* → Add → confirm the icon on the home
screen and no address bar when opened.

**Part 3 — Turn on offline scanning.** Open the app, tap *Set up offline scanning*, pick
languages, wait for the bar to finish, confirm the indicator says ready. Explains in one
sentence why this download exists and that it happens only once.

**Part 4 — Prove it works offline.** Turn on airplane mode, open the app, scan a photo,
confirm the book still gets recognised and saved. States plainly which single feature
(the Open Library lookup) needs the internet and what happens without it.

**Part 5 — Camera permission.** What the prompt says on each platform, which answer to give,
and how to fix it in Settings if it was declined by accident.

**Part 6 — When it goes wrong.** A symptom-first table: no *Install app* prompt · no *Add to
Home Screen* row · the page won't load on the phone · the camera won't open · scanning fails
offline · books disappeared (→ restore from the JSON export). Each with a plain cause and a
concrete fix.

Steps that were actually executed here — the Android Chrome install and the offline cold
start on the emulator — are marked as confirmed; the iPhone steps are marked as written from
Apple's documented behaviour and not run on a physical device.
