# OCR accuracy benchmark

Generated 2026-09-06T08:45:06.971Z by `npm run benchmark -- --hard`.

Run against **18 deliberately difficult covers** (`node scripts/make-hard-fixtures.mjs`): blur, angles, glare, dim light, title-only, author-prominent, similar titles and Cyrillic.
Run through the real browser pipeline in headless Chromium.
**Read on the device** by tesseract.js.
**Offline only** — no network; these are the on-device numbers.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 12/18 (67%) |
| Title fuzzy match (≥0.7) | 13/18 (72%) |
| Author found | 12/18 (67%) |
| Confidently wrong (>=60%) | 2/18 (11%) |
| Median time per cover | 1250 ms |
| Median cover thumbnail | 5 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| clean-baseline | The Old Man and the Sea / Ernest Hemingway | The Old Man and the Sea | Ernest Hemingway | exact | yes | 96 | 1402 |
| blurry | Wuthering Heights / Emily Brontë | Wuthering Heights | Emily Bronté | exact | yes | 96 | 1002 |
| very-blurry | Moby Dick / Herman Melville | Moby Dick | Herman Melville | exact | yes | 80 | 1215 |
| angled | Crime and Punishment / Fyodor Dostoevsky | unishment Fyodor Dostoevsky | — | miss | no | 59 | 1326 |
| steep-angle | Anna Karenina / Leo Tolstoy | Karenin, | Leo Tolstoy | miss | yes | 67 | 1465 |
| tilted | Jane Eyre / Charlotte Brontë | Eyre | Jane | miss | no | 40 | 2778 |
| dim-light | Great Expectations / Charles Dickens | Great Expectations | Charles Dickens | exact | yes | 96 | 1003 |
| harsh-glare | The Picture of Dorian Gray / Oscar Wilde | The Pic' ure of Dorian Gray | Oscar | ~0.96 | no | 79 | 1048 |
| low-resolution | Treasure Island / Robert Louis Stevenson | Treasure Island | Robert Louis Stevenson | exact | yes | 96 | 3020 |
| title-only | Frankenstein / Mary Shelley | Frankenstein | — | exact | no | 87 | 2140 |
| author-prominent | The Shining / Stephen King | The Shining Stephen King | — | miss | no | 84 | 822 |
| title-illegible | Slaughterhouse-Five / Kurt Vonnegut | Slaughterhouse- Five | Kurt Vonnegut | exact | yes | 77 | 953 |
| similar-title-a | The Sound and the Fury / William Faulkner | The Sound and the Fury | William Faulkner | exact | yes | 96 | 1113 |
| similar-title-b | The Sound of Things Falling / Juan Gabriel Vásquez | The Sound of Things Falling | Juan Gabriel Vasquez | exact | yes | 96 | 1250 |
| macedonian | Тврдина / Славко Јаневски | Тврдина | Славко Јаневски | exact | yes | 76 | 771 |
| macedonian-latin-author | Пиреј / Petre M. Andreevski | Пиреј | Petre М. Andreevski | exact | yes | 68 | 1012 |
| noisy-blurbs | Never Let Me Go / Kazuo Ishiguro | Never Let Me | Kazuo Ishiguro | ~0.8 | yes | 88 | 2608 |
| unreadable |  /  | — | — | exact | no | 0 | 7430 |
