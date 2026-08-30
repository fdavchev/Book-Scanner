# OCR accuracy benchmark

Generated 2026-08-30T05:26:58.749Z by `npm run benchmark -- --hard`.

Run against **18 deliberately difficult covers** (`node scripts/make-hard-fixtures.mjs`): blur, angles, glare, dim light, title-only, author-prominent, similar titles and Cyrillic.
Run through the real browser pipeline in headless Chromium.
**Offline only** — no network; these are the on-device numbers.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 8/18 (44%) |
| Title fuzzy match (≥0.7) | 9/18 (50%) |
| Author found | 9/18 (50%) |
| Median time per cover | 322 ms |
| Median cover thumbnail | 5 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| clean-baseline | The Old Man and the Sea / Ernest Hemingway | The Old Man and the Sea | Ernest Hemingway | exact | yes | 96 | 298 |
| blurry | Wuthering Heights / Emily Brontë | Wuthering Heights | Emily Bronté | exact | yes | 87 | 220 |
| very-blurry | Moby Dick / Herman Melville | Moby Dick | Herman Melville | exact | yes | 65 | 949 |
| angled | Crime and Punishment / Fyodor Dostoevsky | Punishment Fyodor Dostoevsky | — | miss | no | 78 | 322 |
| steep-angle | Anna Karenina / Leo Tolstoy | Karenin, | Leo Tolstoy | miss | yes | 64 | 733 |
| tilted | Jane Eyre / Charlotte Brontë | Eyre | Jane | miss | no | 42 | 1114 |
| dim-light | Great Expectations / Charles Dickens | Great Expectations | Charles Dickens | exact | yes | 89 | 187 |
| harsh-glare | The Picture of Dorian Gray / Oscar Wilde | The Pic! ire of Dorian Gray | Oscar | ~0.92 | no | 70 | 523 |
| low-resolution | Treasure Island / Robert Louis Stevenson | Treasure Island | Robert Louis Stevenson | exact | yes | 74 | 278 |
| title-only | Frankenstein / Mary Shelley | Frankenstein | — | exact | no | 86 | 973 |
| author-prominent | The Shining / Stephen King | The Shining Stephen King | — | miss | no | 78 | 180 |
| title-illegible | Slaughterhouse-Five / Kurt Vonnegut | Slaughterhouse- Five | Kurt Vonnegut | exact | yes | 83 | 217 |
| similar-title-a | The Sound and the Fury / William Faulkner | The Sound and the Fury William Faulkner | — | miss | no | 78 | 189 |
| similar-title-b | The Sound of Things Falling / Juan Gabriel Vásquez | The Sound of Things Falling Juan Gabriel Vasquez | — | miss | no | 78 | 214 |
| macedonian | Тврдина / Славко Јаневски | TBpauHa | CiaBko JaHeBCKU | miss | no | 39 | 1052 |
| macedonian-latin-author | Пиреј / Petre M. Andreevski | ITupej | Petre M. Andreevski | miss | yes | 69 | 1014 |
| noisy-blurbs | Never Let Me Go / Kazuo Ishiguro | Never Let Me | Kazuo Ishiguro | ~0.8 | yes | 76 | 290 |
| unreadable |  /  | — | — | exact | no | 0 | 4808 |
