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
