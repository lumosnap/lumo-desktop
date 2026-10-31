import { describe, it, expect } from 'vitest'
import { decodeVectorsFile, encodeVectorsFile, vectorsFileHash } from './vectors-file'

function randomUnit(dims = 768): Float32Array {
  const v = new Float32Array(dims)
  let s = 0
  for (let d = 0; d < dims; d++) {
    // Box-Muller gaussian, plus a shared offset like real embeddings have
    v[d] = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()) + 0.3
    s += v[d] * v[d]
  }
  return v.map((x) => x / Math.sqrt(s))
}

const cos = (a: Float32Array, b: Float32Array): number => {
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return ab / Math.sqrt(aa * bb)
}

describe('LSV1 vectors file', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ serverId: 1000 + i, vec: randomUnit() }))
  const buf = encodeVectorsFile(items, 'siglip2-b16-q8')

  it('writes the header and section sizes', () => {
    const f = decodeVectorsFile(buf)
    expect(f.magic).toBe('LSV1')
    expect(f.version).toBe(1)
    expect(f.dims).toBe(768)
    expect(f.count).toBe(200)
    expect(f.model).toBe('siglip2-b16-q8')
    expect(buf.subarray(28, 64).every((b) => b === 0)).toBe(true)
    expect(buf.length).toBe(64 + 3072 + 3072 + 4 * 200 + 200 * 768)
    expect((64 + 3072 + 3072 + 4 * 200) % 4).toBe(0)
    expect(f.ids).toEqual(items.map((i) => i.serverId))
  })

  it('round-trips with small error', () => {
    const f = decodeVectorsFile(buf)
    const worst = Math.min(...items.map((it, i) => cos(it.vec, f.vectors[i])))
    expect(worst).toBeGreaterThan(0.995)
  })

  it('normalizes unnormalized input', () => {
    const v = randomUnit()
    const f = decodeVectorsFile(encodeVectorsFile([{ serverId: 1, vec: v.map((x) => x * 7) }], 't'))
    expect(cos(v, f.vectors[0])).toBeGreaterThan(0.999)
  })

  it('hashes content deterministically', () => {
    expect(vectorsFileHash(buf)).toMatch(/^[0-9a-f]{32}$/)
    expect(vectorsFileHash(encodeVectorsFile(items, 'siglip2-b16-q8'))).toBe(vectorsFileHash(buf))
  })

  it('handles an empty album', () => {
    const f = decodeVectorsFile(encodeVectorsFile([], 'siglip2-b16-q8'))
    expect(f.count).toBe(0)
    expect(f.vectors).toEqual([])
  })

  it('rejects a model tag over 16 bytes', () => {
    expect(() => encodeVectorsFile([], 'siglip2-base-patch16-224')).toThrow()
  })
})
