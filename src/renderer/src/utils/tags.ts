// AI tag slugs (from main's analysis) -> what the photographer reads
const LABELS: Record<string, string> = {
  'getting-ready': 'Getting ready',
  'church-wedding': 'Church wedding',
  'group-photo': 'Group photo',
  'close-up': 'Close-up',
  'black-and-white': 'Black & white',
  'mehendi-hands': 'Mehendi hands',
  'bridal-outfit': 'Bridal outfit',
  'invitation-card': 'Invitation card',
  'sacred-fire': 'Sacred fire'
}

/** Display label for a tag slug; slugs without an entry are title-cased ("sadya" -> "Sadya"). */
export function tagLabel(slug: string): string {
  return LABELS[slug] ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export interface Tagged {
  tags?: string[] | null
}

/** [slug, count] for every tag in `images`, most frequent first (ties by label). */
export function tagCounts(images: readonly Tagged[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const img of images) for (const t of img.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || tagLabel(a[0]).localeCompare(tagLabel(b[0])))
}

/** Images carrying every tag in `selected` (AND); an empty selection keeps them all. */
export function withTags<T extends Tagged>(images: T[], selected: readonly string[]): T[] {
  if (!selected.length) return images
  return images.filter((img) => selected.every((t) => img.tags?.includes(t)))
}

/**
 * Tags whose label or slug contains `query`, case-insensitively. Ones where a word starts with
 * it come first; otherwise the input order (frequency) is kept.
 */
export function searchTags<T extends [string, number]>(entries: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...entries]
  const rank = ([slug]: T): number => {
    const hay = `${tagLabel(slug).toLowerCase()} ${slug}`
    if (!hay.includes(q)) return -1
    return hay.split(/[\s-]+/).some((w) => w.startsWith(q)) ? 0 : 1
  }
  const ranked = entries.map((e) => [e, rank(e)] as const).filter(([, r]) => r >= 0)
  return ranked.sort((a, b) => a[1] - b[1]).map(([e]) => e)
}

/** Counts over just the images whose id is in `ids` (the selection), most frequent first. */
export function tagCountsFor<T extends Tagged & { id: number }>(
  images: readonly T[],
  ids: ReadonlySet<number>
): [string, number][] {
  return tagCounts(images.filter((img) => ids.has(img.id)))
}

/** A typed tag name -> slug: lowercase, spaces to "-", other characters dropped, at most 40. */
export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
  return s.slice(0, 40).replace(/-$/, '')
}

// Album tag set, as window.api.tags.getAlbumConfig returns it
export type TagCategory = 'events' | 'people' | 'shots' | 'things' | 'moments' | 'settings'
export interface VocabTag {
  slug: string
  label: string
  category: string
}
export interface AlbumTagConfig {
  enabled: string[] | null // null = every tag
  vocabulary: VocabTag[]
}
export const CATEGORIES: [TagCategory, string][] = [
  ['events', 'Events'],
  ['people', 'People'],
  ['shots', 'Shots'],
  ['things', 'Things'],
  ['moments', 'Moments'],
  ['settings', 'Settings']
]

/** Vocabulary by category (in CATEGORIES order), keeping tags whose label or slug contains `query`. */
export function groupVocab(
  vocab: readonly VocabTag[],
  query = ''
): { category: string; label: string; tags: VocabTag[] }[] {
  const q = query.trim().toLowerCase()
  const hit = (t: VocabTag): boolean =>
    !q || t.label.toLowerCase().includes(q) || t.slug.includes(q)
  return CATEGORIES.map(([category, label]) => ({
    category,
    label,
    tags: vocab.filter((t) => t.category === category && hit(t))
  })).filter((g) => g.tags.length)
}

/**
 * Starting points for an album's tag set: every tag minus the rituals a wedding of that kind
 * doesn't have. Judgement calls:
 * - Christian keeps `thali` (Kerala Christians tie the minnu, which reads the same) and `sadya`
 *   (Kerala Christian receptions serve a sadya-style feast).
 * - Muslim keeps `haldi`, `mehendi`, `sangeet` and `baraat`, common at North Indian Muslim weddings.
 * - Kerala Hindu keeps `varmala` (garlands are exchanged) and `mehendi`, now usual for brides.
 */
export const PRESETS: { name: string; exclude: string[] }[] = [
  { name: 'All', exclude: [] },
  {
    name: 'Kerala Hindu',
    exclude: ['haldi', 'sangeet', 'baraat', 'pheras', 'nikah', 'church-wedding', 'church']
  },
  { name: 'North Indian Hindu', exclude: ['thali', 'sadya', 'nikah', 'church-wedding', 'church'] },
  {
    name: 'Christian',
    exclude: [
      'haldi',
      'mehendi',
      'sangeet',
      'baraat',
      'varmala',
      'pheras',
      'nikah',
      'sacred-fire',
      'temple',
      'mehendi-hands'
    ]
  },
  {
    name: 'Muslim',
    exclude: ['pheras', 'varmala', 'thali', 'sacred-fire', 'church-wedding', 'church', 'temple']
  }
]

/** The slugs a preset turns on, in vocabulary order. */
export const presetSlugs = (exclude: readonly string[], vocab: readonly VocabTag[]): string[] =>
  vocab.map((t) => t.slug).filter((s) => !exclude.includes(s))
