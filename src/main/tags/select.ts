/**
 * Image embeddings -> AI tags, scored per album.
 *
 * SigLIP is trained with a sigmoid loss, so each tag is an independent yes/no with
 * logit = scale * max_prompt cos(image, prompt) + bias. Absolute logits are a poor signal on
 * their own: on a Kerala wedding album every photo "looks like a thali ceremony". So a tag is
 * kept on a photo only when its logit stands out against the album's baseline for that tag
 * (album mean, or a global prior for tiny albums) AND clears an absolute floor.
 */
import vectors from './tag-vectors.json'
import prior from './tag-prior.json'
import { TAGS, type TagCategory } from './vocabulary'

export const TAG_MODEL = vectors.model
/** Bump whenever selection changes: albums scored with an older version are re-scored. */
export const TAG_SCORING_VERSION = 3

// ponytail: hand-tuned on one 15-photo Kerala album + ~400 bench photos (in logits).
// Retune against a labelled album if tags feel noisy or sparse.
export const MAX_TAGS = 5
/** Below this many photos the album mean is too noisy; use the global prior instead. */
export const MIN_ALBUM = 8
/** Absolute floor for any tag (p ~ 0.002); the album margin does the noise filtering. */
const FLOOR = -6.2
/** How far above the album baseline a tag must be, per category. */
const MARGIN: Record<TagCategory, number> = {
  events: 3.5,
  people: 2,
  shots: 2,
  things: 2,
  moments: 3,
  settings: 2
}
/** A tag this confident (p ~ 0.27) is kept even when the whole album shares it (e.g. bride). */
const STRONG = -1
/** Tags on more than this share of an album survive only where STRONG. */
const UNIVERSAL = 0.6
/**
 * Tags SigLIP can't tell apart in practice: on the bench their top hits were wrong (pheras on a
 * couple portrait, haldi on cake feeding, thali on every Kerala photo but the real thali one).
 * They need a near-certain logit (p ~ 0.82) and a big margin.
 */
export const STRICT_TAGS = new Set([
  'thali',
  'pheras',
  'varmala',
  'nikah',
  'engagement',
  'baraat',
  'sangeet',
  'mehendi',
  'haldi',
  'sacred-fire',
  'church-wedding',
  'getting-ready',
  'sadya',
  // Event packs: fired on any group photo / any cake / any dim stage in the bench
  'team-photo',
  'cake-cutting',
  'backstage'
])
const STRICT_FLOOR = 1.5
const STRICT_MARGIN = 4

const categoryOf = new Map(TAGS.map((t) => [t.slug, t.category]))
/** 90th-percentile logit per tag over the bench set: "more X than a typical photo". */
const PRIOR: Record<string, number> = prior.logits
const DIM = vectors.dim
const prompts = vectors.tags.map((t) => ({
  slug: t.slug,
  vecs: t.vecs.map((v) => {
    const b = Buffer.from(v, 'base64')
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + DIM * 4))
  })
}))

/** Per-tag logit for an L2-normalized image embedding (max over the tag's prompts). */
export function tagLogits(embedding: Float32Array): Map<string, number> {
  const out = new Map<string, number>()
  for (const { slug, vecs } of prompts) {
    let best = -1
    for (const v of vecs) {
      let cos = 0
      for (let j = 0; j < DIM; j++) cos += embedding[j] * v[j]
      if (cos > best) best = cos
    }
    out.set(slug, vectors.logitScale * best + vectors.logitBias)
  }
  return out
}

/**
 * Tags for every photo of one album, best first. `score` is the logit above the album baseline.
 * Input and output are index-aligned. `enabled` limits the vocabulary (null = all of it).
 */
export function selectAlbumTags(
  album: Array<Map<string, number>>,
  enabled: ReadonlySet<string> | null = null
): Array<Array<{ tag: string; score: number }>> {
  const n = album.length
  const baseline = (slug: string): number =>
    n >= MIN_ALBUM ? album.reduce((s, l) => s + (l.get(slug) ?? 0), 0) / n : (PRIOR[slug] ?? 0)
  const base = new Map([...categoryOf.keys()].map((slug) => [slug, baseline(slug)]))

  const picked = album.map((logits) =>
    [...logits]
      .flatMap(([tag, l]) => {
        const category = categoryOf.get(tag)
        if (category === undefined || (enabled && !enabled.has(tag))) return []
        const score = l - base.get(tag)!
        const ok = STRICT_TAGS.has(tag)
          ? l >= STRICT_FLOOR && score >= STRICT_MARGIN
          : l >= FLOOR && (score >= MARGIN[category] || l >= STRONG)
        return ok ? [{ tag, score, l }] : []
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_TAGS)
  )

  if (n >= MIN_ALBUM) {
    const count = new Map<string, number>()
    for (const p of picked) for (const t of p) count.set(t.tag, (count.get(t.tag) ?? 0) + 1)
    for (let i = 0; i < n; i++) {
      picked[i] = picked[i].filter((t) => count.get(t.tag)! <= UNIVERSAL * n || t.l >= STRONG)
    }
  }
  return picked.map((p) => p.map(({ tag, score }) => ({ tag, score })))
}

/** Slug rule for manual tags (any slug, not only the vocabulary). */
export const TAG_SLUG = /^[a-z0-9-]{1,40}$/

/** The server rejects a photo with more tags than this, failing the whole PATCH batch. */
export const MAX_IMAGE_TAGS = 12

/** Tags shown/pushed for a photo: manual adds first, then AI tags not manually removed. Capped. */
export function effectiveTags(
  ai: string[],
  overrides: Array<{ tag: string; action: 'add' | 'remove' }>
): string[] {
  const adds = overrides.filter((o) => o.action === 'add').map((o) => o.tag)
  const removed = new Set(overrides.filter((o) => o.action === 'remove').map((o) => o.tag))
  return [...new Set([...adds, ...ai.filter((t) => !removed.has(t))])].slice(0, MAX_IMAGE_TAGS)
}
