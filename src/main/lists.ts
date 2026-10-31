/**
 * Client selection lists ("Main album · 300 photos"): they live on the server. Main only maps the
 * server's image ids to local ones and checks what the renderer sends.
 */

export interface SelectionList {
  id: string
  name: string
  position: number
  maxPicks: number | null
  deadline: number | null // unix ms
  setLimits: Array<{ setId: string; max: number }> | null
}

export interface ServerList extends SelectionList {
  clients: Array<{ clientName: string; imageIds: number[]; submittedAt: number | null }>
}

export interface LocalList extends SelectionList {
  // imageIds are local ids; count is the client's real number of picks, photos missing here too
  clients: Array<{
    clientName: string
    imageIds: number[]
    count: number
    submittedAt: number | null
  }>
}

export const MAX_LISTS = 20

/** Server image ids to local ids. Picks of photos this computer doesn't have are left out. */
export function toLocalLists(
  lists: ServerList[],
  images: Array<{ id: number; serverId: number | null }>
): LocalList[] {
  const local = new Map<number, number>()
  for (const img of images) if (img.serverId != null) local.set(img.serverId, img.id)
  return [...lists]
    .sort((a, b) => a.position - b.position)
    .map((l) => ({
      ...l,
      setLimits: l.setLimits ?? null,
      clients: (l.clients ?? []).map((c) => ({
        clientName: c.clientName,
        submittedAt: c.submittedAt ?? null,
        count: c.imageIds.length,
        imageIds: c.imageIds.flatMap((id) => local.get(id) ?? [])
      }))
    }))
}

const posInt = (v: unknown): number | null =>
  Number.isInteger(v) && (v as number) > 0 ? (v as number) : null

/** What the renderer sends, checked: names trimmed, limits positive whole numbers, ≤ 20. */
export function cleanLists(input: unknown): SelectionList[] {
  if (!Array.isArray(input)) throw new Error('Lists must be an array')
  if (input.length > MAX_LISTS) throw new Error(`At most ${MAX_LISTS} lists`)
  return input.map((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>
    const name = typeof l.name === 'string' ? l.name.trim().slice(0, 80) : ''
    if (!name) throw new Error('Every list needs a name')
    if (typeof l.id !== 'string' || !l.id) throw new Error('List id is required')
    const limits = Array.isArray(l.setLimits)
      ? l.setLimits.flatMap((s: { setId?: unknown; max?: unknown }) => {
          const max = posInt(s?.max)
          return typeof s?.setId === 'string' && max ? [{ setId: s.setId, max }] : []
        })
      : []
    return {
      id: l.id,
      name,
      position: i,
      maxPicks: posInt(l.maxPicks),
      deadline: Number.isFinite(l.deadline) ? (l.deadline as number) : null,
      setLimits: limits.length ? limits : null
    }
  })
}
