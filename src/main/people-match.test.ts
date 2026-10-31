import { describe, it, expect } from 'vitest'
import { bestMatches, classify, FACE_DIM, T_AUTO, T_REVIEW, type FaceVec } from './people-match'

/** Unit vector with cosine `c` to axis `a` (the rest along axis `b`). */
function vec(a: number, c = 1, b = 100): Float32Array {
  const v = new Float32Array(FACE_DIM)
  v[a] = c
  v[b] = Math.sqrt(1 - c * c)
  return v
}
const face = (id: number, v: Float32Array, ref: string | null = null): FaceVec => ({
  id,
  vec: v,
  ref
})
const run = (faces: FaceVec[], rejected = new Set<string>()): ReturnType<typeof classify> =>
  classify(bestMatches(faces, rejected))

describe('people matching', () => {
  it('thresholds: auto ≥ T_AUTO, review in [T_REVIEW, T_AUTO), else no one', () => {
    expect(T_REVIEW).toBeLessThan(T_AUTO)
    const { auto, review } = run([
      face(1, vec(0), 'anna'),
      face(2, vec(0, T_AUTO + 0.01)),
      face(3, vec(0, T_AUTO - 0.01, 101)),
      face(4, vec(0, T_REVIEW + 0.05, 102)),
      face(5, vec(0, T_REVIEW - 0.01, 103))
    ])
    expect([...auto]).toEqual([[2, 'anna']])
    expect(review.get('anna')!.map((r) => r.faceId)).toEqual([3, 4]) // best first
    expect(auto.has(1)).toBe(false) // references are not matched
  })

  it('takes the best person, by max over each person’s references', () => {
    const { auto } = run([
      face(1, vec(0), 'anna'),
      face(2, vec(1), 'ben'),
      face(3, vec(2), 'ben'),
      face(4, vec(2, 0.9, 0)) // 0.44 to anna, 0.9 to ben's second reference
    ])
    expect(auto.get(4)).toBe('ben')
  })

  it('a rejected person is skipped; the next best may still match', () => {
    const v = new Float32Array(FACE_DIM)
    v[0] = 0.8
    v[1] = 0.6 // 0.8 anna, 0.6 ben
    const faces = [face(1, vec(0), 'anna'), face(2, vec(1), 'ben'), face(3, v)]
    expect(run(faces).auto.get(3)).toBe('anna')
    expect(run(faces, new Set(['3:anna'])).auto.get(3)).toBe('ben')
    const none = run(faces, new Set(['3:anna', '3:ben']))
    expect(none.auto.has(3)).toBe(false)
    expect([...none.review.values()].flat()).toEqual([])
  })

  it('a reference added by review pulls in faces the first one missed', () => {
    // side view: 0.42 to the front reference; profile: 0.2 to front, 0.6 to side
    const front = vec(0)
    const side = vec(0, 0.42, 1)
    const profile = new Float32Array(FACE_DIM)
    profile[0] = 0.2
    profile[1] = (0.6 - 0.2 * 0.42) / side[1]
    profile[2] = Math.sqrt(1 - profile[0] ** 2 - profile[1] ** 2)
    const before = run([face(1, front, 'anna'), face(2, side), face(3, profile)])
    expect(before.review.get('anna')!.map((r) => r.faceId)).toEqual([2])
    expect(before.auto.has(3)).toBe(false)
    const after = run([face(1, front, 'anna'), face(2, side, 'anna'), face(3, profile)])
    expect(after.auto.get(3)).toBe('anna')
  })

  it('no references: nothing matches', () => {
    expect(bestMatches([face(1, vec(0)), face(2, vec(0))], new Set()).size).toBe(0)
  })
})
