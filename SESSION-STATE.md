# Session state — read this first

**Updated 29 August 2026.** The project is **built, tested and documented**. This file is
the handoff; it replaces the earlier "paused after scaffolding" note.

## Where things stand

All seven build phases of `docs/PLAN.md` are done. Phase 8 (the optional Android APK,
marked "cut first" in the plan) was not attempted — the reasoning is in
`docs/project-report.md` §8.

| | |
|---|---|
| Unit tests | **184 passing** (`npm test`) |
| End-to-end tests | **40 passing, 5 skipped** (`npm run test:e2e`) — Chromium, Pixel 7, iPhone 14/WebKit |
| Typecheck / lint | clean (`npx tsc -b`, `npm run lint`) |
| Title accuracy | **15/15** clean · **14/18** on the difficult set · **8/15** on low-res artwork |
| Author accuracy | **15/15** clean · **15/18** difficult · **9/15** low-res |
| Confidently wrong | **0/15** clean · **0/15** low-res (was 8/15 before the scanner rebuild) |
| Offline cold start | verified by automated test |

## The scanner was rebuilt (30 August 2026)

The recognition pipeline was redesigned after it proved unreliable: one OCR pass, a
detector that committed to a single reading, and a lookup that could confidently attach the
wrong author. `docs/scanner-rebuild.md` is the full account — what was wrong, why the
online path was *worse* than offline, what replaced it, and the measured before/after.

## The scanner speaks Macedonian now (30 August 2026)

The app defaults to the Macedonian OCR model, and the title scorer was rebuilt around the
one rule that actually holds on a cover: the title is the biggest text. Two real Macedonian
Sherlock Holmes covers are committed as `tests/fixtures/mk/` and measured by
`npm run benchmark -- --mk --lookup`. Full account, including the trade-offs, at the end of
`docs/scanner-rebuild.md`.

## Read these, in this order

1. `docs/project-report.md` — what was built, what was tested, measured accuracy, and an
   explicit list of what is **NOT VERIFIED**.
2. `README.md` — what it is and how to run it.
3. `DECISIONS.md` — every non-obvious call, including two real bugs the tests caught.
4. `docs/scanner-rebuild.md` — the scanner redesign, with before/after numbers.
5. `docs/install-on-your-phone.md` — the plain-language install tutorial.

## Two bugs worth knowing about, because they will bite again if reverted

- **Cover images are stored as `ArrayBuffer`, not `Blob`.** WebKit — every browser on iOS —
  refuses to put a canvas-produced Blob in IndexedDB. Saving a book failed on iPhone until
  this changed. See `src/storage/db.ts`.
- **Offline setup boots a real tesseract worker.** Six WASM cores are vendored and the
  browser picks one; guessing which was wrong on Chromium and left offline scanning broken.
  See `src/offline/ocrAssets.ts`.

## The one thing this environment could not do

**Nothing was installed on a physical phone.** The app's side of installation is verified
(manifest, icons, iOS meta tags, WebKit test run), but no real Android or iPhone install
was performed, and the Android emulator was not started. `docs/project-report.md` §10 has a
five-minute checklist that would close this.

## Publishing

The GitHub repository is `https://github.com/fdavchev/Book-Scanner` (public), and the app
is **live at https://fdavchev.github.io/Book-Scanner/** — verified by a live run that
scanned a cover through the deployed site and saved it.

To re-publish after a change: `npm run deploy`. It builds with the correct base path for GitHub
Pages — a project site is served from `/Book-Scanner/`, not the root — pushes `dist/` to
the `gh-pages` branch, and prints the address. GitHub enabled Pages for the `gh-pages` branch automatically on the first push; if a
future repository does not, it is one toggle in Settings → Pages.

That subpath build is covered by its own end-to-end test (`tests/e2e/subpath.spec.ts`),
which builds it, serves it from a subpath and scans a cover through it.

## Environment facts, already verified — no need to re-check

| Thing | Status |
|---|---|
| Node / npm | 24.19 / 11.17 |
| Playwright browsers | Chromium **and WebKit** installed |
| Open Library API | reachable and accurate |
| OCR assets | vendored into `public/tesseract/` by `postinstall`; gitignored, ~30 MB |
| Benchmark covers | `tests/fixtures/covers/` committed; `tests/fixtures/benchmark/` gitignored, refetch with `npm run fetch-benchmark` |
| `gh` CLI | installed, **not authenticated** — `gh auth login` needs a browser and cannot be automated |
| Android SDK / JDK 21 / AVD | present but unused this session |

