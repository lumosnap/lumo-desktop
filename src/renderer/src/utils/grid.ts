// Matches `.photos { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px }`
// in main.css, with minmax(150px, 1fr) at window widths <= 1180px.
export const GRID_GAP = 8
export function columnsForWidth(containerWidth: number, windowWidth: number): number {
  const min = windowWidth <= 1180 ? 150 : 190
  return Math.max(1, Math.floor((containerWidth + GRID_GAP) / (min + GRID_GAP)))
}

export interface GroupableImage {
  id: number
  capturedAt?: number | null
  burstId?: string | number | null
  isBurstCover?: boolean | number | null
  momentId?: string | number | null
}

// `index` is the tile's position in the lightbox slide list; `burst` holds a stacked burst's frames
export interface Tile<T> {
  image: T
  index: number
  burst?: T[]
}

export type Row<T> =
  | { kind: 'header'; key: string; label: string; momentId: string | number | null }
  | { kind: 'tiles'; key: string; tiles: Tile<T>[] }

export interface Flattened<T> {
  rows: Row<T>[]
  tiles: Tile<T>[] // flat, in display order: the lightbox's slides
  tileRow: number[] // tile index -> row index
  headers: { row: number; label: string }[]
}

const dayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
})
// capturedAt is EXIF wall-clock time encoded as UTC, so format it in UTC
const timeFmt = (d: Date): string =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })

// "Sat 31 Oct · 4:12–4:47 PM · 128 photos"
export function momentLabel(times: number[], count: number): string {
  const photos = `${count.toLocaleString()} ${count === 1 ? 'photo' : 'photos'}`
  if (!times.length) return `Undated · ${photos}`
  const a = new Date(Math.min(...times))
  const b = new Date(Math.max(...times))
  const [ta, tb] = [timeFmt(a), timeFmt(b)]
  const sameHalf = ta.slice(-2) === tb.slice(-2)
  const range = ta === tb ? ta : sameHalf ? `${ta.slice(0, -3)}–${tb}` : `${ta}–${tb}`
  return `${dayFmt.format(a).replace(',', '')} · ${range} · ${photos}`
}

/**
 * Display order for the grouped view. Without momentIds the input order (uploadOrder) is kept
 * as is. Otherwise: frames by (capturedAt, undated last, then input order); moments ordered by
 * their earliest frame; a burst's frames kept together, placed at its earliest frame.
 */
export function orderForGrouping<T extends GroupableImage>(images: T[]): T[] {
  if (!images.some((img) => img.momentId != null)) return images
  const pos = new Map(images.map((img, i) => [img, i]))
  const t = (img: T): number => img.capturedAt ?? Infinity
  // Infinity - Infinity is NaN, which falls through to input order
  const sorted = [...images].sort((a, b) => t(a) - t(b) || pos.get(a)! - pos.get(b)!)
  const momentRank = new Map<unknown, number>()
  const burstRank = new Map<unknown, number>()
  const key = new Map<T, [number, number, number]>()
  sorted.forEach((img, i) => {
    const m = img.momentId ?? null
    if (!momentRank.has(m)) momentRank.set(m, i)
    let unit = i
    if (img.burstId != null) {
      if (!burstRank.has(img.burstId)) burstRank.set(img.burstId, i)
      unit = burstRank.get(img.burstId)!
    }
    key.set(img, [momentRank.get(m)!, unit, i])
  })
  return sorted.sort((a, b) => {
    const [x, y] = [key.get(a)!, key.get(b)!]
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
  })
}

/**
 * Images (in display order) -> virtual rows. Consecutive images sharing a momentId become one
 * section with a header row; no momentIds anywhere means no headers (a plain chunked grid).
 * With stackBursts, a burst collapses to its cover tile (isBurstCover, else its first frame).
 */
export function flattenRows<T extends GroupableImage>(
  images: T[],
  opts: { columns: number; stackBursts: boolean }
): Flattened<T> {
  const columns = Math.max(1, opts.columns)
  const bursts = new Map<string | number, T[]>()
  if (opts.stackBursts)
    for (const img of images)
      if (img.burstId != null) {
        const frames = bursts.get(img.burstId)
        if (frames) frames.push(img)
        else bursts.set(img.burstId, [img])
      }

  // Visible tiles, still grouped by moment
  const sections: { momentId: string | number | null; items: Tile<T>[]; all: T[] }[] = []
  for (const img of images) {
    const momentId = img.momentId ?? null
    let sec = sections[sections.length - 1]
    if (!sec || sec.momentId !== momentId) sections.push((sec = { momentId, items: [], all: [] }))
    sec.all.push(img)
    let burst: T[] | undefined
    const frames = img.burstId != null ? bursts.get(img.burstId) : undefined
    if (frames && frames.length > 1) {
      const cover = frames.find((f) => f.isBurstCover) ?? frames[0]
      if (cover !== img) continue
      burst = frames
    }
    sec.items.push({ image: img, index: 0, burst })
  }

  const showHeaders = images.some((img) => img.momentId != null)
  const out: Flattened<T> = { rows: [], tiles: [], tileRow: [], headers: [] }
  sections.forEach((sec, si) => {
    if (showHeaders) {
      const times = sec.all.map((i) => i.capturedAt).filter((t): t is number => t != null)
      const label = momentLabel(times, sec.all.length)
      out.headers.push({ row: out.rows.length, label })
      out.rows.push({ kind: 'header', key: `h${si}`, label, momentId: sec.momentId })
    }
    for (let i = 0; i < sec.items.length; i += columns) {
      const tiles = sec.items.slice(i, i + columns)
      for (const t of tiles) {
        t.index = out.tiles.length
        out.tiles.push(t)
        out.tileRow.push(out.rows.length)
      }
      out.rows.push({ kind: 'tiles', key: `r${si}-${i}`, tiles })
    }
  })
  return out
}
