import { describe, it, expect } from 'vitest'
import {
  ALIGN_SIZE,
  ALIGN_TEMPLATE,
  alignFace,
  decodeYuNet,
  frontalness,
  nms,
  similarityTransform,
  type DetectedFace
} from './faces'

const apply = ([a, b, tx, ty]: number[], x: number, y: number): [number, number] => [
  a * x - b * y + tx,
  b * x + a * y + ty
]

describe('similarityTransform', () => {
  it('recovers a known rotation + scale + translation exactly', () => {
    const theta = 0.4
    const s = 0.5
    const truth = [s * Math.cos(theta), s * Math.sin(theta), 12, -7]
    const src = [10, 20, 60, 25, 35, 50, 15, 80, 55, 85]
    const dst = src.flatMap((_, i) => (i % 2 ? [] : apply(truth, src[i], src[i + 1])))
    const m = similarityTransform(src, dst)
    m.forEach((v, i) => expect(v).toBeCloseTo(truth[i], 10))
  })

  it('maps template onto itself as identity', () => {
    const m = similarityTransform(ALIGN_TEMPLATE, ALIGN_TEMPLATE)
    m.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 0][i], 10))
  })
})

describe('alignFace', () => {
  it('samples the source at the inverse-mapped position (bilinear, exact on a linear ramp)', () => {
    // Source: R = x, G = y. Landmarks = template scaled ×2, rotated 90°, shifted by (150, 20)
    const W = 256
    const H = 256
    const rgb = new Uint8Array(W * H * 3)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        rgb[(y * W + x) * 3] = x
        rgb[(y * W + x) * 3 + 1] = y
      }
    const toSrc = (u: number, v: number): [number, number] => [150 - 2 * v, 20 + 2 * u]
    const lm = ALIGN_TEMPLATE.flatMap((_, i) =>
      i % 2 ? [] : toSrc(ALIGN_TEMPLATE[i], ALIGN_TEMPLATE[i + 1])
    )
    const out = alignFace(rgb, W, H, lm)
    expect(out.length).toBe(ALIGN_SIZE * ALIGN_SIZE * 3)
    for (const [u, v] of [
      [0, 0],
      [56, 56],
      [100, 30],
      [111, 70]
    ]) {
      const [x, y] = toSrc(u, v)
      const i = (v * ALIGN_SIZE + u) * 3
      expect(Math.abs(out[i] - x)).toBeLessThanOrEqual(1)
      expect(Math.abs(out[i + 1] - y)).toBeLessThanOrEqual(1)
    }
  })

  it('fills outside the photo with black', () => {
    const rgb = new Uint8Array(10 * 10 * 3).fill(200)
    const out = alignFace(rgb, 10, 10, ALIGN_TEMPLATE) // template lives mostly outside 10x10
    expect(out[(100 * ALIGN_SIZE + 100) * 3]).toBe(0)
    expect(out[0]).toBe(200)
  })
})

describe('decodeYuNet', () => {
  it('decodes one anchor at stride 16 like OpenCV and drops low scores', () => {
    const heads: Record<string, { data: Float32Array }> = {}
    for (const s of [8, 16, 32]) {
      const n = (640 / s) ** 2
      heads[`cls_${s}`] = { data: new Float32Array(n) }
      heads[`obj_${s}`] = { data: new Float32Array(n) }
      heads[`bbox_${s}`] = { data: new Float32Array(n * 4) }
      heads[`kps_${s}`] = { data: new Float32Array(n * 10) }
    }
    const cols = 40
    const idx = 3 * cols + 5 // row 3, col 5
    heads.cls_16.data[idx] = 0.9
    heads.obj_16.data[idx] = 1.2 // clamped to 1
    heads.bbox_16.data.set([0.5, 0.25, Math.log(4), Math.log(5)], idx * 4)
    heads.kps_16.data.set([0, 0, 1, 0, 0.5, 0.5, 0, 1, 1, 1], idx * 10)
    heads.cls_8.data[0] = 0.5 // score sqrt(0.5·0) = 0
    const [face, ...rest] = decodeYuNet(heads, 0.8)
    expect(rest).toEqual([])
    expect(face.score).toBeCloseTo(Math.sqrt(0.9))
    // cx = (5 + 0.5)·16 = 88, cy = (3 + 0.25)·16 = 52, w = 64, h = 80
    face.box.forEach((v, i) => expect(v).toBeCloseTo([56, 12, 64, 80][i]))
    expect(face.landmarks.slice(0, 4)).toEqual([80, 48, 96, 48])
  })

  it('nms keeps the best of overlapping boxes', () => {
    const f = (x: number, score: number): DetectedFace => ({
      box: [x, 0, 10, 10],
      score,
      landmarks: []
    })
    expect(nms([f(0, 0.8), f(1, 0.9), f(50, 0.85)], 0.3).map((x) => x.score)).toEqual([0.9, 0.85])
  })
})

describe('frontalness', () => {
  it('is 1 with the nose centred between the eyes, 0 in profile', () => {
    expect(frontalness([10, 0, 30, 0, 20, 10])).toBe(1)
    expect(frontalness([10, 0, 30, 0, 30, 10])).toBe(0)
  })
})