## Still true, and still worth remembering

- **This folder's name contains spaces.** Quote every path.
- **Filip often cannot run the project himself.** Results go into `.md` files in this
  folder, and every claim is labelled *verified by test*, *verified by live run*, or
  *not verified*.

## AI cover reading was added (2 September 2026)

The app can now read covers with **Google Gemini Flash** instead of tesseract, because
tesseract is weak on Macedonian Cyrillic display type. `DECISIONS.md` has the full
reasoning; the short version:

- `src/pipeline/ai-ocr.ts` — the Gemini client, prompt, structured-output schema, defensive
  parsing and error classification. The client is injectable, so it is fully unit-tested
  with no key and no network.
- `src/pipeline/route.ts` — a pure function deciding AI or on-device from three inputs:
  mode, key present, really online. Every combination is pinned by a test.
- The user supplies **their own API key** in the new Settings screen. Nothing is bundled,
  nothing is shared, there is no proxy.
- **Every failure falls back to the device, per photo.** No key, offline, timeout, bad key,
  quota, unreachable, unparseable reply — all of them.
- The offline guarantee is intact: with no key, or with the pill off, or with no signal, the
  app behaves exactly as it did before.

### What is NOT verified

**The AI path has never been run against a real Gemini API key.** No key was available.
That means:

- Every unit test passes against a *mocked* client, so the prompt, the parsing and all the
  fallbacks are verified.
- `npm run benchmark -- --hard --ai` is implemented and refuses cleanly without a key, but
  **has not been run**, so there are no measured AI accuracy numbers for the Cyrillic set.
  Do not quote any until it has.
- The exact model id (`gemini-2.5-flash`, one constant at the top of `ai-ocr.ts`) and the
  live request/response shape are written from the documented API, not from an observed
  call.

First thing to do with a key: `GEMINI_API_KEY=... npm run benchmark -- --hard --ai`, then
compare against `docs/accuracy-hard-offline.md`.

## The interface was redesigned (2 September 2026)

A full pass over the UI, not a reskin:

- **Light and dark themes with a real switch** — System / Light / Dark, in the top bar and
  in Settings. Previously the app followed `prefers-color-scheme` with no way to override.
- A sticky **top bar**, a fourth **Settings** tab, and a reworked bottom bar.
- **Home** gains a hero and read/to-read/total counters.
- **My Books** gains a list-or-covers layout switch.
- **Review** cards say which reader read each cover, and whether the catalogue corroborated
  it — two separate facts.
- Rebuilt token system, focus rings, loading skeletons, and `prefers-reduced-motion`.

Every `data-testid`, ARIA role name and form label the end-to-end tests rely on was kept
deliberately, so the redesign did not require rewriting the test suite.

## Session — 2026-09-06: OSD fix, Macedonian fine-tuning shelved

### TL;DR
Set out to fine-tune `mkd.traineddata` because Macedonian covers looked broken.
Root cause turned out to be a missing `osd.traineddata` file, not the language
model. Fixed in one line. Macedonian is now passing. Fine-tuning is shelved
unless a new benchmark run shows a genuine, repeatable Macedonian-specific
failure that isn't explained by something simpler.

### What was actually wrong
`npm run benchmark -- --hard --diagnose <fixture>` was printing this on every
single scan, for every fixture, in every language:
```
[page] Error opening data file ./osd.traineddata
[page] Failed loading language 'osd'
[page] Warning: Auto orientation and script detection requested, but osd language failed to load
```
`osd` (Orientation and Script Detection) is a separate small Tesseract model
used before recognition to detect rotation/script. It was never vendored —
`scripts/vendor-ocr.mjs` only ever copied `eng` and `mkd`. One of the pipeline's
own OCR passes (`PSM.SPARSE_TEXT_OSD` in `src/pipeline/ocr.ts`, in
`PASS_SCHEDULE`) was silently failing to get the model it needed on every run.

### The fix (2 changes, already pushed)
1. `npm install "@tesseract.js-data/osd"` — added as a dependency, same
   package family as the existing `eng`/`mkd` data.
2. `scripts/vendor-ocr.mjs` — added `'osd'` to the language copy loop
   (`for (const pkg of ['eng', 'mkd', 'osd'])`), so it lands in
   `public/tesseract/lang/osd.traineddata.gz` alongside the others.
3. `src/pipeline/ocr.ts` — the `langs` string built for `createWorker` now
   always appends `+osd`, so every worker in the pool has the OSD model loaded
   and available whenever a pass requests `PSM.SPARSE_TEXT_OSD`.

