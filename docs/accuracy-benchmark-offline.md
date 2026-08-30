# OCR accuracy benchmark

Generated 2026-08-30T11:13:12.975Z by `npm run benchmark -- --real`.

Run against **15 real book covers** downloaded from Open Library (`npm run fetch-benchmark`) — 300×500 artwork thumbnails.
Run through the real browser pipeline in headless Chromium.
**Offline only** — no network; these are the on-device numbers.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 2/15 (13%) |
| Title fuzzy match (≥0.7) | 4/15 (27%) |
| Author found | 3/15 (20%) |
| Median time per cover | 1320 ms |
| Median cover thumbnail | 17 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| the-hobbit-tolkien | The Hobbit / J.R.R. Tolkien | The Hobbit | Jrr Tolkien | exact | yes | 60 | 735 |
| dune-frank-herbert | Dune / Frank Herbert | amon SE eis Los | {ur C. Clarke | miss | no | 38 | 4394 |
| the-great-gatsby-fitzgerald | The Great Gatsby / F. Scott Fitzgerald | Great | Officsal Publisher Partnership —— | miss | no | 40 | 500 |
| to-kill-a-mockingbird-harper-lee | To Kill a Mockingbird / Harper Lee | TO KI ockin 1Qbird od A | Harper Lee | miss | yes | 43 | 1335 |
| nineteen-eighty-four-george-orwell | Nineteen Eighty-Four / George Orwell | To oa | Sas | miss | no | 26 | 6522 |
| pride-and-prejudice-jane-austen | Pride and Prejudice / Jane Austen | Pride anil Prejudice | — | ~0.9 | no | 56 | 686 |
| the-catcher-in-the-rye-salinger | The Catcher in the Rye / J. D. Salinger | At il h ; ! novel by J. D ALINGER | n He RYE | miss | no | 41 | 1800 |
| fahrenheit-451-ray-bradbury | Fahrenheit 451 / Ray Bradbury | ) p= pe fulreahelf | Re La \ El 3 | miss | no | 54 | 1574 |
| brave-new-world-aldous-huxley | Brave New World / Aldous Huxley | Dd Lut Brave > | New World | miss | no | 45 | 400 |
| the-fellowship-of-the-ring-tolkien | The Lord of the Rings / J.R.R. Tolkien | pret bs Ba saad | Barc 3 Zr | miss | no | 33 | 3709 |
| slaughterhouse-five-kurt-vonnegut | Slaughterhouse-Five / Kurt Vonnegut | Children's = Crusade A NEW NOVEL BY | At Vonneg | miss | no | 56 | 712 |
| beloved-toni-morrison | Beloved / Toni Morrison | Morrison | I Novel | miss | no | 31 | 1361 |
| the-handmaid-s-tale-margaret-atwood | The Handmaid's Tale / Margaret Atwood | 'Handmaid's Tale | Margaret Atwood | ~0.79 | yes | 53 | 1320 |
| the-road-cormac-mccarthy | The Road / Cormac McCarthy | The Road | — | exact | no | 48 | 740 |
| neuromancer-william-gibson | Neuromancer / William Gibson | Gibs | New | miss | no | 43 | 679 |
