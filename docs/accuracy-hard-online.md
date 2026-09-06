# OCR accuracy benchmark

Generated 2026-09-06T08:31:53.184Z by `npm run benchmark -- --hard --lookup`.

Run against **18 deliberately difficult covers** (`node scripts/make-hard-fixtures.mjs`): blur, angles, glare, dim light, title-only, author-prominent, similar titles and Cyrillic.
Run through the real browser pipeline in headless Chromium.
**Read on the device** by tesseract.js.
**Open Library lookup on** — OCR evidence corroborated against the catalogue.
preprocess → tesseract.js (eng) → candidate detection. No Open Library lookup — these
are the OCR-only numbers.

**Clean set:** covers as published, no degradation applied.

| Metric | Result |
|---|---|
| Title exact match | 16/18 (89%) |
| Title fuzzy match (≥0.7) | 16/18 (89%) |
| Author found | 16/18 (89%) |
| Confidently wrong (>=60%) | 1/18 (6%) |
| Median time per cover | 3184 ms |
| Median cover thumbnail | 5 KB |

## Per-cover results

| Cover | Expected | Detected title | Detected author | Title | Author | Conf. | ms |
|---|---|---|---|:--:|:--:|--:|--:|
| clean-baseline | The Old Man and the Sea / Ernest Hemingway | The Old Man and the Sea | Ernest Hemingway | exact | yes | 98 | 4526 |
| blurry | Wuthering Heights / Emily Brontë | Wuthering Heights | Emily Brontë | exact | yes | 98 | 2538 |
| very-blurry | Moby Dick / Herman Melville | Moby Dick | Herman Melville | exact | yes | 98 | 1518 |
| angled | Crime and Punishment / Fyodor Dostoevsky | Crime and Punishment | Fyodor Dostoevsky | exact | yes | 89 | 3184 |
| steep-angle | Anna Karenina / Leo Tolstoy | Karenin, | Leo Tolstoy | miss | yes | 67 | 5691 |
| tilted | Jane Eyre / Charlotte Brontë | Jane Eyre | Charlotte Brontë | exact | yes | 84 | 3493 |
| dim-light | Great Expectations / Charles Dickens | Great Expectations | Charles Dickens | exact | yes | 98 | 1648 |
| harsh-glare | The Picture of Dorian Gray / Oscar Wilde | The Pic' ure of Dorian Gray | Oscar | ~0.96 | no | 79 | 5391 |
| low-resolution | Treasure Island / Robert Louis Stevenson | Treasure Island | Robert Louis Stevenson | exact | yes | 98 | 3713 |
| title-only | Frankenstein / Mary Shelley | Frankenstein | Mary Shelley | exact | yes | 83 | 2721 |
| author-prominent | The Shining / Stephen King | The Shining | Stephen King | exact | yes | 98 | 1428 |
| title-illegible | Slaughterhouse-Five / Kurt Vonnegut | Slaughterhouse-Five | Kurt Vonnegut | exact | yes | 98 | 1244 |
| similar-title-a | The Sound and the Fury / William Faulkner | The Sound and the Fury | William Faulkner | exact | yes | 98 | 1721 |
| similar-title-b | The Sound of Things Falling / Juan Gabriel Vásquez | The sound of things falling | Juan Gabriel Vásquez | exact | yes | 98 | 1719 |
| macedonian | Тврдина / Славко Јаневски | Тврдина | Славко Јаневски | exact | yes | 76 | 3819 |
| macedonian-latin-author | Пиреј / Petre M. Andreevski | Пиреј | Petre M. Andreevski | exact | yes | 45 | 3949 |
| noisy-blurbs | Never Let Me Go / Kazuo Ishiguro | Never Let Me Go | Kazuo Ishiguro | exact | yes | 98 | 3183 |
| unreadable |  /  | — | — | exact | no | 0 | 7338 |
