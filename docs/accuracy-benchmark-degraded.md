# OCR accuracy benchmark

Generated 2026-08-29T15:20:59.580Z by `npm run benchmark -- --degraded`.

Run against **15 real book covers** downloaded from Open Library (`npm run fetch-benchmark`) — 300×500 artwork thumbnails.
Run through the real browser pipeline in headless Chromium:
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Degraded set:** each cover was rotated 3°, blurred, darkened to 85% and re-encoded at JPEG q40 before scanning, to approximate a hand-held phone photo.

| Metric | Result |
|---|---|
| Title exact match | 0/15 (0%) |
| Title fuzzy match (≥0.7) | 0/15 (0%) |
| Author found | 0/15 (0%) |
| Median time per cover | 148 ms |
| Median cover thumbnail | 16 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| the-hobbit-tolkien | The Hobbit / J.R.R. Tolkien | Zrr. Tolkien | — | miss | no | 60 | 196 |
| dune-frank-herbert | Dune / Frank Herbert | — | — | miss | no | 0 | 175 |
| the-great-gatsby-fitzgerald | The Great Gatsby / F. Scott Fitzgerald | F. Scott Fitzgerald | Offic I» | miss | no | 68 | 150 |
| to-kill-a-mockingbird-harper-lee | To Kill a Mockingbird / Harper Lee | \harper Lee Nn Pe | — | miss | no | 63 | 226 |
| nineteen-eighty-four-george-orwell | Nineteen Eighty-Four / George Orwell | — | — | miss | no | 0 | 124 |
| pride-and-prejudice-jane-austen | Pride and Prejudice / Jane Austen | — | — | miss | no | 0 | 108 |
| the-catcher-in-the-rye-salinger | The Catcher in the Rye / J. D. Salinger | ¢ novel by J. D/SALINGER | — | miss | no | 70 | 128 |
| fahrenheit-451-ray-bradbury | Fahrenheit 451 / Ray Bradbury | Ray Bradbury | — | miss | no | 71 | 148 |
| brave-new-world-aldous-huxley | Brave New World / Aldous Huxley | — | — | miss | no | 0 | 99 |
| the-fellowship-of-the-ring-tolkien | The Lord of the Rings / J.R.R. Tolkien | — | — | miss | no | 0 | 152 |
| slaughterhouse-five-kurt-vonnegut | Slaughterhouse-Five / Kurt Vonnegut | — | — | miss | no | 0 | 128 |
| beloved-toni-morrison | Beloved / Toni Morrison | — | — | miss | no | 0 | 157 |
| the-handmaid-s-tale-margaret-atwood | The Handmaid's Tale / Margaret Atwood | Margaret Atwood | — | miss | no | 83 | 234 |
| the-road-cormac-mccarthy | The Road / Cormac McCarthy | — | — | miss | no | 0 | 121 |
| neuromancer-william-gibson | Neuromancer / William Gibson | — | — | miss | no | 0 | 97 |
