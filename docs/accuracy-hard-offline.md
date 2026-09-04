# OCR accuracy benchmark

Generated 2026-09-04T21:11:52.201Z by `npm run benchmark -- --hard`.

Run against **18 deliberately difficult covers** (`node scripts/make-hard-fixtures.mjs`): blur, angles, glare, dim light, title-only, author-prominent, similar titles and Cyrillic.
Run through the real browser pipeline in headless Chromium.
**Read on the device** by tesseract.js.
**Offline only** — no network; these are the on-device numbers.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 11/18 (61%) |
| Title fuzzy match (≥0.7) | 12/18 (67%) |
| Author found | 12/18 (67%) |
| Confidently wrong (>=60%) | 3/18 (17%) |
| Median time per cover | 856 ms |
| Median cover thumbnail | 5 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| clean-baseline | The Old Man and the Sea / Ernest Hemingway | The Old Man and the Sea | Ernest Hemingway | exact | yes | 96 | 1013 |
| blurry | Wuthering Heights / Emily Brontë | Wuthering Heights | Emily Bronté | exact | yes | 96 | 783 |
| very-blurry | Moby Dick / Herman Melville | Moby Dick | Herman Melville | exact | yes | 80 | 598 |
| angled | Crime and Punishment / Fyodor Dostoevsky | unishment Fyodor Dostoevsky | — | miss | no | 59 | 790 |
| steep-angle | Anna Karenina / Leo Tolstoy | Karenin, | Leo Tolstoy | miss | yes | 66 | 1438 |
| tilted | Jane Eyre / Charlotte Brontë | Eyre | Jane | miss | no | 47 | 1991 |
| dim-light | Great Expectations / Charles Dickens | Great Expectations | Charles Dickens | exact | yes | 96 | 776 |
| harsh-glare | The Picture of Dorian Gray / Oscar Wilde | The Pic' ure of Dorian Gray | Oscar | ~0.96 | no | 75 | 822 |
| low-resolution | Treasure Island / Robert Louis Stevenson | Treasure Island | Robert Louis Stevenson | exact | yes | 96 | 745 |
| title-only | Frankenstein / Mary Shelley | Frankenstein | — | exact | no | 87 | 1659 |
| author-prominent | The Shining / Stephen King | The Shining Stephen King | — | miss | no | 84 | 643 |
| title-illegible | Slaughterhouse-Five / Kurt Vonnegut | Slaughterhouse- Five | Kurt Vonnegut | exact | yes | 77 | 762 |
| similar-title-a | The Sound and the Fury / William Faulkner | The Sound and the Fury | William Faulkner | exact | yes | 96 | 856 |
| similar-title-b | The Sound of Things Falling / Juan Gabriel Vásquez | The Sound of Things Falling | Juan Gabriel Vasquez | exact | yes | 96 | 969 |
| macedonian | Тврдина / Славко Јаневски | Тврдина | Славко Јаневсеки | exact | yes | 57 | 750 |
| macedonian-latin-author | Пиреј / Petre M. Andreevski | ITupej | Petre M. Andreevski | miss | yes | 66 | 2419 |
| noisy-blurbs | Never Let Me Go / Kazuo Ishiguro | Never Let Me | Kazuo Ishiguro | ~0.8 | yes | 88 | 2026 |
| unreadable |  /  | — | — | exact | no | 0 | 5665 |
