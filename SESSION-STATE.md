# Session state — read this first

**Updated 29 August 2026.** The project is **built, tested and documented**. This file is
the handoff; it replaces the earlier "paused after scaffolding" note.

## Where things stand

All seven build phases of `docs/PLAN.md` are done. Phase 8 (the optional Android APK,
marked "cut first" in the plan) was not attempted — the reasoning is in
`docs/project-report.md` §8.

| | |
|---|---|
| Unit tests | **103 passing** (`npm test`) |
| End-to-end tests | **25 passing, 2 skipped** (`npm run test:e2e`) — Chromium, Pixel 7, iPhone 14/WebKit |
| Typecheck / lint | clean (`npx tsc -b`, `npm run lint`) |
| Title accuracy | **15/15** clean, **13/15** degraded, on covers at phone-photo resolution |
| Author accuracy | **15/15** clean, **14/15** degraded |
| Offline cold start | verified by automated test |

## Read these, in this order

1. `docs/project-report.md` — what was built, what was tested, measured accuracy, and an
   explicit list of what is **NOT VERIFIED**.
2. `README.md` — what it is and how to run it.
3. `DECISIONS.md` — every non-obvious call, including two real bugs the tests caught.
4. `docs/install-on-your-phone.md` — the plain-language install tutorial.

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
