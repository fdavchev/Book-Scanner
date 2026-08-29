import { describe, expect, it } from 'vitest'
import { detectionSimilarity, groupDetections, mergeItems, splitItem, type ScannedImage } from './group'
import type { Detection } from './types'

function detection(title: string, author = '', confidence = 70): Detection {
  return {
    title,
    author,
    confidence,
    reason: 'largest text',
    titleAlternates: [],
    authorAlternates: [],
    source: 'ocr',
  }
}

function image(id: string, det: Detection): ScannedImage {
  return { id, blob: new Blob(['x']), detection: det, ocrText: det.title }
}

describe('detectionSimilarity', () => {
  it('is 1 for the same book read twice', () => {
    expect(detectionSimilarity(detection('Dune', 'Frank Herbert'), detection('Dune', 'Frank Herbert'))).toBe(1)
  })

  it('stays high across a small OCR difference', () => {
    expect(
      detectionSimilarity(detection('Iron Harvest', 'D. K. Whitlock'), detection('Iron Harvest', 'D K Whitlock')),
    ).toBeGreaterThan(0.9)
  })

  it('does not treat two blank authors as agreement', () => {
    expect(detectionSimilarity(detection('Dune'), detection('Neuromancer'))).toBeLessThan(0.4)
  })
})

describe('groupDetections', () => {
  it('gives one card per photo by default', () => {
    const items = groupDetections([
      image('a', detection('Dune', 'Frank Herbert')),
      image('b', detection('Neuromancer', 'William Gibson')),
    ])
    expect(items).toHaveLength(2)
  })

  it('merges two photos of the same book into one card', () => {
    const items = groupDetections([
      image('a', detection('Iron Harvest', 'D. K. Whitlock')),
      image('b', detection('Iron Harvest', 'D. K. Whitlock')),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].images).toHaveLength(2)
  })

  it('keeps the reading it was most confident about', () => {
    const items = groupDetections([
      image('a', detection('Iron Harvst', 'D. K. Whitlock', 40)),
      image('b', detection('Iron Harvest', 'D. K. Whitlock', 88)),
    ])
    expect(items[0].title).toBe('Iron Harvest')
    expect(items[0].confidence).toBe(88)
  })

  it('never merges cards that failed to read a title', () => {
    const items = groupDetections([image('a', detection('')), image('b', detection(''))])
    expect(items).toHaveLength(2)
  })
})

describe('splitItem and mergeItems', () => {
  it('splits a merged card back into one per photo', () => {
    const [item] = groupDetections([
      image('a', detection('Dune', 'Frank Herbert')),
      image('b', detection('Dune', 'Frank Herbert')),
    ])
    expect(splitItem(item)).toHaveLength(2)
  })

  it('leaves a single-photo card alone when split', () => {
    const [item] = groupDetections([image('a', detection('Dune'))])
    expect(splitItem(item)).toEqual([item])
  })

  it('merges cards while keeping the first card’s edited title', () => {
    const items = groupDetections([
      image('a', detection('Dune', 'Frank Herbert')),
      image('b', detection('Neuromancer', 'William Gibson')),
    ])
    const merged = mergeItems([{ ...items[0], title: 'Dune (corrected)' }, items[1]])
    expect(merged.title).toBe('Dune (corrected)')
    expect(merged.images).toHaveLength(2)
  })
})
