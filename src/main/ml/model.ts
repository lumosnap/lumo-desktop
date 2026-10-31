/**
 * SigLIP2 vision encoder download: fetched once into userData, then used offline forever.
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
  statSync,
  unlinkSync
} from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createLogger, getErrorMessage } from '../logger'

const log = createLogger('Model')

export const MODEL_ID = 'siglip2-base-patch16-224-q8'
const URL =
  'https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/ba1f3b0843f24bc5417d38e19c37b287d719b2f4/onnx/vision_model_quantized.onnx'
const SHA256 = '5f2b401c1a4fc095702a5d45348e17ad46c4f87064085365b43c6e8eaa5c0070'
const SIZE = 94553333
const ATTEMPTS = 5

export const modelPath = (): string =>
  join(app.getPath('userData'), 'models', 'siglip2-q8', 'vision_model_quantized.onnx')

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function download(dest: string, part: string): Promise<void> {
  const have = existsSync(part) ? statSync(part).size : 0
  if (have < SIZE) {
    const res = await fetch(URL, { headers: have ? { Range: `bytes=${have}-` } : {} })
    if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`)
    const append = res.status === 206 // 200 = server ignored the range, start over
    log.info(`Downloading model${append ? ` (resuming at ${have} bytes)` : ''}`)
    await pipeline(
      Readable.fromWeb(res.body as import('stream/web').ReadableStream),
      createWriteStream(part, { flags: append ? 'a' : 'w' })
    )
  }
  if (statSync(part).size !== SIZE || (await sha256(part)) !== SHA256) {
    unlinkSync(part)
    throw new Error('downloaded model failed verification')
  }
  renameSync(part, dest)
}

let ready: Promise<string> | null = null

/** Path to the verified model, downloading it first if needed. Concurrent callers share one download. */
export function ensureModel(): Promise<string> {
  ready ??= (async () => {
    const dest = modelPath()
    if (existsSync(dest)) return dest // verified before the rename
    mkdirSync(join(dest, '..'), { recursive: true })
    for (let attempt = 1; ; attempt++) {
      try {
        await download(dest, `${dest}.part`)
        log.info('Model ready')
        return dest
      } catch (error) {
        if (attempt >= ATTEMPTS) throw error
        log.warn(`Model download attempt ${attempt} failed:`, getErrorMessage(error))
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      }
    }
  })().catch((error) => {
    ready = null // let a later call retry
    throw error
  })
  return ready
}
