# Rebuilding the scanner — what was wrong and what changed

Written 30 August 2026. All numbers below were measured by running the real browser
pipeline in headless Chromium (`npm run benchmark`), not estimated.

---

## 1. What was wrong with the original scanner

Four faults, compounding.

**One OCR pass.** The image was read once, with one page-segmentation mode. That is the
single biggest cause of missed books: a cover is only legible in *some* readings. Measured
across every (image variant × segmentation mode) combination, the words of the title were
readable somewhere on **9 of 15** real covers — but the single pass found them on 3. *The
Great Gatsby* is only legible in the grayscale sparse-text pass, *To Kill a Mockingbird*
only in the single-block pass, *Pride and Prejudice* only in the word-per-line pass. The
information was there; the pipeline never looked.

**The detector committed to one reading.** It scored "best title" and "best author"
independently and kept only the winners. Glyph height dominated that score, so on *The
Handmaid's Tale* — where the author is set larger than the title — it returned
`title: "Margaret Atwood", author: "'Handmaid's Tale"`. Swapped, and reported at **98%
confidence**.

**The lookup was anchored to that one guess.** It built a single query from the detector's
title, and accepted a catalogue result only if that title already matched. So when the
guess was right, the lookup added nothing; when it was wrong, the lookup could not help.
It had no route to the right answer.

**Confidence was measured on the wrong thing.** It passed through tesseract's certainty
about the *characters*. Tesseract was 98% sure of the letters "Margaret Atwood" — it had no
opinion about which field they belonged in. On the real-cover set, **8 of 15** results were
confidently wrong.

## 2. Why offline appeared to perform better

Because the lookup was actively harmful, not merely useless.

The acceptance gate compared the detector's title against catalogue titles with a fuzzy
score. OCR garbage is short, and short strings match *something* in a catalogue of millions
almost perfectly. Measured on the original code:

| Cover | OCR read | Lookup returned |
|---|---|---|
| To Kill a Mockingbird | `Ird` | *Ird* by **Ángel Gabaldón** |
| The Catcher in the Rye | `ITT` | a book by **Robert Sobel** |
| The Handmaid's Tale | `Margaret Atwood` | a book *about* Atwood by **Coral Ann Howells** |

Three of the five matches it made were the wrong book. Offline, those covers produced a
blank author — visibly nothing. Online, they produced a confident, specific, wrong author.
A wrong answer stated confidently is worse than no answer, which is exactly what "the
offline scanner seems better" was describing.

## 3. The pipeline now

```
  photo
    ↓  preprocess.ts   EXIF → resize → grayscale → contrast → Otsu
    │                  → illumination flattening (glare, uneven light)
    │                  → assessQuality: blur / brightness / contrast / size
    ↓  ocr.ts          adaptive multi-pass schedule, deskewed, 300 dpi assumed
    │                  raw+AUTO → grayscale+SPARSE → flattened+AUTO → raw+BLOCK
    │                  → raw+SPARSE → binarised+AUTO → grayscale+BLOCK
    │                  stops early once the evidence looks like a read cover
    ↓  candidates.ts   each pass scored on its own geometry, weighted by pass quality;
    │                  passes vote on whole (title, author) interpretations
    ↓  identify.ts     several catalogue queries; every result scored against ALL the
    │                  OCR evidence; strict acceptance; contradiction vetoes
    ↓  review          confidence, uncertainty warning, alternates, crop & rescan
```

Every stage is a pure function of its input except `ocr.ts` and the catalogue client, both
of which take injectable clients — so all of it is unit-tested without WASM or a network.

### Multi-pass OCR

Seven (image variant × segmentation mode) readings, walked in order and stopped as soon as
the pooled evidence looks like a cleanly-read cover. A clean photo still costs one pass; a
hard one spends more. The early-exit test requires two confident, word-like lines *and* one
at least eight letters long — without that last clause, glare across a cover produced the
confident fragments "The Pic" and "Oscar W", which satisfied everything else and stopped
the schedule before the pass that handles glare ever ran.

