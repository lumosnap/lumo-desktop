/**
 * Image embedding -> AI tags. SigLIP is trained with a sigmoid loss, so each tag is an
 * independent yes/no: p = sigmoid(scale * cos(image, prompt) + bias), max over the tag's prompts.
 */
import vectors from './tag-vectors.json'
import { TAGS, type TagCategory } from './vocabulary'

export const TAG_MODEL = vectors.model

// ponytail: hand-tuned on ~400 bench photos (320 wedding/event, 82 unrelated stock) for
// ~2.5 tags/photo on average, 0 on unrelated images. SigLIP2-base's sigmoid scores multi-subject
// photos far below 0.5 (an obvious wedding cake scores ~0.02), so 0.1 tagged almost nothing.
// People tags fire broadly and get the highest bar; things/moments are rarer, so lower.
// Retune against a labelled album if tags feel noisy or sparse.
export const TAG_THRESHOLDS: Record<TagCategory, number> = {
  events: 0.004,
  people: 0.006,
  shots: 0.005,
  things: 0.002,
  moments: 0.002,
  settings: 0.004
}
export const MAX_TAGS = 8

const categoryOf = new Map(TAGS.map((t) => [t.slug, t.category]))
const DIM = vectors.dim
const prompts = vectors.tags.map((t) => ({
  slug: t.slug,
  vecs: t.vecs.map((v) => {
    const b = Buffer.from(v, 'base64')
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + DIM * 4))
  })
}))

/** Per-tag probability for an L2-normalized image embedding. */
export function tagProbabilities(embedding: Float32Array): Map<string, number> {
  const out = new Map<string, number>()
  for (const { slug, vecs } of prompts) {
    let best = -1
    for (const v of vecs) {
      let cos = 0
      for (let j = 0; j < DIM; j++) cos += embedding[j] * v[j]
      if (cos > best) best = cos
    }
    out.set(slug, 1 / (1 + Math.exp(-(vectors.logitScale * best + vectors.logitBias))))
  }
  return out
}

/** Tags at or above their category threshold, best first, at most `max`. */
export function selectTags(
  probs: Map<string, number>,
  thresholds: Record<TagCategory, number> = TAG_THRESHOLDS,
  max = MAX_TAGS
): Array<{ tag: string; score: number }> {
  return [...probs]
    .filter(([slug, p]) => {
      const category = categoryOf.get(slug)
      return category !== undefined && p >= thresholds[category]
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([tag, score]) => ({ tag, score }))
}
