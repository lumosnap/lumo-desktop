import { describe, it, expect } from 'vitest'
import {
  faceCrop,
  withPeople,
  byPosition,
  nextToName,
  matchPeople,
  decisions,
  gridMove,
  type Box
} from './people'
import { withTags } from './tags'

describe('faceCrop', () => {
  it('centres a face in the middle of a square photo', () => {
    // face 0.2 wide at the centre; square 0.36 of the photo
    expect(faceCrop([0.4, 0.4, 0.2, 0.2], 1)).toEqual({
      backgroundSize: '277.78% 277.78%',
      backgroundPosition: '50% 50%'
    })
  })

  it('keeps a face at the corner inside the photo', () => {
    expect(faceCrop([0, 0, 0.1, 0.1], 1).backgroundPosition).toBe('0% 0%')
    expect(faceCrop([0.9, 0.9, 0.1, 0.1], 1).backgroundPosition).toBe('100% 100%')
  })

  it('uses the photo width for a landscape photo', () => {
    // 3:2 photo, face 0.1 of the width (0.15 units) by 0.2 of the height: the height wins
    const c = faceCrop([0.45, 0.4, 0.1, 0.2], 1.5)
    expect(c.backgroundSize).toBe('416.67% 277.78%')
    expect(c.backgroundPosition).toBe('50% 50%')
  })

  it('never crops wider than the photo is tall', () => {
    expect(faceCrop([0.1, 0.1, 0.8, 0.8], 1.5)).toEqual({
      backgroundSize: '150% 100%',
      backgroundPosition: '50% 50%'
    })
  })

  it('falls back to 3:2 when the photo size is unknown', () => {
    expect(faceCrop([0.45, 0.4, 0.1, 0.2], 0)).toEqual(faceCrop([0.45, 0.4, 0.1, 0.2], 1.5))
  })
})

describe('withPeople', () => {
  const imgs = [
    { id: 1, people: ['a', 'b'], tags: ['stage'] },
    { id: 2, people: ['a'], tags: [] },
    { id: 3, people: [], tags: ['stage'] },
    { id: 4, tags: ['stage'] }
  ]
  const ids = (xs: { id: number }[]): number[] => xs.map((x) => x.id)

  it('keeps all photos with no person chosen', () => {
    expect(withPeople(imgs, [])).toBe(imgs)
  })

  it('needs every chosen person in the photo', () => {
    expect(ids(withPeople(imgs, ['a']))).toEqual([1, 2])
    expect(ids(withPeople(imgs, ['a', 'b']))).toEqual([1])
    expect(withPeople(imgs, ['z'])).toEqual([])
  })

  it('composes with tags (AND)', () => {
    expect(ids(withTags(withPeople(imgs, ['a']), ['stage']))).toEqual([1])
  })
})

describe('byPosition and nextToName', () => {
  const f = (x: number, source: 'ref' | 'auto' | null): { box: Box; source: typeof source } => ({
    box: [x, 0.2, 0.1, 0.1],
    source
  })

  it('orders faces left to right', () => {
    expect(byPosition([f(0.6, null), f(0.1, null), f(0.3, null)]).map((x) => x.box[0])).toEqual([
      0.1, 0.3, 0.6
    ])
  })

  it('reads a two-row group photo row by row', () => {
    const at = (x: number, y: number): { box: Box } => ({ box: [x, y, 0.1, 0.15] })
    const faces = [at(0.6, 0.12), at(0.2, 0.5), at(0.1, 0.1), at(0.5, 0.52), at(0.35, 0.08)]
    expect(byPosition(faces).map((f) => f.box.slice(0, 2))).toEqual([
      [0.1, 0.1],
      [0.35, 0.08],
      [0.6, 0.12],
      [0.2, 0.5],
      [0.5, 0.52]
    ])
  })

  it('skips faces already named and wraps round', () => {
    const faces = [f(0.1, null), f(0.3, 'ref'), f(0.5, 'auto'), f(0.7, 'ref')]
    expect(nextToName(faces, 0)).toBe(2)
    expect(nextToName(faces, 2)).toBe(0)
    expect(nextToName(faces, -1)).toBe(0)
  })

  it('says -1 when every face is named', () => {
    expect(nextToName([f(0.1, 'ref'), f(0.3, 'ref')], 0)).toBe(-1)
    expect(nextToName([], -1)).toBe(-1)
  })
})

describe('matchPeople', () => {
  const ps = [{ name: 'Anjali Menon' }, { name: 'Rahul Nair' }, { name: 'Ammachi' }]

  it('lists everyone for an empty query', () => {
    expect(matchPeople(ps, '  ')).toEqual({ matches: ps, exact: null })
  })

  it('matches the start of any word, ignoring case', () => {
    expect(matchPeople(ps, 'a').matches.map((p) => p.name)).toEqual(['Anjali Menon', 'Ammachi'])
    expect(matchPeople(ps, 'NAI').matches.map((p) => p.name)).toEqual(['Rahul Nair'])
    expect(matchPeople(ps, 'rahul n').matches.map((p) => p.name)).toEqual(['Rahul Nair'])
  })

  it('finds the exact name, so a typed name joins the person', () => {
    expect(matchPeople(ps, ' rahul nair ').exact).toBe(ps[1])
    expect(matchPeople(ps, 'Rahul').exact).toBeNull()
  })
})

describe('decisions and gridMove', () => {
  it('answers yes for every face not marked no', () => {
    expect(decisions([{ faceId: 1 }, { faceId: 2 }, { faceId: 3 }], new Set([2]))).toEqual([
      { faceId: 1, yes: true },
      { faceId: 2, yes: false },
      { faceId: 3, yes: true }
    ])
  })

  it('moves through a grid and stops at its edges', () => {
    expect(gridMove(0, 'ArrowRight', 4, 10)).toBe(1)
    expect(gridMove(1, 'ArrowDown', 4, 10)).toBe(5)
    expect(gridMove(8, 'ArrowDown', 4, 10)).toBe(8)
    expect(gridMove(0, 'ArrowLeft', 4, 10)).toBe(0)
    expect(gridMove(3, 'x', 4, 10)).toBe(3)
  })
})
