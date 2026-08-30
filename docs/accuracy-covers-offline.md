# OCR accuracy benchmark

Generated 2026-08-30T12:32:39.421Z by `npm run benchmark --`.

Run against **15 rendered covers** at 1200×1800 (`node scripts/make-fixtures.mjs`), the resolution a phone photo of a physical book actually has.
Run through the real browser pipeline in headless Chromium.
**Offline only** — no network; these are the on-device numbers.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 14/15 (93%) |
| Title fuzzy match (≥0.7) | 14/15 (93%) |
| Author found | 15/15 (100%) |
| Median time per cover | 530 ms |
| Median cover thumbnail | 6 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| silent-orchard | The Silent Orchard / Marta Reyes | The Silent Orchard | Marta Reyes | exact | yes | 74 | 530 |
| winter-letters | Winter Letters / Jonas Lindqvist | Winter Letters | Jonas Lindqvist | exact | yes | 96 | 371 |
| iron-harvest | Iron Harvest / D. K. Whitlock | Iron Harvest | D. K. Whitlock | exact | yes | 90 | 537 |
| glass-cathedral | The Glass Cathedral / Amara Osei | The Glass Cathedral | Amara Osei | exact | yes | 96 | 392 |
| salt-and-ash | Salt and Ash / Peter Vance | Salt and | Peter Vance | miss | yes | 76 | 402 |
| north-of-nowhere | North of Nowhere / Helena Brandt | North of Nowhere | Helena Brandt | exact | yes | 76 | 376 |
| quiet-machine | The Quiet Machine / Yuki Tanaka | The Quiet Machine | Yuki Tanaka | exact | yes | 96 | 714 |
| last-cartographer | The Last Cartographer / Owen Mbeki | The Last Cartographer | Owen Mbeki | exact | yes | 96 | 457 |
| burning-season | Burning Season / Clara Nowak | Burning Season | Clara Nowak | exact | yes | 96 | 771 |
| thirteen-doors | Thirteen Doors / S. J. Ferreira | Thirteen Doors | S. J. Ferreira | exact | yes | 96 | 1674 |
| river-of-stone | The River of Stone / Nadia Ivanova | The River of Stone | Nadia Ivanova | exact | yes | 76 | 457 |
| paper-tigers | Paper Tigers / Miguel Santos | Paper Tigers | Miguel Santos | exact | yes | 92 | 668 |
| hollow-crownwork | The Hollow Crownwork / Eleanor Fitzgibbon | The Hollow Crownwork | Eleanor Fitzgibbon | exact | yes | 96 | 530 |
| midnight-signal | Midnight Signal / Ray Okonkwo | Midnight Signal | Ray Okonkwo | exact | yes | 96 | 698 |
| weight-of-water | The Weight of Water / Ingrid Solberg | The Weight of Water | Ingrid Solberg | exact | yes | 74 | 438 |
