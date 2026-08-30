# OCR accuracy benchmark

Generated 2026-08-30T11:13:21.921Z by `npm run benchmark --`.

Run against **2 rendered covers** at 1200×1800 (`node scripts/make-fixtures.mjs`), the resolution a phone photo of a physical book actually has.
Run through the real browser pipeline in headless Chromium.
**Offline only** — no network; these are the on-device numbers.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 0/2 (0%) |
| Title fuzzy match (≥0.7) | 0/2 (0%) |
| Author found | 2/2 (100%) |
| Median time per cover | 4532 ms |
| Median cover thumbnail | 22 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| sherlock-adventures | Авантурите на Шерлок Холмс / Артур Конан Дојл | "шерло | Артур Кона Ов, | miss | yes | 31 | 4532 |
| scarlet-study | Скарлетна студија / Артур Конан Дојл | Скарлетна | Уарлур Конан Дојл: | miss | yes | 37 | 3603 |