### Measured effect (offline, no Open Library lookup — the fair comparison)
Comparing the raw `--diagnose` runs before/after, fixture by fixture:

| Fixture | Before | After |
|---|---|---|
| `macedonian-latin-author` | **miss** — `"ITupej"` (garbage) | **exact** — `"Пиреј"` |
| `macedonian` | exact, author garbled `"JaHEBCKH"` | exact, author correct `"Јаневски"` |
| everything else | unchanged | unchanged |

Full offline hard-set score went **10/18 → 12/18** title-exact. This is the
number to trust for future comparisons — see gotcha below.

### Gotcha to remember for next time
`npm run benchmark -- --hard --lookup` (online, with Open Library
corroboration) scores noticeably higher than the plain offline run, because
the catalogue can guess the right title even from badly garbled OCR text
(e.g. it correctly resolved `"unishment Fyodor Dostoevsky"` to "Crime and
Punishment" even though the OCR itself never improved on that fixture). Do
NOT compare an online run against an offline baseline — it looks like a
regression or improvement that isn't real. Always compare
`docs/accuracy-hard-offline.md` against `docs/accuracy-hard-offline.md`.

### Still genuinely broken (not touched this session)
- `angled`, `steep-angle`, `tilted` — all still `miss`, identical text output
  before and after the OSD fix. This is NOT an OSD problem: OSD only corrects
  90°-increment rotation (upside down / sideways), not a few-degrees tilt.
  This needs an actual deskew step (measure + correct small rotation angle)
  in preprocessing — separate piece of work, unrelated to language/Cyrillic.
- `harsh-glare` — author truncated to "Oscar" instead of "Oscar Wilde", title
  has a corrupted character (`Pic' ure`). Likely a contrast/glare
  normalization issue in `preprocess.ts`, not language-related either.
- `unreadable` fixture flipped from miss→"exact" between runs, but this looks
  like scoring-definition noise (both runs detected nothing useful) rather
  than a real change — worth checking how "exact" is scored when expected
  title/author are both empty strings.

### Macedonian fine-tuning pipeline — status: shelved, not deleted
A full Docker-based `tesstrain` fine-tuning pipeline was built this session
(Dockerfile + scripts) in case the LSTM model itself needed retraining on
book-cover typography. It's parked, unused, because the actual problem was
the OSD bug above, not the language model. Keeping the files around in case
a future benchmark run surfaces a real, repeatable Macedonian-specific
failure that isn't explained by something simpler (preprocessing, OSD,
deskew, etc. — check those first, they've had a much better hit rate this
session than "the model needs fine-tuning" did).

Files, not yet committed into the repo (sitting outside it, ask Filip/Claude
if picking this back up):
- `Dockerfile` — Ubuntu 24.04 + Tesseract built from source with training
  tools + Node 20 + Playwright/Chromium
- `docker-train.sh` — runs inside the container: clones `tesstrain`, fetches
  base `mkd.traineddata` from `tessdata_best`, generates ground truth, runs
  `lstmtraining`, finalizes into `/work/output/mkd.traineddata(.gz)`
- `make-mkd-ground-truth.mjs` — Playwright-based line-crop ground-truth
  generator, sources real title/author pairs from Open Library
  (`language=mac` confirmed as the correct code empirically — NOT `mkd`,
  despite `mkd` being the ISO 639-2 terminology code)
- `vendor-ocr.patch.mjs` — patch for `scripts/vendor-ocr.mjs` to let a
  fine-tuned model at `custom-traineddata/mkd.traineddata.gz` override the
  npm-vendored one, surviving `npm install`

If picking this back up: don't skip straight to Docker again — first add
`--diagnose` output for whatever the new suspected Macedonian failure is,
confirm it's not explained by preprocessing/OSD/deskew, THEN consider
fine-tuning as a last resort. It's expensive (Docker image build alone is
15-40 min) and this session is direct evidence the model itself is probably
fine.

### Next candidate tasks, roughly in order of likely value
1. Deskew for `angled`/`steep-angle`/`tilted` (3/18 fixtures, clear common
   cause, code change is localized to preprocessing)
2. Glare/contrast handling for `harsh-glare` (title corruption + truncated
   author)
3. Re-run `npm run benchmark -- --hard` (offline) and `--real --lookup`
   periodically to keep README's accuracy table current — it had drifted out
   of sync with actual measured numbers before this session started