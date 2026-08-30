# OCR accuracy benchmark

Generated 2026-08-30T12:33:36.626Z by `npm run benchmark -- --real`.

Run against **15 real book covers** downloaded from Open Library (`npm run fetch-benchmark`) — 300×500 artwork thumbnails.
Run through the real browser pipeline in headless Chromium.
**Offline only** — no network; these are the on-device numbers.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 1/15 (7%) |
| Title fuzzy match (≥0.7) | 5/15 (33%) |
| Author found | 5/15 (33%) |
| Median time per cover | 1523 ms |
| Median cover thumbnail | 17 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| the-hobbit-tolkien | The Hobbit / J.R.R. Tolkien | "hobbit | Frr Tolkien | miss | yes | 64 | 649 |
| dune-frank-herbert | Dune / Frank Herbert | novels... 1 know nothing The Lord of the Ri | FEY | miss | no | 42 | 5893 |
| the-great-gatsby-fitzgerald | The Great Gatsby / F. Scott Fitzgerald | Gatsby | F. Scott Fitzgerald | miss | yes | 61 | 535 |
| to-kill-a-mockingbird-harper-lee | To Kill a Mockingbird / Harper Lee | To KILL A Mocking | Harrer LEE | ~0.81 | yes | 45 | 1523 |
| nineteen-eighty-four-george-orwell | Nineteen Eighty-Four / George Orwell | To oa | Sas | miss | no | 26 | 9244 |
| pride-and-prejudice-jane-austen | Pride and Prejudice / Jane Austen | Pride anil Prejudice | — | ~0.9 | no | 56 | 1077 |
| the-catcher-in-the-rye-salinger | The Catcher in the Rye / J. D. Salinger | Catcher in He Rye | I. By J. D/salinger | ~0.77 | yes | 66 | 2743 |
| fahrenheit-451-ray-bradbury | Fahrenheit 451 / Ray Bradbury | ) p= pe fulreahelf | Re La \ El 3 | miss | no | 53 | 2588 |
| brave-new-world-aldous-huxley | Brave New World / Aldous Huxley | Dd Lut Brave > | New World | miss | no | 44 | 419 |
| the-fellowship-of-the-ring-tolkien | The Lord of the Rings / J.R.R. Tolkien | pret bs Ba saad | Barc 3 Zr | miss | no | 33 | 5362 |
| slaughterhouse-five-kurt-vonnegut | Slaughterhouse-Five / Kurt Vonnegut | A New Novel By | Jonnegut. Jf | miss | no | 38 | 717 |
| beloved-toni-morrison | Beloved / Toni Morrison | Morrison | I Novel | miss | no | 32 | 1988 |
| the-handmaid-s-tale-margaret-atwood | The Handmaid's Tale / Margaret Atwood | 'Handmaid's Tale | Margaret Atwood | ~0.79 | yes | 51 | 2151 |
| the-road-cormac-mccarthy | The Road / Cormac McCarthy | The Road | — | exact | no | 46 | 1164 |
| neuromancer-william-gibson | Neuromancer / William Gibson | William | All | miss | no | 50 | 953 |
