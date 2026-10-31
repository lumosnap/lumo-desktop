import { describe, it, expect } from 'vitest'
import { selectTags, tagProbabilities, TAG_THRESHOLDS } from './select'
import { TAGS } from './vocabulary'
import vectors from './tag-vectors.json'

describe('selectTags', () => {
  const thresholds = { ...TAG_THRESHOLDS, events: 0.2, people: 0.1, settings: 0.5 }

  it('applies per-category thresholds, sorts by score and caps the count', () => {
    const probs = new Map([
      ['haldi', 0.25], // events, passes 0.2
      ['sangeet', 0.15], // events, below 0.2
      ['outdoor', 0.45], // settings, below 0.5
      ['night', 0.9],
      ['bride', 0.6],
      ['not-a-tag', 0.99] // unknown slugs are ignored
    ])
    expect(selectTags(probs, thresholds)).toEqual([
      { tag: 'night', score: 0.9 },
      { tag: 'bride', score: 0.6 },
      { tag: 'haldi', score: 0.25 }
    ])
    expect(selectTags(probs, thresholds, 2).map((t) => t.tag)).toEqual(['night', 'bride'])
    expect(selectTags(new Map(), thresholds)).toEqual([])
  })

  it('threshold is inclusive', () => {
    expect(selectTags(new Map([['night', 0.5]]), thresholds)).toHaveLength(1)
  })
})

describe('tag vectors', () => {
  it('cover exactly the vocabulary', () => {
    expect(vectors.tags.map((t) => t.slug)).toEqual(TAGS.map((t) => t.slug))
    expect(new Set(TAGS.map((t) => t.slug)).size).toBe(TAGS.length)
  })

  it('a prompt vector used as the image embedding scores its own tag highest', () => {
    const b = Buffer.from(vectors.tags[0].vecs[0], 'base64')
    const probs = tagProbabilities(new Float32Array(b.buffer, b.byteOffset, vectors.dim))
    const best = [...probs].sort((x, y) => y[1] - x[1])[0]
    expect(best[0]).toBe(vectors.tags[0].slug)
  })
})
