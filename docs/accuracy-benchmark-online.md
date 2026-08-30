# OCR accuracy benchmark

Generated 2026-08-30T12:36:45.738Z by `npm run benchmark -- --real --lookup`.

Run against **15 real book covers** downloaded from Open Library (`npm run fetch-benchmark`) — 300×500 artwork thumbnails.
Run through the real browser pipeline in headless Chromium.
**Open Library lookup on** — OCR evidence corroborated against the catalogue.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 6/15 (40%) |
| Title fuzzy match (≥0.7) | 8/15 (53%) |
| Author found | 9/15 (60%) |
| Median time per cover | 4713 ms |
| Median cover thumbnail | 17 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| the-hobbit-tolkien | The Hobbit / J.R.R. Tolkien | The Hobbit | J.R.R. Tolkien | exact | yes | 91 | 2795 |
| dune-frank-herbert | Dune / Frank Herbert | novels... 1 know nothing The Lord of the Ri | FEY | miss | no | 42 | 10289 |
| the-great-gatsby-fitzgerald | The Great Gatsby / F. Scott Fitzgerald | The Great Gatsby | F. Scott Fitzgerald | exact | yes | 98 | 1473 |
| to-kill-a-mockingbird-harper-lee | To Kill a Mockingbird / Harper Lee | To KILL A Mocking | Harper Lee | ~0.81 | yes | 45 | 4614 |
| nineteen-eighty-four-george-orwell | Nineteen Eighty-Four / George Orwell | To oa | Sas | miss | no | 26 | 12562 |
| pride-and-prejudice-jane-austen | Pride and Prejudice / Jane Austen | Pride anil Prejudice | — | ~0.9 | no | 56 | 4823 |
| the-catcher-in-the-rye-salinger | The Catcher in the Rye / J. D. Salinger | The Catcher in the Rye | J. D. Salinger | exact | yes | 95 | 4713 |
| fahrenheit-451-ray-bradbury | Fahrenheit 451 / Ray Bradbury | ) p= pe fulreahelf | Re La \ El 3 | miss | no | 53 | 6418 |
| brave-new-world-aldous-huxley | Brave New World / Aldous Huxley | Brave New World | Aldous Huxley | exact | yes | 84 | 2302 |
| the-fellowship-of-the-ring-tolkien | The Lord of the Rings / J.R.R. Tolkien | pret bs Ba saad | Barc 3 Zr | miss | no | 33 | 9212 |
| slaughterhouse-five-kurt-vonnegut | Slaughterhouse-Five / Kurt Vonnegut | A New Novel By | Jonnegut. Jf | miss | no | 38 | 4207 |
| beloved-toni-morrison | Beloved / Toni Morrison | Morrison | Toni Morrison | miss | yes | 32 | 6548 |
| the-handmaid-s-tale-margaret-atwood | The Handmaid's Tale / Margaret Atwood | The Handmaid's Tale | Margaret Atwood | exact | yes | 98 | 2630 |
| the-road-cormac-mccarthy | The Road / Cormac McCarthy | The Road | Cormac McCarthy | exact | yes | 83 | 11164 |
| neuromancer-william-gibson | Neuromancer / William Gibson | All Tomorrow's Parties | William Gibson | miss | yes | 90 | 1995 |
