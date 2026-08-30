# OCR accuracy benchmark

Generated 2026-08-30T12:37:00.409Z by `npm run benchmark -- --lookup`.

Run against **2 rendered covers** at 1200×1800 (`node scripts/make-fixtures.mjs`), the resolution a phone photo of a physical book actually has.
Run through the real browser pipeline in headless Chromium.
**Open Library lookup on** — OCR evidence corroborated against the catalogue.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 0/2 (0%) |
| Title fuzzy match (≥0.7) | 0/2 (0%) |
| Author found | 2/2 (100%) |
| Median time per cover | 8752 ms |
| Median cover thumbnail | 22 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| sherlock-adventures | Авантурите на Шерлок Холмс / Артур Конан Дојл | Шерлок | Артур Конан до | miss | yes | 41 | 8752 |
| scarlet-study | Скарлетна студија / Артур Конан Дојл | Скарлетна | Артур Конан Дој | miss | yes | 39 | 5060 |
