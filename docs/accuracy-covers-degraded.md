# OCR accuracy benchmark

Generated 2026-08-29T15:20:44.088Z by `npm run benchmark -- --degraded`.

Run against **15 rendered covers** at 1200×1800 (`node scripts/make-fixtures.mjs`), the resolution a phone photo of a physical book actually has.
Run through the real browser pipeline in headless Chromium:
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Degraded set:** each cover was rotated 3°, blurred, darkened to 85% and re-encoded at JPEG q40 before scanning, to approximate a hand-held phone photo.

| Metric | Result |
|---|---|
| Title exact match | 13/15 (87%) |
| Title fuzzy match (≥0.7) | 13/15 (87%) |
| Author found | 14/15 (93%) |
| Median time per cover | 235 ms |
| Median cover thumbnail | 7 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| silent-orchard | The Silent Orchard / Marta Reyes | The Silent | Marta Reyes | miss | yes | 92 | 313 |
| winter-letters | Winter Letters / Jonas Lindqvist | Winter Letters | Jonas Lindqvist | exact | yes | 98 | 202 |
| iron-harvest | Iron Harvest / D. K. Whitlock | Iron Harvest | D. K. Whitlock | exact | yes | 98 | 252 |
| glass-cathedral | The Glass Cathedral / Amara Osei | The Glass Cathedral | Amara Osej | exact | yes | 97 | 274 |
| salt-and-ash | Salt and Ash / Peter Vance | Salt and Ash | Peter Vance | exact | yes | 98 | 203 |
| north-of-nowhere | North of Nowhere / Helena Brandt | Helena Brandt | — | miss | no | 83 | 169 |
| quiet-machine | The Quiet Machine / Yuki Tanaka | The Quiet Machine | Yuki Tanaka | exact | yes | 98 | 264 |
| last-cartographer | The Last Cartographer / Owen Mbeki | The Last Cartographer | Owen Mbeki | exact | yes | 98 | 178 |
| burning-season | Burning Season / Clara Nowak | Burning Season | Clara Nowak | exact | yes | 98 | 271 |
| thirteen-doors | Thirteen Doors / S. J. Ferreira | Thirteen Doors | S. I. Ferreira | exact | yes | 98 | 183 |
| river-of-stone | The River of Stone / Nadia Ivanova | The River of Stone | Nadia Ivanova | exact | yes | 98 | 183 |
| paper-tigers | Paper Tigers / Miguel Santos | Paper Tigers | Miguel Santos | exact | yes | 98 | 268 |
| hollow-crownwork | The Hollow Crownwork / Eleanor Fitzgibbon | The Hollow Crownwork | Eleanor Fitzgibbon | exact | yes | 96 | 235 |
| midnight-signal | Midnight Signal / Ray Okonkwo | Midnight Signal | Ray Okonkwo | exact | yes | 97 | 250 |
| weight-of-water | The Weight of Water / Ingrid Solberg | The Weight of Water | Ingrid Solberg | exact | yes | 98 | 207 |
