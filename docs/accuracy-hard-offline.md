# OCR accuracy benchmark

Generated 2026-08-30T11:12:45.685Z by `npm run benchmark -- --hard`.

Run against **18 deliberately difficult covers** (`node scripts/make-hard-fixtures.mjs`): blur, angles, glare, dim light, title-only, author-prominent, similar titles and Cyrillic.
Run through the real browser pipeline in headless Chromium.
**Offline only** — no network; these are the on-device numbers.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 11/18 (61%) |
| Title fuzzy match (≥0.7) | 12/18 (67%) |
| Author found | 11/18 (61%) |
| Median time per cover | 279 ms |
| Median cover thumbnail | 5 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| clean-baseline | The Old Man and the Sea / Ernest Hemingway | The Old Man and the Sea | Ernest Hemingway | exact | yes | 96 | 279 |
| blurry | Wuthering Heights / Emily Brontë | Wuthering Heights | Emily Bronté | exact | yes | 93 | 209 |
| very-blurry | Moby Dick / Herman Melville | Moby Dick | Herman Melville | exact | yes | 80 | 953 |
| angled | Crime and Punishment / Fyodor Dostoevsky | Punishment Fyodor Dostoevsky | — | miss | no | 47 | 333 |
| steep-angle | Anna Karenina / Leo Tolstoy | Karenin, | Leo Tolstoy | miss | yes | 55 | 557 |
| tilted | Jane Eyre / Charlotte Brontë | Eyre | Jane | miss | no | 40 | 1211 |
| dim-light | Great Expectations / Charles Dickens | Great Expectations | Charles Dickens | exact | yes | 94 | 188 |
| harsh-glare | The Picture of Dorian Gray / Oscar Wilde | The Pic! ire of Dorian Gray | Oscar 1 | ~0.92 | no | 77 | 584 |
| low-resolution | Treasure Island / Robert Louis Stevenson | Treasure Island | Robert Louis Stevenson | exact | yes | 96 | 277 |
| title-only | Frankenstein / Mary Shelley | Frankenstein | — | exact | no | 86 | 980 |
| author-prominent | The Shining / Stephen King | The Shining Stephen King | — | miss | no | 78 | 188 |
| title-illegible | Slaughterhouse-Five / Kurt Vonnegut | Slaughterhouse- Five | Kurt Vonnegut | exact | yes | 93 | 198 |
| similar-title-a | The Sound and the Fury / William Faulkner | The Sound and the Fury William Faulkner | — | miss | no | 78 | 208 |
| similar-title-b | The Sound of Things Falling / Juan Gabriel Vásquez | The Sound of Things Falling | Juan Gabriel Vasquez | exact | yes | 96 | 207 |
| macedonian | Тврдина / Славко Јаневски | Тврдина | Славко Јаневски | exact | yes | 76 | 202 |
| macedonian-latin-author | Пиреј / Petre M. Andreevski | Пиреј | Petre М. Andreevski | exact | yes | 65 | 209 |
| noisy-blurbs | Never Let Me Go / Kazuo Ishiguro | Never Let Me | Kazuo Ishiguro | ~0.8 | yes | 80 | 285 |
| unreadable |  /  | — | — | exact | no | 0 | 5395 |
