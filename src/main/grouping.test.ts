import { describe, it, expect } from 'vitest'
import { groupImages, hamming, type GroupingInput } from './grouping'

const BASE = Date.UTC(2026, 5, 1, 10, 0, 0)
const SAME = '0f0f0f0f0f0f0f0f'
const NEAR = '0f0f0f0f0f0f0f00' // 4 bits off SAME
const FAR = 'f0f0f0f0f0f0f0f0' // 64 bits off SAME

let seq = 0
function img(t: number | null, over: Partial<GroupingInput> = {}): GroupingInput {
  seq++
  return {
    id: seq,
    filename: `IMG_${String(seq).padStart(4, '0')}.jpg`,
    uploadOrder: seq,
    hash: `hash${String(seq).padStart(4, '0')}abcdef`,
    capturedAt: t === null ? null : BASE + t,
    cameraId: 'cam-A',
    phash: SAME,
    sharpness: 10,
    rating: null,
    ...over
  }
}

describe('hamming', () => {
  it('counts differing bits', () => {
    expect(hamming(SAME, SAME)).toBe(0)
    expect(hamming(SAME, NEAR)).toBe(4)
    expect(hamming(SAME, FAR)).toBe(64)
  })
})

describe('bursts', () => {
  it('chains close, similar frames and picks the sharpest as cover', () => {
    const a = img(0)
    const b = img(800, { phash: NEAR, sharpness: 50 })
    const c = img(1600)
    const lone = img(10_000)
    const g = groupImages([lone, c, a, b]) // input order must not matter

    expect(g.get(a.id)!.burstId).toBe('b-' + a.hash!.slice(0, 12))
    expect(g.get(b.id)!.burstId).toBe(g.get(a.id)!.burstId)
    expect(g.get(c.id)!.burstId).toBe(g.get(a.id)!.burstId)
    expect(g.get(b.id)!.isBurstCover).toBe(true)
    expect(g.get(a.id)!.isBurstCover).toBe(false)
    expect(g.get(lone.id)).toMatchObject({ burstId: null, isBurstCover: false })
  })

  it('prefers rating over sharpness, then first frame', () => {
    const a = img(0)
    const b = img(500, { sharpness: 99 })
    const c = img(1000, { rating: 3 })
    expect(groupImages([a, b, c]).get(c.id)!.isBurstCover).toBe(true)

    const d = img(0)
    const e = img(500)
    expect(groupImages([d, e]).get(d.id)!.isBurstCover).toBe(true)
  })

  it('breaks on time gap, dissimilar frame, and keeps cameras separate', () => {
    const a = img(0)
    const late = img(3500)
    const different = img(4000, { phash: FAR })
    const otherCam = img(100, { cameraId: 'cam-B' })
    const g = groupImages([a, late, different, otherCam])
    for (const x of [a, late, different, otherCam]) expect(g.get(x.id)!.burstId).toBeNull()
  })

  it('chains to the previous frame of the same camera across interleaved cameras', () => {
    const a1 = img(0)
    const b1 = img(100, { cameraId: 'cam-B', phash: FAR })
    const a2 = img(200)
    const g = groupImages([a1, b1, a2])
    expect(g.get(a2.id)!.burstId).toBe(g.get(a1.id)!.burstId)
    expect(g.get(a1.id)!.burstId).not.toBeNull()
    expect(g.get(b1.id)!.burstId).toBeNull()
  })
})

describe('moments', () => {
  it('splits on gaps far above the local baseline', () => {
    const morning = Array.from({ length: 12 }, (_, i) => img(i * 20_000, { phash: null }))
    const evening = Array.from({ length: 12 }, (_, i) =>
      img(6 * 3600_000 + i * 20_000, { phash: null })
    )
    const g = groupImages([...morning, ...evening])
    const m = g.get(morning[0].id)!.momentId
    const e = g.get(evening[0].id)!.momentId
    expect(m).toBe('m-' + morning[0].hash!.slice(0, 12))
    expect(e).not.toBe(m)
    for (const x of morning) expect(g.get(x.id)!.momentId).toBe(m)
    for (const x of evening) expect(g.get(x.id)!.momentId).toBe(e)
  })

  it('does not split below the 2-minute floor even if relatively large', () => {
    const frames = [img(0), img(1000), img(2000), img(92_000), img(93_000)]
    const g = groupImages(frames.map((f) => ({ ...f, phash: null })))
    expect(new Set(frames.map((f) => g.get(f.id)!.momentId)).size).toBe(1)
  })

  it('puts untimed images in the moment of their upload-order neighbour', () => {
    const lead = img(null)
    const a = Array.from({ length: 5 }, (_, i) => img(i * 10_000, { phash: null }))
    const mid = img(null)
    const b = Array.from({ length: 5 }, (_, i) => img(8 * 3600_000 + i * 10_000, { phash: null }))
    const g = groupImages([lead, ...a, mid, ...b])
    expect(g.get(lead.id)!.momentId).toBe(g.get(a[0].id)!.momentId)
    expect(g.get(mid.id)!.momentId).toBe(g.get(a[4].id)!.momentId)
    expect(g.get(b[0].id)!.momentId).not.toBe(g.get(a[0].id)!.momentId)
  })

  it('leaves albums without capture times ungrouped', () => {
    const g = groupImages([img(null), img(null)])
    for (const v of g.values())
      expect(v).toEqual({ burstId: null, isBurstCover: false, momentId: null })
  })
})
