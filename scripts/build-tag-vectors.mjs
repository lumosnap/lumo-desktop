/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS dev script */
// Embeds every tag prompt with the SigLIP2 text tower and writes src/main/tags/tag-vectors.json.
// Dev-only: transformers.js is NOT an app dependency, so point at any install of it.
//
//   node scripts/build-tag-vectors.mjs <dir with node_modules/@huggingface/transformers> [hf cache dir]
//
// Needs Node >= 23.6 (imports vocabulary.ts directly) and network on first run.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TAGS } from '../src/main/tags/vocabulary.ts'

const [depsDir, cacheDir] = process.argv.slice(2)
if (!depsDir) throw new Error('usage: build-tag-vectors.mjs <transformers deps dir> [cache dir]')
const { env, SiglipTextModel, AutoTokenizer } = await import(
  createRequire(join(depsDir, 'x.js')).resolve('@huggingface/transformers')
)
if (cacheDir) env.cacheDir = cacheDir

const MODEL = 'onnx-community/siglip2-base-patch16-224-ONNX'
// logit_scale/logit_bias live in the original checkpoint, not the ONNX export: read the two
// floats with HTTP range requests on the safetensors file (pinned commit).
const ST =
  'https://huggingface.co/google/siglip2-base-patch16-224/resolve/75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2/model.safetensors'

async function range(start, end) {
  const res = await fetch(ST, { headers: { Range: `bytes=${start}-${end}` } })
  if (res.status !== 206) throw new Error(`range request failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
const headerLen = Number((await range(0, 7)).readBigUInt64LE(0))
const header = JSON.parse((await range(8, 8 + headerLen - 1)).toString('utf8'))
async function scalar(name) {
  const {
    dtype,
    data_offsets: [a, b]
  } = header[name]
  if (dtype !== 'F32' || b - a !== 4) throw new Error(`unexpected ${name}: ${dtype}`)
  return (await range(8 + headerLen + a, 8 + headerLen + a + 3)).readFloatLE(0)
}
const logitScale = Math.exp(await scalar('logit_scale')) // stored as log
const logitBias = await scalar('logit_bias')

// fp16, not q8: the q8 text tower roughly quarters the probabilities of true matches. Its fused
// graph fails to load in ORT 1.23, hence no graph optimizations (build-time only, speed is moot).
const model = await SiglipTextModel.from_pretrained(MODEL, {
  dtype: 'fp16',
  session_options: { graphOptimizationLevel: 'disabled' }
})
const tok = await AutoTokenizer.from_pretrained(MODEL)
// SigLIP2 was trained on lowercased text padded to 64 tokens; anything else shifts the embeddings
const embed = async (texts) => {
  const out = await model(
    await tok(
      texts.map((t) => t.toLowerCase()),
      { padding: 'max_length', max_length: 64, truncation: true }
    )
  )
  const [n, d] = out.pooler_output.dims
  return Array.from({ length: n }, (_, i) =>
    normalize(out.pooler_output.data.slice(i * d, (i + 1) * d))
  )
}
const normalize = (v) => {
  const n = Math.hypot(...v)
  return Float32Array.from(v, (x) => x / n)
}

const tags = []
for (const tag of TAGS) {
  // One vector per prompt; a tag scores the max over its prompts (beats the averaged centroid,
  // which blurs distinct phrasings like "musicians playing" vs "a singer on stage")
  const vecs = await embed(tag.prompts)
  tags.push({ slug: tag.slug, vecs: vecs.map((v) => Buffer.from(v.buffer).toString('base64')) })
  process.stdout.write('.')
}

const out = join(import.meta.dirname, '../src/main/tags/tag-vectors.json')
writeFileSync(
  out,
  JSON.stringify(
    { model: 'siglip2-base-patch16-224', dim: 768, logitScale, logitBias, tags },
    null,
    1
  ) + '\n'
)
console.log(
  `\nwrote ${tags.length} tags (scale ${logitScale.toFixed(3)}, bias ${logitBias.toFixed(3)}) to ${out}`
)
process.exit(0)
