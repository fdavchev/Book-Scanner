# OCR accuracy benchmark

Generated 2026-08-30T11:14:13.877Z by `npm run benchmark -- --lookup`.

Run against **15 rendered covers** at 1200×1800 (`node scripts/make-fixtures.mjs`), the resolution a phone photo of a physical book actually has.
Run through the real browser pipeline in headless Chromium.
**Open Library lookup on** — OCR evidence corroborated against the catalogue.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 14/15 (93%) |
| Title fuzzy match (≥0.7) | 14/15 (93%) |
| Author found | 14/15 (93%) |
| Median time per cover | 3302 ms |
| Median cover thumbnail | 6 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| silent-orchard | The Silent Orchard / Marta Reyes | The Silent Orchard | Marta Reyes | exact | yes | 73 | 4491 |
| winter-letters | Winter Letters / Jonas Lindqvist | Winter Letters | Jenny Björklund | exact | no | 45 | 3467 |
| iron-harvest | Iron Harvest / D. K. Whitlock | Iron Harvest | Dave Whitlock | exact | yes | 45 | 3302 |
| glass-cathedral | The Glass Cathedral / Amara Osei | The Glass Cathedral | Amara Osei | exact | yes | 96 | 3459 |
| salt-and-ash | Salt and Ash / Peter Vance | Salt and | Peter Vance | miss | yes | 76 | 2936 |
| north-of-nowhere | North of Nowhere / Helena Brandt | North of Nowhere | Helena Brandt | exact | yes | 96 | 3151 |
| quiet-machine | The Quiet Machine / Yuki Tanaka | The Quiet Machine | Yuki Tanaka | exact | yes | 45 | 3558 |
| last-cartographer | The Last Cartographer / Owen Mbeki | The Last Cartographer | Owen Mbeki | exact | yes | 96 | 3178 |
| burning-season | Burning Season / Clara Nowak | Burning Season | Clara Nowak | exact | yes | 93 | 3164 |
| thirteen-doors | Thirteen Doors / S. J. Ferreira | Thirteen Doors | S. J. Ferreira | exact | yes | 96 | 2951 |
| river-of-stone | The River of Stone / Nadia Ivanova | The River of Stone | Nadia Ivanova | exact | yes | 96 | 3547 |
| paper-tigers | Paper Tigers / Miguel Santos | Paper Tigers | Miguel Santos | exact | yes | 45 | 4290 |
| hollow-crownwork | The Hollow Crownwork / Eleanor Fitzgibbon | The Hollow Crownwork | Eleanor Fitzgibbon | exact | yes | 96 | 3618 |
| midnight-signal | Midnight Signal / Ray Okonkwo | Midnight Signal | Ray Okonkwo | exact | yes | 94 | 3244 |
| weight-of-water | The Weight of Water / Ingrid Solberg | The Weight of Water | Ingrid Solberg | exact | yes | 82 | 2834 |
