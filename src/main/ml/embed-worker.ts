/**
 * utilityProcess entry: SigLIP2 vision encoder. argv[2] = model path.
 * In:  { id, paths: string[] }
 * Out: { id, vectors: (Float32Array | null)[], error?: string } (null = that image failed to decode)
 */
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'

const SIZE = 224
// rescale (1/255) then normalize (mean 0.5, std 0.5), rounded to f32 at each step exactly like
// transformers.js: the q8 model is sensitive enough that 1-ulp input drift costs ~1.5% cosine.
const LUT = Float32Array.from({ length: 256 }, (_, x) => {
  const r = Math.fround(0.00392156862745098 * x)
  return Math.fround((r - 0.5) / 0.5)
})
const modelPath = process.argv[2]
let session: Promise<ort.InferenceSession> | null = null

// Two ORT threads on a low-priority process; sharp gets one so it doesn't fan out either
sharp.concurrency(1)

function getSession(): Promise<ort.InferenceSession> {
  session ??= ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all'
  })
  return session
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

async function embed(s: ort.InferenceSession, path: string): Promise<Float32Array> {
  const pixels = await preprocess(path)
  const res = await s.run({ pixel_values: new ort.Tensor('float32', pixels, [1, 3, SIZE, SIZE]) })
  const v = res.pooler_output.data as Float32Array
  const norm = Math.hypot(...v)
  return v.map((x) => x / norm)
}

// Batch size 1 per run: benchmarked faster and ~200 MB lighter than batch 8 on CPU
process.parentPort?.on('message', async (e) => {
  const { id, paths } = e.data as { id: number; paths: string[] }
  try {
    const s = await getSession()
    const vectors: Array<Float32Array | null> = []
    for (const p of paths) vectors.push(await embed(s, p).catch(() => null))
    process.parentPort.postMessage({ id, vectors })
  } catch (error) {
    session = null
    process.parentPort.postMessage({ id, error: (error as Error).message ?? String(error) })
  }
})
