# OCR accuracy benchmark

Generated 2026-08-30T05:29:49.534Z by `npm run benchmark -- --real --lookup`.

Run against **15 real book covers** downloaded from Open Library (`npm run fetch-benchmark`) — 300×500 artwork thumbnails.
Run through the real browser pipeline in headless Chromium.
**Open Library lookup on** — OCR evidence corroborated against the catalogue.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 8/15 (53%) |
| Title fuzzy match (≥0.7) | 8/15 (53%) |
| Author found | 9/15 (60%) |
| Median time per cover | 2839 ms |
| Median cover thumbnail | 17 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| the-hobbit-tolkien | The Hobbit / J.R.R. Tolkien | The Hobbit | J.R.R. Tolkien | exact | yes | 95 | 1589 |
| dune-frank-herbert | Dune / Frank Herbert | novels... 1 know nothing The Lord of the Ri | FEY | miss | no | 39 | 7674 |
| the-great-gatsby-fitzgerald | The Great Gatsby / F. Scott Fitzgerald | The Great Gatsby | F. Scott Fitzgerald | exact | yes | 98 | 2097 |
| to-kill-a-mockingbird-harper-lee | To Kill a Mockingbird / Harper Lee | To Kill a Mockingbird | Harper Lee | exact | yes | 82 | 2656 |
| nineteen-eighty-four-george-orwell | Nineteen Eighty-Four / George Orwell | Sas | {aig | miss | no | 26 | 9176 |
| pride-and-prejudice-jane-austen | Pride and Prejudice / Jane Austen | Pride and Prejudice | Jane Austen | exact | yes | 84 | 1747 |
| the-catcher-in-the-rye-salinger | The Catcher in the Rye / J. D. Salinger | The Catcher in the Rye | J. D. Salinger | exact | yes | 93 | 2839 |
| fahrenheit-451-ray-bradbury | Fahrenheit 451 / Ray Bradbury | h IN \ : | a? Pr AL | miss | no | 22 | 4132 |
| brave-new-world-aldous-huxley | Brave New World / Aldous Huxley | Brave New World | Aldous Huxley | exact | yes | 84 | 809 |
| the-fellowship-of-the-ring-tolkien | The Lord of the Rings / J.R.R. Tolkien | icy | Fon | miss | no | 25 | 6524 |
| slaughterhouse-five-kurt-vonnegut | Slaughterhouse-Five / Kurt Vonnegut | New Novel By | The Ne | miss | no | 56 | 3793 |
| beloved-toni-morrison | Beloved / Toni Morrison | Morrison | Toni Morrison | miss | yes | 45 | 4698 |
| the-handmaid-s-tale-margaret-atwood | The Handmaid's Tale / Margaret Atwood | The Handmaid's Tale | Margaret Atwood | exact | yes | 98 | 1990 |
| the-road-cormac-mccarthy | The Road / Cormac McCarthy | The Road | Cormac McCarthy | exact | yes | 83 | 1924 |
| neuromancer-william-gibson | Neuromancer / William Gibson | Gibs | New | miss | no | 42 | 3829 |
