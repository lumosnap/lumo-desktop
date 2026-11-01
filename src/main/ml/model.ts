/**
 * Model downloads (SigLIP2 vision encoder, YuNet + SFace faces): fetched once into userData, then used offline forever.
 * Resumes a partial download with a Range request, verifies the pinned sha256, then renames.
 */
import { app } from 'electron'
import { createHash } from 'crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync
} from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createLogger, getErrorMessage } from '../logger'

const log = createLogger('Model')

export const MODEL_ID = 'siglip2-base-patch16-224-q8'
// LSV1 header tag per model (16 ASCII max). The gallery's bundled tag file uses this exact string.
// Keyed by the MODEL_ID literal: changing MODEL_ID without adding its tag fails the typecheck.
const VECTORS_TAGS = { 'siglip2-base-patch16-224-q8': 'siglip2-b16-q8' } as const
/** Tag for the embeddings in image_embeddings (TAG_MODEL, SigLIP2 B/16 q8 vision encoder). */
export const VECTORS_MODEL_TAG: string = VECTORS_TAGS[MODEL_ID]

interface ModelFile {
  path: string // relative to userData/models
  url: string // pinned revision
  sha256: string
  size: number
}

const SIGLIP: ModelFile = {
  path: 'siglip2-q8/vision_model_quantized.onnx',
  url: 'https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/ba1f3b0843f24bc5417d38e19c37b287d719b2f4/onnx/vision_model_quantized.onnx',
  sha256: '5f2b401c1a4fc095702a5d45348e17ad46c4f87064085365b43c6e8eaa5c0070',
  size: 94553333
}
// OpenCV Zoo face models. YuNet: MIT (Shiqi Yu). SFace: Apache-2.0. Never InsightFace (non-commercial).
const YUNET: ModelFile = {
  path: 'faces/face_detection_yunet_2023mar.onnx',
  url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/3cc26e7f1014a5ee5d74a42acee58bafc9d0a310/face_detection_yunet_2023mar.onnx',
  sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
  size: 232589
}
// fp32, not the int8 build: ~8x faster on CPU (int8 conv kernels are slow in ORT) and full precision
export const SFACE: ModelFile = {
  path: 'faces/face_recognition_sface_2021dec.onnx',
  url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/3d7082438a6e4551e840c9b2bb60b71e8da4b524/face_recognition_sface_2021dec.onnx',
  sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  size: 38696353
}
const ATTEMPTS = 5
const STALL_MS = 60_000 // no bytes for this long: abort, the next attempt resumes

const fullPath = (m: ModelFile): string => join(app.getPath('userData'), 'models', m.path)

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function download(m: ModelFile, dest: string, part: string): Promise<void> {
  const have = existsSync(part) ? statSync(part).size : 0
  if (have < m.size) {
    const abort = new AbortController()
    let stall: ReturnType<typeof setTimeout> | undefined
    const kick = (): void => {
      clearTimeout(stall)
      stall = setTimeout(() => abort.abort(new Error('download stalled')), STALL_MS)
    }
    kick()
    try {
      const res = await fetch(m.url, {
        headers: have ? { Range: `bytes=${have}-` } : {},
        signal: abort.signal
      })
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`)
      const append = res.status === 206 // 200 = server ignored the range, start over
      log.info(`Downloading ${m.path}${append ? ` (resuming at ${have} bytes)` : ''}`)
      const body = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
      body.on('data', kick)
      await pipeline(body, createWriteStream(part, { flags: append ? 'a' : 'w' }))
    } finally {
      clearTimeout(stall)
    }
  }
  if (statSync(part).size !== m.size || (await sha256(part)) !== m.sha256) {
    unlinkSync(part)
    throw new Error(`downloaded ${m.path} failed verification`)
  }
  renameSync(part, dest)
}

const ready = new Map<string, Promise<string>>()

/** Path to the verified file, downloading it first if needed. Concurrent callers share one download. */
function ensureFile(m: ModelFile): Promise<string> {
  let p = ready.get(m.path)
  if (p) return p
  p = (async () => {
    const dest = fullPath(m)
    if (existsSync(dest)) return dest // verified before the rename
    mkdirSync(join(dest, '..'), { recursive: true })
    for (let attempt = 1; ; attempt++) {
      try {
        await download(m, dest, `${dest}.part`)
        log.info(`${m.path} ready`)
        return dest
      } catch (error) {
        if (attempt >= ATTEMPTS) throw error
        log.warn(`${m.path} download attempt ${attempt} failed:`, getErrorMessage(error))
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      }
    }
  })().catch((error) => {
    ready.delete(m.path) // let a later call retry
    throw error
  })
  ready.set(m.path, p)
  return p
}

/**
 * A model file failed to load. Delete it for re-download only if it no longer matches its pinned
 * hash: OOM, an unsupported CPU or an AV lock also fail the load, and re-downloading won't fix those.
 */
export async function discardModel(path: string): Promise<void> {
  for (const m of [SIGLIP, YUNET, SFACE]) {
    if (fullPath(m) !== path) continue
    const intact = await sha256(path).then(
      (h) => h === m.sha256,
      () => existsSync(path) // unreadable (AV lock): keep it; gone: let ensure* fetch it again
    )
    if (intact) {
      log.warn(`${m.path} failed to load but is intact on disk, keeping it`)
      continue
    }
    ready.delete(m.path)
    rmSync(path, { force: true })
    log.warn(`${m.path} failed to load, deleted for re-download`)
  }
}

export const modelPath = (): string => fullPath(SIGLIP)
export const ensureModel = (): Promise<string> => ensureFile(SIGLIP)
export const ensureFaceModels = async (): Promise<{ yunet: string; sface: string }> => ({
  yunet: await ensureFile(YUNET),
  sface: await ensureFile(SFACE)
})
