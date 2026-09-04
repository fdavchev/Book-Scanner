# OCR accuracy benchmark

Generated 2026-09-04T21:28:52.974Z by `npm run benchmark -- --hard --lookup`.

Run against **18 deliberately difficult covers** (`node scripts/make-hard-fixtures.mjs`): blur, angles, glare, dim light, title-only, author-prominent, similar titles and Cyrillic.
Run through the real browser pipeline in headless Chromium.
**Read on the device** by tesseract.js.
**Open Library lookup on** — OCR evidence corroborated against the catalogue.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 14/18 (78%) |
| Title fuzzy match (≥0.7) | 14/18 (78%) |
| Author found | 15/18 (83%) |
| Confidently wrong (>=60%) | 2/18 (11%) |
| Median time per cover | 2461 ms |
| Median cover thumbnail | 5 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| clean-baseline | The Old Man and the Sea / Ernest Hemingway | The Old Man and the Sea | Ernest Hemingway | exact | yes | 98 | 2642 |
| blurry | Wuthering Heights / Emily Brontë | Wuthering Heights | Emily Brontë | exact | yes | 98 | 1226 |
| very-blurry | Moby Dick / Herman Melville | Moby Dick | Herman Melville | exact | yes | 98 | 1255 |
| angled | Crime and Punishment / Fyodor Dostoevsky | Crime and Punishment | Fyodor Dostoevsky | exact | yes | 89 | 2120 |
| steep-angle | Anna Karenina / Leo Tolstoy | Karenin, | Leo Tolstoy | miss | yes | 66 | 4354 |
| tilted | Jane Eyre / Charlotte Brontë | Eyre | Jane | miss | no | 47 | 5753 |
| dim-light | Great Expectations / Charles Dickens | Great Expectations | Charles Dickens | exact | yes | 98 | 1297 |
| harsh-glare | The Picture of Dorian Gray / Oscar Wilde | The Pic' ure of Dorian Gray | Oscar | ~0.96 | no | 75 | 4514 |
| low-resolution | Treasure Island / Robert Louis Stevenson | Treasure Island | Robert Louis Stevenson | exact | yes | 98 | 1724 |
| title-only | Frankenstein / Mary Shelley | Frankenstein | Mary Shelley | exact | yes | 83 | 2118 |
| author-prominent | The Shining / Stephen King | The Shining | Stephen King | exact | yes | 98 | 1103 |
| title-illegible | Slaughterhouse-Five / Kurt Vonnegut | Slaughterhouse-Five | Kurt Vonnegut | exact | yes | 98 | 1237 |
| similar-title-a | The Sound and the Fury / William Faulkner | The Sound and the Fury | William Faulkner | exact | yes | 98 | 2461 |
| similar-title-b | The Sound of Things Falling / Juan Gabriel Vásquez | The sound of things falling | Juan Gabriel Vásquez | exact | yes | 98 | 1567 |
| macedonian | Тврдина / Славко Јаневски | Тврдина | Славко Јаневсеки | exact | yes | 57 | 3669 |
| macedonian-latin-author | Пиреј / Petre M. Andreevski | Odbrani raskazi od Petre M. Andreevski | Petre M. Andreevski | miss | yes | 85 | 3552 |
| noisy-blurbs | Never Let Me Go / Kazuo Ishiguro | Never Let Me Go | Kazuo Ishiguro | exact | yes | 98 | 2637 |
| unreadable |  /  | — | — | exact | no | 0 | 6200 |