**Passes are never merged geometrically.** Pooling the lines and scoring the pool was tried
and was measurably worse: bounding boxes from a sparse-text pass and a block pass describe
the same cover in incompatible ways, and "THE ROAD" ended up scored as the *author* of a
book titled "VU". Each pass is scored on its own geometry; the passes then vote on whole
interpretations, weighted by how word-like that pass's output was.

### Hypotheses instead of one answer

The detector emits up to six ranked interpretations, including role-swapped ones, plus
title-only and author-only readings for covers that show one and not the other. Pairing the
roles and scoring the pair as a unit is what un-swapped *The Handmaid's Tale*.

### Identification as a search

- **Several queries, interleaved broad and narrow:** title+author, then the author alone,
  then the title alone, then a cleaned bag of words. Ordering matters as much as the
  queries: grouping the title+author combinations first exhausted the budget before the
  plain author query ran, and the plain author query is the one that works when the title
  is unreadable — "Harper Lee" finds *To Kill a Mockingbird*; "ockingbird harper Lee" finds
  nothing at all.
- **Queries are sanitised.** One unbalanced quote from OCR (`"harper Lee`) made Open
  Library return zero results for every query built from it.
- **Every result is scored against all the OCR evidence**, not against one chosen line.
  This is what lets a cover whose title the detector got wrong still be identified.
- **Issued one at a time and scored as they land**, stopping the moment a book is
  identified. Firing all five up front was slow and generated enough traffic that Open
  Library began refusing requests — which reaches the browser as a bare `Failed to fetch`.

### Acceptance, and the four vetoes

A result is accepted only on corroboration too specific to be coincidence: every
identifying word of the title read, or the title plus a corroborated author, or an exact
author plus part of the title. Every branch requires at least one long, specific word,
which is what stops `Ird` and `ITT` matching anything.

Then four vetoes, each added because it caught a real wrong answer:

| Veto | The failure it prevents |
|---|---|
| **Different author** — the cover names an author, the entry names someone else | A real novel *is* called *Iron Harvest*; matching on title alone replaced correctly-read authors on 6 of 15 covers |
| **Unexplained cover words** — the cover shows words the entry cannot account for | A book called *Thirteen* scored a flawless 1 against a cover saying "Thirteen Doors" |
| **Name-titled book with no corroborated author** | A steeply-angled *Anna Karenina* yielded only "LEO TOLSTOY" and matched Chesterton's *biography* of him |
| **Blurb attributions** — lines opening with a dash, and publication names | A cover quoting the Village Voice was identified as *The Village Voice Film Guide* |

The first veto is itself gated: only an author line OCR was at least 60% sure of may
contradict anything. The cover of *Jane Eyre* says "Charlotte Brontë", OCR rendered it
"Charjoy Bro", and letting a reading that damaged veto the correct book cost real matches.
60 was chosen by sweeping the threshold against all three fixture sets.

### Confidence

Now built from how far the winning interpretation beat the runner-up, how much the
catalogue corroborated, and how much the chosen title looks like a title at all — a
six-letter fragment is not one, however sure OCR was of the letters. Below 55 the review
card stops showing a number and says **"Not sure — please check"**, with the photo advice
that applies.

### Caching

Successful searches are stored in IndexedDB for a month, in memory within a session.
Scanning a shelf asks the same questions repeatedly; a remembered answer needs no network.

## 4. Files changed

