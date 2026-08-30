# OCR accuracy benchmark

Generated 2026-08-30T11:16:03.502Z by `npm run benchmark -- --real --lookup`.

Run against **15 real book covers** downloaded from Open Library (`npm run fetch-benchmark`) — 300×500 artwork thumbnails.
Run through the real browser pipeline in headless Chromium.
**Open Library lookup on** — OCR evidence corroborated against the catalogue.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 6/15 (40%) |
| Title fuzzy match (≥0.7) | 7/15 (47%) |
| Author found | 8/15 (53%) |
| Median time per cover | 4430 ms |
| Median cover thumbnail | 17 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| the-hobbit-tolkien | The Hobbit / J.R.R. Tolkien | The Hobbit | J.R.R. Tolkien | exact | yes | 95 | 1640 |
| dune-frank-herbert | Dune / Frank Herbert | amon SE eis Los | Joey Clarke | miss | no | 38 | 7826 |
| the-great-gatsby-fitzgerald | The Great Gatsby / F. Scott Fitzgerald | The Great Gatsby | F. Scott Fitzgerald | exact | yes | 98 | 4409 |
| to-kill-a-mockingbird-harper-lee | To Kill a Mockingbird / Harper Lee | TO KI ockin 1Qbird od A | Harper Lee | miss | yes | 43 | 6246 |
| nineteen-eighty-four-george-orwell | Nineteen Eighty-Four / George Orwell | To oa | Sas | miss | no | 26 | 10890 |
| pride-and-prejudice-jane-austen | Pride and Prejudice / Jane Austen | Pride anil Prejudice | — | ~0.9 | no | 56 | 5803 |
| the-catcher-in-the-rye-salinger | The Catcher in the Rye / J. D. Salinger | The Catcher in the Rye | J. D. Salinger | exact | yes | 93 | 4396 |
| fahrenheit-451-ray-bradbury | Fahrenheit 451 / Ray Bradbury | ) p= pe fulreahelf | Re La \ El 3 | miss | no | 54 | 5096 |
| brave-new-world-aldous-huxley | Brave New World / Aldous Huxley | Brave New World | Aldous Huxley | exact | yes | 84 | 2127 |
| the-fellowship-of-the-ring-tolkien | The Lord of the Rings / J.R.R. Tolkien | pret bs Ba saad | Barc 3 Zr | miss | no | 33 | 7360 |
| slaughterhouse-five-kurt-vonnegut | Slaughterhouse-Five / Kurt Vonnegut | Children's = Crusade A NEW NOVEL BY | At Vonneg | miss | no | 56 | 4113 |
| beloved-toni-morrison | Beloved / Toni Morrison | Morrison | Toni Morrison | miss | yes | 31 | 6399 |
| the-handmaid-s-tale-margaret-atwood | The Handmaid's Tale / Margaret Atwood | The Handmaid's Tale | Margaret Atwood | exact | yes | 98 | 1906 |
| the-road-cormac-mccarthy | The Road / Cormac McCarthy | The Road | Cormac McCarthy | exact | yes | 83 | 3908 |
| neuromancer-william-gibson | Neuromancer / William Gibson | Gibs | New | miss | no | 43 | 4430 |
