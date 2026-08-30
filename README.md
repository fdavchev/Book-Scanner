# Book Scanner

Photograph a book, have its title and author read off the cover, correct anything wrong,
and keep it in a collection that lives on your phone.

No account. No server. No cloud database. The photos never leave the device, and once it
is set up the whole thing works with the network switched off.

It installs to the home screen on **both Android and iPhone**.

> **It is live at [https://fdavchev.github.io/Book-Scanner/](https://fdavchev.github.io/Book-Scanner/)**
> — open that on your phone and install it from there.
>
> **Step-by-step, assuming no technical knowledge:**
> [`docs/install-on-your-phone.md`](docs/install-on-your-phone.md).

---

## What it does

- **Scan** — take a photo, or pick several from the gallery at once.
- **Read** — the text on the cover is recognised on the device itself.
- **Detect** — title and author are picked out of that text automatically, with a
  confidence score and a plain-English reason for the choice.
- **Check (optional)** — the guess can be cross-checked against the Open Library
  catalogue. This is the only feature that uses the internet, and it is a visible,
  always-tappable control rather than a hidden setting.
- **Review** — every book is shown for approval before anything is saved: edit the
  fields, pick from the runner-up lines, merge two photos of one book, split them apart,
  crop and rescan a shelf photo, or discard.
- **Keep** — saved to the phone's own storage, with a small cover thumbnail, and
  searchable, editable and deletable afterwards.
- **Track what you've read** — every book is green (read) or red (still to read). Tap the
  badge in the list to flip it, and filter the library by either.
- **Back up** — export the whole collection to a JSON file and import it back.

## Why a web app, not a native one

Filip needed it on Android *and* iPhone, and confirmed that an add-to-home-screen install
was fine as long as it genuinely worked offline.

An installable PWA is the only option on the table that covers both platforms from one
codebase without a Mac, a second language or a store account. It installs to the home
screen on both, opens in its own window with no browser chrome, uses the camera, stores
data locally, and — with the service worker and the on-device OCR data — runs with no
network at all.

A native Kotlin app would have had better OCR (ML Kit), but it abandons the iPhone and
doubles the work. Flutter and React Native still need a Mac to ship on iOS. Anything
server-based defeats the point.

The same code can be wrapped by Capacitor into a real APK later without a rewrite.

## How it works

```
  Camera / gallery
        │
        ▼
  preprocess.ts    EXIF-correct → resize to 1600px → grayscale + contrast → Otsu
        │          (plus a 400px JPEG cover thumbnail, the only part of the photo kept)
        ▼
  ocr.ts           tesseract.js worker pool → lines, words, boxes, confidences
        │
        ▼
  candidates.ts    drop cover noise → group lines into blocks → score for title,
        │          score for author → winner + ranked alternates + a reason
        ▼
  enrich.ts        Open Library, accepted only if it agrees with what OCR read   [optional]
        │
        ▼
  group.ts         near-identical detections → one book, several photos
        │
        ▼
  Review  →  storage/db.ts (IndexedDB)  →  Library
```

Everything under `src/pipeline/` is a pure function of its input except `ocr.ts` and
`enrich.ts`, which take injectable clients — so the detection logic is unit-tested
directly, with no WASM and no network.

### How detection actually picks the title

The dominant signal is **glyph height**: on nearly every cover the title is the largest
text on the page. Position (upper 60%), word count, letter ratio and OCR confidence break
the ties. Lines that are never a title — `A NOVEL`, bestseller flashes, prize mentions,
imprint names, ISBNs, prices, URLs — are dropped first.

The author is scored separately: a `by …` prefix is a strong signal, then name shape
(two to four capitalised words, initials like `J.R.R.`), position at the top or bottom
edge, and being printed smaller than the chosen title.

A title set across two lines is merged back into one phrase before scoring. The
confidence shown on the review card blends OCR confidence with how clearly the winner beat
the runner-up, so a close call is reported as a close call.

### Storage

IndexedDB, two stores, no query layer. A book is five fields and a thumbnail and a
personal library is hundreds of rows, so search runs in memory over the loaded array.
Cover images are stored as raw bytes rather than as Blobs — see `DECISIONS.md`, it is a
real iOS bug, not a preference.

## Running it

```bash
npm install          # also vendors the OCR assets into public/tesseract/
npm run dev          # http://localhost:5173
npm run dev:https    # HTTPS on the LAN, so a phone can use the camera
npm run build        # production build into dist/
npm run preview      # serve the built app
```

### Tests

```bash
npm test             # 136 unit tests (vitest)
npm run test:e2e     # 40 end-to-end tests (Playwright: Chromium, Pixel, WebKit/iPhone)
```

### Measuring accuracy

```bash
node scripts/make-fixtures.mjs        # render the clean covers
npm run make-hard-fixtures            # render the 18 difficult covers
npm run fetch-benchmark               # download real covers from Open Library

npm run benchmark                     # clean covers, offline
npm run benchmark -- --hard --lookup  # difficult set, with the catalogue
npm run benchmark -- --real --lookup  # real low-resolution artwork
```

Each run writes a `docs/accuracy-<set>-<online|offline>.md` with per-cover results.

## Measured accuracy

How the scanner was rebuilt, and the before/after numbers:
[`docs/scanner-rebuild.md`](docs/scanner-rebuild.md).

| Set | Title exact | Author found | Confidently wrong |
|---|---|---|---|
| Clean covers at photo resolution | **15/15** | **15/15** | **0/15** |
| 18 deliberately difficult covers (blur, angles, glare, dim light, Cyrillic) | **14/18** | **15/18** | 2/18 |
| Real Open Library artwork, 300×500 thumbnails | 8/15 | 9/15 | **0/15** |

"Confidently wrong" — a wrong book reported at 60% confidence or more — is the number that
matters most, because those are the answers you would accept without checking. It was 8/15
on the real covers before the rebuild.

Low-resolution artwork remains the hard case; a photograph of a physical book is thousands
of pixels wide, which is the case the app is actually used in.

## Limitations

- **Cover art is hard.** Heavy typography, handwriting, textured or reflective covers, and
  very small print all degrade the result. The review step exists because of this — the
  detection is a first draft, not an answer.
- **Small or distant photos fail.** Fill the frame with one cover.
- **One book per photo** by default. A shelf photo is handled with *Crop & rescan*, one
  book at a time, rather than by automatic segmentation, which is not reliable enough.
- **English and Macedonian** only, and only the languages you download.
- **iOS can evict storage.** Apple may clear a web app's data if the phone runs very low
  on space. `navigator.storage.persist()` is requested where supported, and Safari ignores
  it. This is exactly why JSON export exists — use it.
- **No physical-device testing.** See the report for what is verified and what is not.

## Future work

- A real APK via Capacitor, using this machine's Android SDK.
- ISBN barcode scanning, which would be far more accurate than reading the cover.
- More languages — adding one is a line in `scripts/vendor-ocr.mjs`.
- Re-running the Open Library match later on books saved offline, using the raw OCR text
  already kept on each record.

## Licence

Personal project, no licence chosen.
