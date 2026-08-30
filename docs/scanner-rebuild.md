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


---

# Follow-up: Macedonian covers, and letting big letters win the title

Added 30 August 2026, after two real Macedonian covers failed in ways that had nothing to
do with OCR quality.

## What was wrong

**"Авантурите на Шерлок Холмс"** returned `"Авантурите Н. Шерло"` with the giant `ХОЛМС`
line missing entirely. **"Скарлетна студија"** got the author right but chose the *tiny*
translator credit `"Превод: Ѓургица Илиева Нацкова"` as the title, beating two huge lines.

The cause was not that size was weighted too low. `scoreTitles` measured height against
the tallest **surviving** candidate, and `groupLines` dropped anything under 30%
confidence — which is exactly what heavy display type over artwork scores. With both title
lines filtered out, the translator credit became "the largest text on the cover" by
default, and the per-pass rescaling then normalised it to a perfect 1.0. It won on a
technicality.

Underneath that, several things were English-only or actively wrong for Macedonian:

| Defect | Effect |
|---|---|
| `normalise` decomposed **Ѓ→Г** and **Ќ→К** | the two letters unique to Macedonian were erased |
| `wordiness` had no vocalic **Р** | `Крв`, `Смрт`, `Прв`, `Црн` scored as garbage in five scoring paths at once |
| No Macedonian noise words | `Превод:` — the translator — competed for the title |
| App defaulted to the English model | and `CropAndRescan` hardcoded English on the one screen meant to *fix* a bad read |
| Harnesses hardcoded `init(['eng'])` | the Cyrillic fixtures were being measured with the wrong model, so every Macedonian number was meaningless |

## What changed

- **An absolute size reference.** `tallestLineHeight` measures the biggest text a pass
  actually read, before filtering, ignoring zero-confidence artwork reads. It is computed
  **cover-wide** and passed into every pass, so a pass that read only the author's name can
  no longer believe that name is full-size.
- **Large low-confidence lines are kept.** A line at ≥50% of the cover's tallest is
  admitted at 20% confidence instead of 30%, but must clear a stricter letter-count and
  word-shape test.
- **Smallness is disqualifying.** A line below 55% of full size loses score that nothing
  else can pay back.
- **Display blocks merge.** A title stepping from medium to giant type joins into one
  candidate, compared against the previous *line* rather than the block's running average,
  with the block's height taken as the **median** of its lines.
- **Letter-spaced type is rejoined.** `Ш Е Р Л О К` reads as one word again.
- **Duplicate readings are collapsed.** Two passes reading the same physical line no longer
  concatenate into "СНАБЛЕТНА. СКАРЛЕТНА"; the fuller reading wins.
- **Macedonian is the default language**, with English one tap away.
- **A Latin catalogue result can never replace a Cyrillic title** — the book on the shelf
  says what it says. The catalogue may still name the author.

## Results

| Set | Metric | Before | After |
|---|---|---|---|
| **The two Macedonian covers** | Author found | 1/2 | **2/2** |
| | Title is the translator credit | yes | **no** |
| | Confidently wrong | 1/2 | **0/2** |
| **18 difficult covers** | Title exact | 14/18 | **16/18** |
| | Confidently wrong | 2/18 | **0/18** |
| **15 clean English covers** | Title exact | 15/15 | 14/15 |
| **15 real low-res covers** | Title exact | 8/15 | 6/15 |
| | Confidently wrong | 1/15 | **0/15** |

*Скарлетна студија* now reads **"Скарлетна"** — the real title, where it used to be the
translator's name. *Авантурите* still returns only the fragment "Шерло": the words
"АВАНТУРИТЕ" and "ШЕРЛОК" are read by *different* OCR passes, and passes are scored
separately on purpose, so they cannot be merged into one title. Fixing that needs
cross-pass line stitching, which an earlier attempt showed does more harm than good.

**The trade, stated plainly.** Making size decisive cost two covers on the low-resolution
English artwork set and one on the clean set, and gained two on the difficult set. Wrong
answers fell to zero on every set except the clean one. For a shelf of Macedonian books
photographed with a phone, that is the right side of the trade; if this were mainly an
English low-resolution library, it would not be.
