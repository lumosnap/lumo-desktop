/**
 * Client selection lists ("Main album · up to 300"): what each client picked for each one,
 * how far along they are, and who picked the same photo.
 */

export interface ListClient {
  clientName: string
  imageIds: number[] // local ids
  count: number // the client's picks, photos missing on this computer too
  submittedAt: number | null
}
export interface List {
  id: string
  name: string
  position: number
  maxPicks: number | null
  deadline: number | null // unix ms, end of the chosen day
  setLimits: Array<{ setId: string; max: number }> | null
  clients: ListClient[]
}
export type Draft = Omit<List, 'clients'>

/** Who to show in a list: one client, everyone at once ('*'), or anyone (null). */
export type ClientScope = string | null

export const EVERYONE = '*'

/** Each photo in the list, with the clients who picked it. '*' keeps photos every client picked. */
export function pickersByImage(list: List, scope: ClientScope = null): Map<number, string[]> {
  const by = new Map<number, string[]>()
  for (const c of list.clients) {
    if (scope && scope !== EVERYONE && c.clientName !== scope) continue
    for (const id of c.imageIds) {
      const names = by.get(id)
      if (names) names.push(c.clientName)
      else by.set(id, [c.clientName])
    }
  }
  if (scope === EVERYONE) {
    const n = list.clients.length
    for (const [id, names] of by) if (names.length < n) by.delete(id)
  }
  return by
}

/** The names of the lists each photo is picked in, by anyone. */
export function listsByImage(lists: List[]): Map<number, string[]> {
  const by = new Map<number, string[]>()
  for (const l of lists) {
    const ids = new Set(l.clients.flatMap((c) => c.imageIds))
    for (const id of ids) by.set(id, [...(by.get(id) ?? []), l.name])
  }
  return by
}

export interface Progress {
  count: number
  max: number | null
  sent: number | null
  overdue: boolean
  over: boolean
  perSet: Array<{ name: string; count: number; max: number; over: boolean }>
}

export function progress(
  list: List,
  client: ListClient,
  sets: Array<{ id: string; name: string; imageIds: number[] }>,
  now = Date.now()
): Progress {
  const mine = new Set(client.imageIds)
  const perSet = (list.setLimits ?? []).flatMap(({ setId, max }) => {
    const set = sets.find((s) => s.id === setId)
    if (!set) return []
    const count = set.imageIds.filter((id) => mine.has(id)).length
    return [{ name: set.name, count, max, over: count > max }]
  })
  return {
    count: client.count,
    max: list.maxPicks,
    sent: client.submittedAt,
    overdue: !client.submittedAt && list.deadline != null && now > list.deadline,
    over: list.maxPicks != null && client.count > list.maxPicks,
    perSet
  }
}

/** "Sent 31 Oct", "Not sent yet", "Not sent · was due 30 Oct" */
export function sentText(p: Progress, deadline: number | null): string {
  if (p.sent) return `Sent ${day(p.sent)}`
  if (p.overdue && deadline != null) return `Not sent · was due ${day(deadline)}`
  return 'Not sent yet'
}

/** Where an album's selections are, at a glance: "1 of 3 sent · 2 late". Empty with no clients. */
export function listSummary(list: List, now = Date.now()): { text: string; late: boolean } {
  const n = list.clients.length
  if (!n) return { text: '', late: false }
  const sent = list.clients.filter((c) => c.submittedAt).length
  const late = list.deadline != null && now > list.deadline ? n - sent : 0
  const text = sent === n ? (n === 1 ? 'Sent' : `All ${n} sent`) : `${sent} of ${n} sent`
  return { text: late ? `${text} · ${late} late` : text, late: late > 0 }
}

/** What a list asks for: "up to 300 · Haldi up to 40 · by 15 Nov". */
export function limitsText(list: Draft, sets: Array<{ id: string; name: string }>): string {
  const parts = [list.maxPicks ? `up to ${list.maxPicks.toLocaleString()}` : 'no limit']
  for (const l of list.setLimits ?? []) {
    const s = sets.find((x) => x.id === l.setId)
    if (s) parts.push(`${s.name} up to ${l.max.toLocaleString()}`)
  }
  if (list.deadline != null) parts.push(`by ${day(list.deadline)}`)
  return parts.join(' · ')
}

export function day(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** <input type=date> value ↔ the end of that day, local time. */
export function dateValue(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function endOfDay(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999).getTime() : null
}

/** Saved lists the draft leaves out that clients already picked in: saving deletes those picks. */
export function picksLost(
  saved: List[],
  draft: Draft[]
): Array<{ name: string; picks: number; clients: string[] }> {
  const kept = new Set(draft.map((d) => d.id))
  return saved
    .filter((l) => !kept.has(l.id))
    .map((l) => ({
      name: l.name,
      picks: l.clients.reduce((n, c) => n + c.count, 0),
      clients: l.clients.filter((c) => c.count).map((c) => c.clientName)
    }))
    .filter((l) => l.picks > 0)
}
