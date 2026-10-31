import { describe, it, expect } from 'vitest'
import { selectAlbumTags, tagLogits, effectiveTags, MAX_TAGS } from './select'
import { TAGS, TAG_PACKS, EVENT_TYPE_LABELS } from './vocabulary'
import vectors from './tag-vectors.json'
import prior from './tag-prior.json'

/** n photos; `set(i)` gives photo i's logits (unlisted tags absent). */
const album = (n: number, set: (i: number) => Record<string, number>): Array<Map<string, number>> =>
  Array.from({ length: n }, (_, i) => new Map(Object.entries(set(i))))
const tagsOf = (sel: Array<Array<{ tag: string }>>): string[][] =>
  sel.map((p) => p.map((t) => t.tag))

describe('selectAlbumTags', () => {
  it('keeps a tag only where it stands out from the album mean and clears the floor', () => {
    const a = album(10, (i) => ({ bride: i === 0 ? -1.5 : -4, venue: i === 1 ? -6.5 : -12 }))
    // bride: +2.25 over the mean on photo 0 only. venue: +4.95 on photo 1 but below the -6.2 floor
    expect(tagsOf(selectAlbumTags(a))).toEqual([['bride'], ...Array(9).fill([])])
  })

  it('needs a near-certain logit for unreliable ritual tags', () => {
    const a = (top: number): Array<Map<string, number>> =>
      album(10, (i) => ({ thali: i === 0 ? top : -8 }))
    expect(selectAlbumTags(a(1))[0]).toEqual([]) // +8.1 over the mean, but only p~0.73
    expect(tagsOf(selectAlbumTags(a(2)))[0]).toEqual(['thali'])
  })

  it('keeps a tag shared by the whole album only when strongly scored', () => {
    expect(tagsOf(selectAlbumTags(album(10, () => ({ bride: -0.5 }))))).toEqual(
      Array(10).fill(['bride'])
    )
    // 7/10 photos clear the margin, but weakly: dropped as not distinctive
    const weak = album(10, (i) => ({ candid: i < 7 ? -4 : -20 }))
    expect(tagsOf(selectAlbumTags(weak)).flat()).toEqual([])
  })

  it('tiny albums are scored against the global prior', () => {
    const p = prior.logits.groom
    expect(tagsOf(selectAlbumTags(album(1, () => ({ groom: p + 2.5 }))))).toEqual([['groom']])
    expect(tagsOf(selectAlbumTags(album(1, () => ({ groom: p + 1 }))))).toEqual([[]])
  })

  it('caps, orders by margin, honours the enabled set and ignores unknown slugs', () => {
    const people = ['bride', 'groom', 'couple', 'family', 'kids', 'elders', 'friends']
    const a = album(10, (i) =>
      i === 0
        ? Object.fromEntries([...people.map((t, k) => [t, -4 + k / 10]), ['not-a-tag', 5]])
        : Object.fromEntries(people.map((t) => [t, -8]))
    )
    const [first] = tagsOf(selectAlbumTags(a))
    expect(first).toHaveLength(MAX_TAGS)
    expect(first[0]).toBe('friends')
    expect(tagsOf(selectAlbumTags(a, new Set(['bride', 'groom'])))[0]).toEqual(['groom', 'bride'])
  })
})

describe('effectiveTags', () => {
  it('puts manual adds first and drops manual removes from AI tags', () => {
    expect(
      effectiveTags(
        ['bride', 'portrait', 'indoor'],
        [
          { tag: 'my-custom', action: 'add' },
          { tag: 'portrait', action: 'remove' },
          { tag: 'bride', action: 'add' }
        ]
      )
    ).toEqual(['my-custom', 'bride', 'indoor'])
    expect(effectiveTags([], [{ tag: 'x', action: 'remove' }])).toEqual([])
  })
})

describe('tag assets', () => {
  it('vectors and prior cover exactly the vocabulary', () => {
    const slugs = TAGS.map((t) => t.slug)
    expect(vectors.tags.map((t) => t.slug)).toEqual(slugs)
    expect(Object.keys(prior.logits)).toEqual(slugs)
    expect(prior.model).toBe(vectors.model)
    expect(new Set(slugs).size).toBe(TAGS.length)
  })

  it('every pack only names vocabulary slugs; wedding is the original 60, general is all', () => {
    const slugs = TAGS.map((t) => t.slug)
    expect(Object.keys(TAG_PACKS)).toEqual(Object.keys(EVENT_TYPE_LABELS))
    for (const pack of Object.values(TAG_PACKS)) {
      expect(pack.filter((s) => !slugs.includes(s))).toEqual([])
      expect(new Set(pack).size).toBe(pack.length)
    }
    expect(TAG_PACKS.wedding).toEqual(slugs.slice(0, 60))
    expect(TAG_PACKS.general).toEqual(slugs)
  })

  it('a prompt vector used as the image embedding scores its own tag highest', () => {
    const b = Buffer.from(vectors.tags[0].vecs[0], 'base64')
    const logits = tagLogits(new Float32Array(b.buffer, b.byteOffset, vectors.dim))
    const best = [...logits].sort((x, y) => y[1] - x[1])[0]
    expect(best[0]).toBe(vectors.tags[0].slug)
  })
})
