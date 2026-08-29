import { describe, expect, it } from 'vitest'
import { editDistance, letterRatio, normalise, similarity, tidyTitle, tokens } from './text'

describe('normalise', () => {
  it('strips case, accents and punctuation', () => {
    expect(normalise("The Handmaid's Tale!")).toBe('the handmaid s tale')
    expect(normalise('Fahrenheit 451')).toBe('fahrenheit 451')
    expect(normalise('Émile Zola')).toBe('emile zola')
  })

  it('keeps Cyrillic letters', () => {
    expect(normalise('Мојот Роман')).toBe('мојот роман')
  })
})

describe('editDistance', () => {
  it('counts single-character edits', () => {
    expect(editDistance('dune', 'dune')).toBe(0)
    expect(editDistance('dune', 'dunes')).toBe(1)
    expect(editDistance('', 'dune')).toBe(4)
  })
})

describe('similarity', () => {
  it('is 1 for the same string after normalisation', () => {
    expect(similarity('The Road', 'THE ROAD')).toBe(1)
  })

  it('stays high when OCR mangles a character', () => {
    expect(similarity('Neuromancer', 'Neuromahcer')).toBeGreaterThan(0.85)
  })

  it('stays high when a word is dropped', () => {
    expect(similarity('The Weight of Water', 'Weight of Water')).toBeGreaterThan(0.75)
  })

  it('is low for different books', () => {
    expect(similarity('Iron Harvest', 'Winter Letters')).toBeLessThan(0.4)
  })

  it('handles empty input without dividing by zero', () => {
    expect(similarity('', '')).toBe(1)
    expect(similarity('Dune', '')).toBe(0)
  })
})

describe('letterRatio', () => {
  it('is 1 for words and low for barcodes and prices', () => {
    expect(letterRatio('Dune')).toBe(1)
    expect(letterRatio('9780141187761')).toBe(0)
    expect(letterRatio('$14.99')).toBeLessThan(0.2)
  })
})

describe('tidyTitle', () => {
  it('title-cases shouted text but leaves mixed case alone', () => {
    expect(tidyTitle('THE SILENT ORCHARD')).toBe('The Silent Orchard')
    expect(tidyTitle('The Silent Orchard')).toBe('The Silent Orchard')
  })

  it('keeps small words lowercase except at the start', () => {
    expect(tidyTitle('THE WEIGHT OF WATER')).toBe('The Weight of Water')
  })

  it('collapses stray whitespace', () => {
    expect(tidyTitle('  IRON   HARVEST ')).toBe('Iron Harvest')
  })
})

describe('tokens', () => {
  it('splits on whitespace after normalising', () => {
    expect(tokens('The Silent Orchard')).toEqual(['the', 'silent', 'orchard'])
    expect(tokens('   ')).toEqual([])
  })
})
