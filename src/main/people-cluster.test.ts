import { describe, it, expect } from 'vitest'
import { assignPeople, clusterFaces, FACE_DIM, type FaceIn } from './people-cluster'

/** Unit vector mostly along `axis`, nudged along `noiseAxis`. */
function vec(axis: number, noise = 0, noiseAxis = 100): Float32Array {
  const v = new Float32Array(FACE_DIM)
  v[axis] = 1
  v[noiseAxis] = noise
  const n = Math.hypot(1, noise)
  return v.map((x) => x / n)
}
const flat = (vs: Float32Array[]): Float32Array => {
  const out = new Float32Array(vs.length * FACE_DIM)
  vs.forEach((v, i) => out.set(v, i * FACE_DIM))
  return out
}
const groups = (labels: Int32Array): number[][] => {
  const m = new Map<number, number[]>()
  labels.forEach((l, i) => m.set(l, [...(m.get(l) ?? []), i]))
  return [...m.values()]
}

describe('clusterFaces', () => {
  it('groups the same identity and keeps others apart', () => {
    const vs = [vec(0, 0.1), vec(0, 0.3, 101), vec(1, 0.2), vec(0), vec(1), vec(2)]
    expect(groups(clusterFaces(flat(vs), 0.45))).toEqual([[0, 1, 3], [2, 4], [5]])
  })

  it('does not chain: A~B and B~C but A≁C stays split (average, not single linkage)', () => {
    // a·b = c·b ≈ 0.7, a·c = 0: single linkage would merge all three
    const a = vec(0)
    const c = vec(1)
    const b = new Float32Array(FACE_DIM)
    b[0] = b[1] = Math.SQRT1_2
    const g = groups(clusterFaces(flat([a, b, c]), 0.45))
    expect(g).toHaveLength(2)
  })

  it('handles empty and single input', () => {
    expect([...clusterFaces(new Float32Array(0))]).toEqual([])
    expect([...clusterFaces(vec(0))]).toEqual([0])
  })
})

describe('assignPeople', () => {
  let n = 0
  const newId = (): string => `new${n++}`
  const f = (
    id: number,
    axis: number,
    person: string | null = null,
    override?: string | null
  ): FaceIn => ({
    id,
    vec: vec(axis),
    person,
    ...(override !== undefined ? { override } : {})
  })

  it('keeps people stable across re-clusters, even with new labels', () => {
    const faces = [f(1, 0, 'bride'), f(2, 0, 'bride'), f(3, 1, 'groom'), f(4, 1, 'groom'), f(5, 0)]
    // fresh labels: arbitrary numbers, face 5 joins the bride's cluster
    const labels = new Map([
      [1, 9],
      [2, 9],
      [5, 9],
      [3, 7],
      [4, 7]
    ])
    const { assign, created } = assignPeople(
      faces,
      labels,
      [
        { id: 'bride', curated: true },
        { id: 'groom', curated: false }
      ],
      newId
    )
    expect(created).toEqual([])
    expect([...assign]).toEqual([
      [1, 'bride'],
      [2, 'bride'],
      [3, 'groom'],
      [4, 'groom'],
      [5, 'bride']
    ])
  })

  it('overrides win; singletons stay unassigned; new clusters get new people', () => {
    const faces = [
      f(1, 0, null, 'groom'), // pinned to groom although it looks like axis 0
      f(2, 0),
      f(3, 0),
      f(4, 0, null, null), // "no one"
      f(5, 2), // lone face
      f(6, 1, 'groom'),
      f(7, 1, 'groom')
    ]
    const labels = new Map([
      [2, 0],
      [3, 0],
      [5, 5],
      [6, 6],
      [7, 6]
    ])
    const { assign, created } = assignPeople(faces, labels, [{ id: 'groom', curated: true }], newId)
    expect(created).toHaveLength(1)
    expect(assign.get(1)).toBe('groom')
    expect(assign.get(2)).toBe(created[0])
    expect(assign.get(3)).toBe(created[0])
    expect(assign.get(4)).toBeNull()
    expect(assign.get(5)).toBeNull()
    expect(assign.get(6)).toBe('groom')
  })

  it('a named person can take several clusters (bride split in two); an unnamed one only one', () => {
    const faces = [f(1, 0, 'bride'), f(2, 0, 'bride'), f(3, 0), f(4, 0), f(5, 0), f(6, 0)]
    const labels = new Map([
      [1, 1],
      [2, 1],
      [3, 3],
      [4, 3],
      [5, 5],
      [6, 5]
    ])
    const named = assignPeople(faces, labels, [{ id: 'bride', curated: true }], newId)
    expect(new Set(named.assign.values())).toEqual(new Set(['bride']))
    const unnamed = assignPeople(faces, labels, [{ id: 'bride', curated: false }], newId)
    expect(new Set(unnamed.assign.values()).size).toBe(3)
  })

  it('merged faces (overrides) pull new matching faces to the merged person', () => {
    const faces = [f(1, 0, 'bride', 'bride'), f(2, 0, 'bride', 'bride'), f(3, 0)]
    const { assign } = assignPeople(
      faces,
      new Map([[3, 3]]),
      [{ id: 'bride', curated: true }],
      newId
    )
    expect(assign.get(3)).toBe('bride')
  })
})
