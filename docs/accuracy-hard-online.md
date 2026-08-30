# OCR accuracy benchmark

Generated 2026-08-30T05:28:53.283Z by `npm run benchmark -- --hard --lookup`.

Run against **18 deliberately difficult covers** (`node scripts/make-hard-fixtures.mjs`): blur, angles, glare, dim light, title-only, author-prominent, similar titles and Cyrillic.
Run through the real browser pipeline in headless Chromium.
**Open Library lookup on** — OCR evidence corroborated against the catalogue.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 14/18 (78%) |
| Title fuzzy match (≥0.7) | 14/18 (78%) |
| Author found | 15/18 (83%) |
| Median time per cover | 1208 ms |
| Median cover thumbnail | 5 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| clean-baseline | The Old Man and the Sea / Ernest Hemingway | The Old Man and the Sea | Ernest Hemingway | exact | yes | 98 | 1208 |
| blurry | Wuthering Heights / Emily Brontë | Wuthering Heights | Emily Brontë | exact | yes | 98 | 546 |
| very-blurry | Moby Dick / Herman Melville | Moby Dick | Herman Melville | exact | yes | 98 | 1284 |
| angled | Crime and Punishment / Fyodor Dostoevsky | Crime and Punishment | Fyodor Dostoevsky | exact | yes | 89 | 606 |
| steep-angle | Anna Karenina / Leo Tolstoy | Karenin, | Leo Tolstoy | miss | yes | 64 | 3510 |
| tilted | Jane Eyre / Charlotte Brontë | Jane Eyre | Charlotte Brontë | exact | yes | 84 | 1407 |
| dim-light | Great Expectations / Charles Dickens | Great Expectations | Charles Dickens | exact | yes | 98 | 598 |
| harsh-glare | The Picture of Dorian Gray / Oscar Wilde | The Pic! ire of Dorian Gray | Oscar | ~0.92 | no | 70 | 8859 |
| low-resolution | Treasure Island / Robert Louis Stevenson | Treasure Island | Robert Louis Stevenson | exact | yes | 98 | 877 |
| title-only | Frankenstein / Mary Shelley | Frankenstein | Mary Shelley | exact | yes | 83 | 1988 |
| author-prominent | The Shining / Stephen King | The Shining | Stephen King | exact | yes | 98 | 565 |
| title-illegible | Slaughterhouse-Five / Kurt Vonnegut | Slaughterhouse-Five | Kurt Vonnegut | exact | yes | 98 | 918 |
| similar-title-a | The Sound and the Fury / William Faulkner | The Sound and the Fury | William Faulkner | exact | yes | 98 | 702 |
| similar-title-b | The Sound of Things Falling / Juan Gabriel Vásquez | The sound of things falling | Juan Gabriel Vásquez | exact | yes | 98 | 768 |
| macedonian | Тврдина / Славко Јаневски | TBpauHa | CiaBko JaHeBCKU | miss | no | 39 | 4191 |
| macedonian-latin-author | Пиреј / Petre M. Andreevski | Odbrani raskazi od Petre M. Andreevski | Petre M. Andreevski | miss | yes | 85 | 1791 |
| noisy-blurbs | Never Let Me Go / Kazuo Ishiguro | Never Let Me Go | Kazuo Ishiguro | exact | yes | 98 | 713 |
| unreadable |  /  | — | — | exact | no | 0 | 4733 |
