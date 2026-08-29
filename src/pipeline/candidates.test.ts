import { describe, expect, it } from 'vitest'
import { detect, groupLines, isNoise, looksLikeName, searchQuery } from './candidates'
import type { BBox, OcrLine, OcrResult } from './types'

/** Builds an OCR line the way tesseract reports one, at a given size and position. */
function line(text: string, y: number, height: number, confidence = 90, x = 100): OcrLine {
  const width = text.length * height * 0.55
  const bbox: BBox = { x0: x, y0: y, x1: x + width, y1: y + height }
  return {
    text,
    confidence,
    bbox,
    words: text.split(' ').map((word, i) => ({
      text: word,
      confidence,
      bbox: { x0: x + i * 10, y0: y, x1: x + i * 10 + word.length * height * 0.55, y1: y + height },
    })),
  }
}

function page(lines: OcrLine[], height = 1600, width = 1067): OcrResult {
  return {
    lines,
    text: lines.map((l) => l.text).join('\n'),
    width,
    height,
    meanConfidence: lines.reduce((s, l) => s + l.confidence, 0) / Math.max(1, lines.length),
  }
}

describe('isNoise', () => {
  it.each([
    'A NOVEL',
    'a novel',
    '#1 NEW YORK TIMES BESTSELLER',
    'NATIONAL BESTSELLER',
    'WINNER OF THE BOOKER PRIZE',
    'FROM THE AUTHOR OF IRON HARVEST',
    'SOON TO BE A MAJOR MOTION PICTURE',
    'THE AUTHORIZED EDITION',
    'PENGUIN BOOKS',
    'VINTAGE',
    'ISBN 978-0-14-118776-1',
    '9780141187761',
    '$14.99',
    'www.penguin.com',
    'TRANSLATED BY GREGORY RABASSA',
  ])('rejects %s', (text) => {
    expect(isNoise(text)).toBe(true)
  })

  it.each([
    'The Silent Orchard',
    'DUNE',
    'Salt and Ash',
    'Thirteen Doors',
    'The Handmaid’s Tale',
    'Мојот Прв Роман',
  ])('keeps %s', (text) => {
    expect(isNoise(text)).toBe(false)
  })

  it('keeps a title that merely contains a publisher word', () => {
    expect(isNoise('The Penguin Lessons')).toBe(false)
  })
})

describe('looksLikeName', () => {
  it('scores a two-word name highly', () => {
    expect(looksLikeName('Marta Reyes')).toBeGreaterThan(0.7)
  })

  it('rewards initials', () => {
    expect(looksLikeName('J.R.R. Tolkien')).toBeGreaterThan(looksLikeName('Tolkien'))
  })

  it('penalises function words, which titles have and names do not', () => {
    expect(looksLikeName('The Weight of Water')).toBeLessThan(looksLikeName('Ingrid Solberg'))
  })

  it('ignores a "by" prefix when judging the shape', () => {
    expect(looksLikeName('by Peter Vance')).toBeCloseTo(looksLikeName('Peter Vance'), 5)
  })
})

describe('groupLines', () => {
  it('merges a title wrapped across two lines', () => {
    const candidates = groupLines([line('THE SILENT', 103, 165), line('ORCHARD', 300, 85)], 1600)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].text).toBe('THE SILENT ORCHARD')
  })

  it('keeps the author separate from the title above it', () => {
    const candidates = groupLines(
      [line('BURNING SEASON', 120, 160), line('CLARA NOWAK', 640, 40)],
      1600,
    )
    expect(candidates.map((c) => c.text)).toEqual(['BURNING SEASON', 'CLARA NOWAK'])
  })

  it('does not merge lines sitting in different columns', () => {
    const candidates = groupLines(
      [line('LEFT TITLE', 200, 80, 90, 10), line('RIGHT TITLE', 250, 80, 90, 900)],
      1600,
    )
    expect(candidates).toHaveLength(2)
  })

  it('drops noise lines before grouping', () => {
    const candidates = groupLines(
      [line('A NOVEL', 100, 22), line('IRON HARVEST', 300, 150)],
      1600,
    )
    expect(candidates.map((c) => c.text)).toEqual(['IRON HARVEST'])
  })

  it('drops lines OCR was not confident about', () => {
    expect(groupLines([line('sm0dged', 200, 80, 12)], 1600)).toHaveLength(0)
  })
})

describe('detect', () => {
  it('picks the largest upper text as the title and the smaller name as the author', () => {
    const result = detect(
      page([line('A NOVEL', 100, 22), line('IRON HARVEST', 200, 160), line('D. K. WHITLOCK', 700, 42)]),
    )
    expect(result.title).toBe('Iron Harvest')
    expect(result.author).toBe('D. K. Whitlock')
    expect(result.source).toBe('ocr')
  })

  it('treats a "by" line as the author even when it is large', () => {
    const result = detect(page([line('SALT AND ASH', 300, 150), line('by Peter Vance', 700, 60)]))
    expect(result.title).toBe('Salt and Ash')
    expect(result.author).toBe('Peter Vance')
  })

  it('finds a title printed at the bottom of the cover', () => {
    const result = detect(
      page([line('MIDNIGHT SIGNAL', 1200, 150), line('RAY OKONKWO', 1450, 40)]),
    )
    expect(result.title).toBe('Midnight Signal')
    expect(result.author).toBe('Ray Okonkwo')
  })

  it('leaves mixed-case titles alone and title-cases shouted ones', () => {
    expect(detect(page([line('Winter Letters', 200, 150)])).title).toBe('Winter Letters')
    expect(detect(page([line('WINTER LETTERS', 200, 150)])).title).toBe('Winter Letters')
  })

  it('offers the runners-up as alternates', () => {
    const result = detect(
      page([line('THE QUIET MACHINE', 200, 150), line('YUKI TANAKA', 700, 44), line('SEQUEL', 900, 60)]),
    )
    expect(result.titleAlternates.length).toBeGreaterThan(0)
    expect(result.titleAlternates).not.toContain(result.title)
  })

  it('returns an empty detection and zero confidence when nothing is readable', () => {
    const result = detect(page([]))
    expect(result).toMatchObject({ title: '', author: '', confidence: 0 })
    expect(result.reason).toMatch(/no text/i)
  })

  it('explains itself in words a person can read', () => {
    const result = detect(page([line('PAPER TIGERS', 150, 160), line('MIGUEL SANTOS', 700, 40)]))
    expect(result.reason).toMatch(/largest text/)
    expect(result.reason).toMatch(/upper/)
  })

  it('scores a clean single-candidate cover higher than an ambiguous one', () => {
    const clean = detect(page([line('THIRTEEN DOORS', 200, 160), line('S. J. FERREIRA', 700, 40)]))
    const ambiguous = detect(page([line('FIRST OPTION', 200, 150), line('SECOND OPTION', 500, 148)]))
    expect(clean.confidence).toBeGreaterThan(ambiguous.confidence)
  })
})

describe('searchQuery', () => {
  it('uses the detection when there is one', () => {
    const detection = detect(page([line('IRON HARVEST', 200, 160), line('D. K. WHITLOCK', 700, 42)]))
    expect(searchQuery(page([]), detection)).toBe('Iron Harvest D. K. Whitlock')
  })

  it('falls back to the raw OCR text when detection found nothing', () => {
    const result = page([line('some stray words here', 100, 30)])
    const empty = { ...detect(page([])), title: '', author: '' }
    expect(searchQuery(result, empty)).toContain('stray')
  })
})
