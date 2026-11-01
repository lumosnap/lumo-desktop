/**
 * utilityProcess entry for all on-device ML. Sessions load lazily, so an album without People
 * never loads the face models.
 * In:  { id, op: 'embed', model, paths } → result: (Float32Array | null)[] (null = undecodable)
 *      { id, op: 'faces', models: { yunet, sface }, path } → result: WorkerFace[]
 * Out: { id, result } or { id, error, badModel? } (badModel = path of a model that failed to load)
 */
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import { ALIGN_SIZE, YUNET_SIZE, alignFace, decodeYuNet, type WorkerFace } from './faces'

const SIZE = 224
// rescale (1/255) then normalize (mean 0.5, std 0.5), rounded to f32 at each step exactly like
// transformers.js: the q8 model is sensitive enough that 1-ulp input drift costs ~1.5% cosine.
const LUT = Float32Array.from({ length: 256 }, (_, x) => {
  const r = Math.fround(0.00392156862745098 * x)
  return Math.fround((r - 0.5) / 0.5)
})
const sessions = new Map<string, Promise<ort.InferenceSession>>()

// Two ORT threads on a low-priority process; sharp gets one so it doesn't fan out either
sharp.concurrency(1)

function getSession(path: string): Promise<ort.InferenceSession> {
  let s = sessions.get(path)
  if (!s) {
    s = ort.InferenceSession.create(path, {
      executionProviders: ['cpu'],
      intraOpNumThreads: 2,
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
      logSeverityLevel: 3 // YuNet's initializer-as-input warnings are noise
    }).catch((error) => {
      sessions.delete(path)
      throw Object.assign(new Error((error as Error).message ?? String(error)), { badModel: path })
    })
    sessions.set(path, s)
  }
  return s
}

/**
 * Same as transformers.js SiglipImageProcessor in Node (the benchmark path): decode + EXIF
 * rotate, squash to 224x224 with sharp's bilinear affine (no antialias, no crop), then
 * normalize via LUT in CHW order.
 */
export async function preprocess(path: string): Promise<Float32Array> {
  const src = await sharp(path)
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = src.info
  const { data } = await sharp(src.data, { raw: { width, height, channels: 3 } })
    .affine([SIZE / width, 0, 0, SIZE / height], { interpolator: 'bilinear' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (data.length !== SIZE * SIZE * 3) throw new Error(`unexpected resize output ${data.length}`)
  const plane = SIZE * SIZE
  const out = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    out[i] = LUT[data[i * 3]]
    out[plane + i] = LUT[data[i * 3 + 1]]
    out[2 * plane + i] = LUT[data[i * 3 + 2]]
  }
  return out
}

function l2(v: Float32Array): Float32Array {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}

async function embed(s: ort.InferenceSession, path: string): Promise<Float32Array> {
  const pixels = await preprocess(path)
  const res = await s.run({ pixel_values: new ort.Tensor('float32', pixels, [1, 3, SIZE, SIZE]) })
  return l2(res.pooler_output.data as Float32Array)
}

const LONG_EDGE = 1024
const MIN_SCORE = 0.8
const MIN_FACE_PX = 40 // on the 1024 image

/** HWC uint8 → CHW float32, 0..255, optionally swapping RGB → BGR. */
function toChw(rgb: Uint8Array, w: number, h: number, bgr: boolean): Float32Array {
  const plane = w * h
  const out = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    out[i] = rgb[i * 3 + (bgr ? 2 : 0)]
    out[plane + i] = rgb[i * 3 + 1]
    out[2 * plane + i] = rgb[i * 3 + (bgr ? 0 : 2)]
  }
  return out
}

/**
 * Detect + embed faces in one photo. The original is EXIF-rotated and resized so its long edge
 * is 1024; YuNet's input is fixed at 640x640, so it sees that image scaled into the top-left
 * corner (zero padding), and boxes/landmarks are mapped back. Alignment and SFace use the
 * 1024 image.
 */
export async function faces(
  models: { yunet: string; sface: string },
  path: string
): Promise<WorkerFace[]> {
  const img = await sharp(path)
    .rotate()
    .resize(LONG_EDGE, LONG_EDGE, { fit: 'inside' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = img.info
  const rgb = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length)
  const scale = YUNET_SIZE / Math.max(W, H)
  const dw = Math.max(1, Math.round(W * scale))
  const dh = Math.max(1, Math.round(H * scale))
  const det = await sharp(img.data, { raw: { width: W, height: H, channels: 3 } })
    .resize(dw, dh, { fit: 'fill' })
    .extend({ right: YUNET_SIZE - dw, bottom: YUNET_SIZE - dh, background: '#000' })
    .raw()
    .toBuffer()
  const yunet = await getSession(models.yunet)
  const out = await yunet.run({
    input: new ort.Tensor('float32', toChw(det, YUNET_SIZE, YUNET_SIZE, true), [
      1,
      3,
      YUNET_SIZE,
      YUNET_SIZE
    ])
  })
  const sx = W / dw
  const sy = H / dh
  const found = decodeYuNet(out as never, MIN_SCORE)
    .map((f) => ({
      score: f.score,
      box: [f.box[0] * sx, f.box[1] * sy, f.box[2] * sx, f.box[3] * sy],
      landmarks: f.landmarks.map((v, i) => v * (i % 2 ? sy : sx))
    }))
    .filter((f) => Math.min(f.box[2], f.box[3]) >= MIN_FACE_PX)

  if (found.length === 0) return []
  const sface = await getSession(models.sface)
  const result: WorkerFace[] = []
  for (const f of found) {
    const aligned = alignFace(rgb, W, H, f.landmarks)
    const res = await sface.run({
      data: new ort.Tensor('float32', toChw(aligned, ALIGN_SIZE, ALIGN_SIZE, false), [
        1,
        3,
        ALIGN_SIZE,
        ALIGN_SIZE
      ])
    })
    const x0 = Math.max(0, f.box[0])
    const y0 = Math.max(0, f.box[1])
    const x1 = Math.min(W, f.box[0] + f.box[2])
    const y1 = Math.min(H, f.box[1] + f.box[3])
    result.push({
      box: [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H],
      score: f.score,
      landmarks: f.landmarks.map((v, i) => v / (i % 2 ? H : W)),
      vec: l2(res.fc1.data as Float32Array)
    })
  }
  return result
}

type Msg =
  | { id: number; op: 'embed'; model: string; paths: string[] }
  | { id: number; op: 'faces'; models: { yunet: string; sface: string }; path: string }

// Batch size 1 per run: benchmarked faster and ~200 MB lighter than batch 8 on CPU
async function handle(msg: Msg): Promise<unknown> {
  if (msg.op === 'embed') {
    const s = await getSession(msg.model)
    const vectors: Array<Float32Array | null> = []
    for (const p of msg.paths) vectors.push(await embed(s, p).catch(() => null))
    return vectors
  }
  return faces(msg.models, msg.path)
}

process.parentPort?.on('message', async (e) => {
  const msg = e.data as Msg
  try {
    process.parentPort.postMessage({ id: msg.id, result: await handle(msg) })
  } catch (error) {
    process.parentPort.postMessage({
      id: msg.id,
      error: (error as Error).message ?? String(error),
      badModel: (error as { badModel?: string }).badModel
    })
  }
})
