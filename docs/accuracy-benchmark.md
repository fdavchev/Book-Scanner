# OCR accuracy benchmark

Generated 2026-08-29T15:20:56.459Z by `npm run benchmark`.

Run against **15 real book covers** downloaded from Open Library (`npm run fetch-benchmark`) — 300×500 artwork thumbnails.
Run through the real browser pipeline in headless Chromium:
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 1/15 (7%) |
| Title fuzzy match (≥0.7) | 3/15 (20%) |
| Author found | 0/15 (0%) |
| Median time per cover | 220 ms |
| Median cover thumbnail | 17 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| the-hobbit-tolkien | The Hobbit / J.R.R. Tolkien | I Hobbit | — | ~0.7 | no | 56 | 301 |
| dune-frank-herbert | Dune / Frank Herbert | . Srt | .o OF | miss | no | 46 | 318 |
| the-great-gatsby-fitzgerald | The Great Gatsby / F. Scott Fitzgerald | F. Scott Fitzgerald | Ocr" Oxford | miss | no | 82 | 131 |
| to-kill-a-mockingbird-harper-lee | To Kill a Mockingbird / Harper Lee | ird. | — | miss | no | 76 | 398 |
| nineteen-eighty-four-george-orwell | Nineteen Eighty-Four / George Orwell | — | — | miss | no | 0 | 205 |
| pride-and-prejudice-jane-austen | Pride and Prejudice / Jane Austen | Prejudice EZ | — | miss | no | 67 | 152 |
| the-catcher-in-the-rye-salinger | The Catcher in the Rye / J. D. Salinger | Itt] | — | miss | no | 55 | 287 |
| fahrenheit-451-ray-bradbury | Fahrenheit 451 / Ray Bradbury | Ray Bradb | Ry | miss | no | 96 | 168 |
| brave-new-world-aldous-huxley | Brave New World / Aldous Huxley | New World | — | miss | no | 76 | 220 |
| the-fellowship-of-the-ring-tolkien | The Lord of the Rings / J.R.R. Tolkien | — | — | miss | no | 0 | 180 |
| slaughterhouse-five-kurt-vonnegut | Slaughterhouse-Five / Kurt Vonnegut | An $1.95 $2.35 in Canada | — | miss | no | 75 | 272 |
| beloved-toni-morrison | Beloved / Toni Morrison | [ll Morrison | I Novel | miss | no | 73 | 410 |
| the-handmaid-s-tale-margaret-atwood | The Handmaid's Tale / Margaret Atwood | Margaret Atwood | 'Handmaid's Tale | miss | no | 98 | 204 |
| the-road-cormac-mccarthy | The Road / Cormac McCarthy | The Road | — | exact | no | 83 | 97 |
| neuromancer-william-gibson | Neuromancer / William Gibson | Neuromahcer | — Village Voice | ~0.91 | no | 83 | 232 |
