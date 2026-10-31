/**
 * LSV1: an album's image embeddings as one small file for the gallery's in-browser search.
 * Little-endian, uncompressed, every section 4-byte aligned:
 *   header 64 B  magic "LSV1", u16 version = 1, u16 dims, u32 count, 16 B ASCII model tag, 36 B zero
 *   mean         dims x f32   album mean of the L2-normalized vectors
 *   scale        dims x f32   max_i |x_i[d] - mean[d]| / 127
 *   ids          count x u32  server image ids
 *   codes        count x dims x i8   round((x - mean) / scale), clamped to [-127, 127]
 * ~7.7 MB per 10k photos; recall@10 ~99.5% vs f32.
 */
import { createHash } from 'crypto'

export const VECTORS_DIMS = 768
/** Tag for the embeddings in image_embeddings (TAG_MODEL, SigLIP2 B/16 q8 vision encoder). */
export const VECTORS_MODEL_TAG = 'siglip2-b16-q8'
const HEADER = 64

export function encodeVectorsFile(
  items: Array<{ serverId: number; vec: Float32Array }>,
  model: string,
  dims = VECTORS_DIMS
): Buffer {
  if (Buffer.byteLength(model, 'ascii') > 16) throw new Error(`Model tag too long: ${model}`)
  const n = items.length
  const unit = items.map(({ vec }) => {
    if (vec.length !== dims) throw new Error(`Expected ${dims} dims, got ${vec.length}`)
    let s = 0
    for (let d = 0; d < dims; d++) s += vec[d] * vec[d]
    const inv = s > 0 ? 1 / Math.sqrt(s) : 0
    return vec.map((x) => x * inv)
  })

  const buf = Buffer.alloc(HEADER + 8 * dims + 4 * n + n * dims)
  buf.write('LSV1', 0, 'ascii')
  buf.writeUInt16LE(1, 4)
  buf.writeUInt16LE(dims, 6)
  buf.writeUInt32LE(n, 8)
  buf.write(model, 12, 'ascii')

  const mean = new Float32Array(buf.buffer, buf.byteOffset + HEADER, dims)
  const scale = new Float32Array(buf.buffer, buf.byteOffset + HEADER + 4 * dims, dims)
  const ids = new Uint32Array(buf.buffer, buf.byteOffset + HEADER + 8 * dims, n)
  const codes = new Int8Array(buf.buffer, buf.byteOffset + HEADER + 8 * dims + 4 * n, n * dims)
  // ponytail: typed-array views are host-endian; every Electron target (x64, arm64) is LE

  const sum = new Float64Array(dims)
  for (const v of unit) for (let d = 0; d < dims; d++) sum[d] += v[d]
  for (let d = 0; d < dims; d++) mean[d] = n ? sum[d] / n : 0
  const maxDev = new Float64Array(dims)
  for (const v of unit) {
    for (let d = 0; d < dims; d++) maxDev[d] = Math.max(maxDev[d], Math.abs(v[d] - mean[d]))
  }
  for (let d = 0; d < dims; d++) scale[d] = maxDev[d] > 0 ? maxDev[d] / 127 : 1e-12

  unit.forEach((v, i) => {
    ids[i] = items[i].serverId
    for (let d = 0; d < dims; d++) {
      const q = Math.round((v[d] - mean[d]) / scale[d])
      codes[i * dims + d] = Math.max(-127, Math.min(127, q))
    }
  })
  return buf
}

/** Content name: first 32 hex chars of the sha256 of the bytes. */
export function vectorsFileHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 32)
}

/** Test helper: parse a file and dequantize its vectors. */
export function decodeVectorsFile(buf: Buffer): {
  magic: string
  version: number
  dims: number
  count: number
  model: string
  ids: number[]
  vectors: Float32Array[]
} {
  const dims = buf.readUInt16LE(6)
  const count = buf.readUInt32LE(8)
  const f32 = (off: number): number => buf.readFloatLE(off)
  const meanOff = HEADER
  const scaleOff = HEADER + 4 * dims
  const idsOff = HEADER + 8 * dims
  const codesOff = idsOff + 4 * count
  const ids = Array.from({ length: count }, (_, i) => buf.readUInt32LE(idsOff + 4 * i))
  const vectors = ids.map((_, i) => {
    const v = new Float32Array(dims)
    for (let d = 0; d < dims; d++) {
      v[d] = f32(meanOff + 4 * d) + buf.readInt8(codesOff + i * dims + d) * f32(scaleOff + 4 * d)
    }
    return v
  })
  return {
    magic: buf.toString('ascii', 0, 4),
    version: buf.readUInt16LE(4),
    dims,
    count,
    model: buf.toString('ascii', 12, 28).replace(/\0+$/, ''),
    ids,
    vectors
  }
}