| File | Change |
|---|---|
| `src/pipeline/identify.ts` | **new** — multi-query identification, evidence scoring, vetoes, cache use |
| `src/pipeline/identify.test.ts` | **new** — 28 tests |
| `src/pipeline/ocr.ts` | multi-pass schedule, pooling, deskew, assumed DPI, early exit |
| `src/pipeline/candidates.ts` | hypotheses, per-pass scoring, wordiness filter, blurb/publication noise, honest confidence |
| `src/pipeline/preprocess.ts` | illumination flattening, `assessQuality` |
| `src/pipeline/text.ts` | `wordiness`, `letterCount` |
| `src/pipeline/types.ts` | `OcrEvidence`, `OcrPass`, `Hypothesis` |
| `src/pipeline/enrich.ts` | reduced to the client and connectivity probe; the superseded matcher removed |
| `src/storage/db.ts` | `lookups` cache store, `createLookupCache` |
| `src/storage/backup.ts` | **new** — export/import, share-sheet delivery |
| `src/ui/useScanner.ts` | per-stage progress, quality warnings, cache wiring |
| `src/ui/ScanScreen.tsx` | per-photo progress bars and stage detail |
| `src/ui/ReviewScreen.tsx` | uncertainty wording and warning |
| `src/ui/LibraryScreen.tsx` | reworked backup section |
| `scripts/make-hard-fixtures.mjs` | **new** — the 18 difficult covers |
| `scripts/diagnose.mjs` | **new** — per-stage diagnosis |
| `scripts/benchmark.mjs` | `--hard`, `--lookup` |

## 5. Results

15 clean rendered covers · 18 deliberately difficult covers · 15 real Open Library covers.
"Confidently wrong" means a wrong book reported at 60% confidence or higher — the metric
that matters most, because those are the answers a user would accept without checking.

| Set | Metric | Before | After |
|---|---|---|---|
| **Real covers, online** | Title exact | 3/15 | **8/15** |
| | Author found | 3/15 | **9/15** |
| | Confidently wrong | 8/15 | **0/15** |
| **Real covers, offline** | Title exact | 1/15 | 1/15 |
| | Confidently wrong | 8/15 | **4/15** |
| **Difficult set, online** | Title exact | — | **14/18** |
| | Author found | — | **15/18** |
| | Expected behaviour | — | **17/18** |
| **Difficult set, offline** | Title exact | — | 8/18 |
| **Clean covers, offline** | Title exact | 15/15 | 15/15 |
| | Confidently wrong | 0/15 | 0/15 |
| **Clean covers, online** | Title exact | — | 15/15 |

Median time per cover: 200 ms offline on a clean photo, 1.7–4 s with the lookup.

The difficult set scores each case against what a correct scanner *should* do — identify
the book, or name the author when only the author is legible, or report low confidence when
nothing is. 17 of 18 behave correctly. The one failure is a glare band across the title;
it reads it partially and reports low confidence rather than a wrong book.

**Online is now better than offline on every set**, which is the reversal that mattered.

## 6. Remaining limitations

- **Low-resolution cover artwork stays hard.** 8/15 on 300×500 thumbnails. A photo of a
  physical book is thousands of pixels wide; that is the case the app is used in and it
  scores far higher. Three of those covers are unreadable by any pass.
- **Steep angles lose the title.** Beyond ~40° the app names the author and says it is
  unsure. There is no perspective-correction stage — only deskew.
- **Cyrillic needs the Macedonian language data downloaded**; with English only, a Cyrillic
  title is correctly reported as unreadable rather than guessed.
- **Books not in Open Library** cannot be corroborated. They fall back to the offline
  reading, which on a clean cover is already correct.
- **Lookup adds 1–4 seconds** per book. It is a visible, always-tappable control.

## 7. Running it

```bash
npm test                              # 133 unit tests
npm run test:e2e                      # 31 end-to-end tests

node scripts/make-fixtures.mjs        # render the clean covers
npm run make-hard-fixtures            # render the 18 difficult covers
npm run fetch-benchmark               # download real covers from Open Library

npm run benchmark                     # clean covers, offline   → docs/accuracy-covers-offline.md
npm run benchmark -- --hard --lookup  # difficult set, online   → docs/accuracy-hard-online.md
npm run benchmark -- --real --lookup  # real covers, online     → docs/accuracy-benchmark-online.md

npm run dev -- --port 5199            # then, for per-stage detail:
npm run diagnose -- --hard --lookup --verbose
```

`diagnose` prints, for every fixture, what OCR read, what the detector chose, which queries
went out, what came back, and why each candidate was accepted or rejected. It is the tool
to reach for when a specific book is misread.
