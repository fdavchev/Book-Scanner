# OCR accuracy benchmark

Generated 2026-08-30T05:27:25.062Z by `npm run benchmark -- --real`.

Run against **15 real book covers** downloaded from Open Library (`npm run fetch-benchmark`) — 300×500 artwork thumbnails.
Run through the real browser pipeline in headless Chromium.
**Offline only** — no network; these are the on-device numbers.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 1/15 (7%) |
| Title fuzzy match (≥0.7) | 1/15 (7%) |
| Author found | 2/15 (13%) |
| Median time per cover | 1082 ms |
| Median cover thumbnail | 17 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| the-hobbit-tolkien | The Hobbit / J.R.R. Tolkien | Hobbit | THE | miss | no | 47 | 745 |
| dune-frank-herbert | Dune / Frank Herbert | novels... 1 know nothing The Lord of the Ri | FEY | miss | no | 39 | 4309 |
| the-great-gatsby-fitzgerald | The Great Gatsby / F. Scott Fitzgerald | F. Scott Fitzgerald | Ocr" Oxford | miss | no | 54 | 495 |
| to-kill-a-mockingbird-harper-lee | To Kill a Mockingbird / Harper Lee | To Ki | Harper Lee | miss | yes | 30 | 1328 |
| nineteen-eighty-four-george-orwell | Nineteen Eighty-Four / George Orwell | Sas | {aig | miss | no | 26 | 6374 |
| pride-and-prejudice-jane-austen | Pride and Prejudice / Jane Austen | scot | Pride Prejudice | miss | no | 38 | 687 |
| the-catcher-in-the-rye-salinger | The Catcher in the Rye / J. D. Salinger | Catcher Nie Rye | D/salinger | miss | yes | 47 | 1768 |
| fahrenheit-451-ray-bradbury | Fahrenheit 451 / Ray Bradbury | h IN \ : | a? Pr AL | miss | no | 22 | 1082 |
| brave-new-world-aldous-huxley | Brave New World / Aldous Huxley | Brave > | New World | miss | no | 38 | 379 |
| the-fellowship-of-the-ring-tolkien | The Lord of the Rings / J.R.R. Tolkien | icy | Fon | miss | no | 25 | 3644 |
| slaughterhouse-five-kurt-vonnegut | Slaughterhouse-Five / Kurt Vonnegut | New Novel By | The Ne | miss | no | 56 | 719 |
| beloved-toni-morrison | Beloved / Toni Morrison | Morrison | I Novel | miss | no | 50 | 1304 |
| the-handmaid-s-tale-margaret-atwood | The Handmaid's Tale / Margaret Atwood | Margaret Atwood | 'Handmaid's Tale | miss | no | 72 | 1316 |
| the-road-cormac-mccarthy | The Road / Cormac McCarthy | The Road | — | exact | no | 51 | 722 |
| neuromancer-william-gibson | Neuromancer / William Gibson | Gibs | New | miss | no | 42 | 651 |
