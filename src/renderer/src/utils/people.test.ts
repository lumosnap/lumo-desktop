import { describe, it, expect } from 'vitest'
import { faceCrop, withPeople } from './people'
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
