// People: faces found on this computer. The photographer names a few people from a photo;
// the app finds their other faces and asks to check the doubtful ones

/** [x, y, w, h], each 0..1 of the photo's width or height */
export type Box = [number, number, number, number]

/** Named people only: a person exists once the photographer gives a face a name */
export interface Person {
  id: string
  name: string
  hidden: boolean // hidden from the client gallery
  photoCount: number
  reviewCount: number // faces the app is not sure about
  cover: { imageId: number; path: string; box: Box }
}

export interface Face {
  faceId: number
  box: Box
  personId: string | null
  name: string | null
  source: 'ref' | 'auto' | null // ref: the photographer said so; auto: the app's match
}

/** A photo with several clear faces, to name people from */
export interface PickPhoto {
  imageId: number
  path: string
  faceCount: number
}

/** A face the app thinks is the person, but is not sure */
export interface ReviewFace {
  faceId: number
  imageId: number
  path: string
  box: Box
  score: number
}

export type FaceTarget = { personId: string } | { newName: string } | { none: true }
type Result = { success: boolean; error?: string }

/** window.api.people as the main process serves it */
export interface PeopleApi {
  getConfig: (albumId: string) => Promise<PeopleConfig>
  setEnabled: (albumId: string, enabled: boolean) => Promise<PeopleConfig>
  list: (albumId: string) => Promise<Person[]>
  pickPhotos: (albumId: string, limit?: number) => Promise<PickPhoto[]>
  facesInImage: (albumId: string, imageId: number) => Promise<Face[]>
  assignFace: (
    albumId: string,
    faceId: number,
    target: FaceTarget
  ) => Promise<Result & { personId?: string | null }>
  reviewQueue: (albumId: string, personId: string, limit?: number) => Promise<ReviewFace[]>
  review: (
    albumId: string,
    personId: string,
    decisions: Array<{ faceId: number; yes: boolean }>
  ) => Promise<Result & { remaining: number }>
  rename: (albumId: string, personId: string, name: string | null) => Promise<Result>
  merge: (albumId: string, intoId: string, fromIds: string[]) => Promise<Result>
  setHidden: (albumId: string, personId: string, hidden: boolean) => Promise<Result>
  setCover: (albumId: string, personId: string, faceId: number) => Promise<Result>
  remove: (albumId: string, personId: string) => Promise<Result>
  linkClient: (albumId: string, clientName: string, personId: string | null) => Promise<Result>
  clientLinks: (albumId: string) => Promise<Record<string, string>>
  onPeopleChanged: (callback: (albumId: string) => void) => () => void
}

export type PeopleState = 'off' | 'waiting' | 'running' | 'paused' | 'done'
export interface PeopleConfig {
  enabled: boolean
  state: PeopleState
  processed: number
  total: number
  onBattery?: boolean // running unplugged; pauses when the battery gets low
}

const r2 = (n: number): number => Math.round(n * 100) / 100

/**
 * CSS background-size and -position that show the face in `box` inside a square avatar, cut
 * from the photo's own thumbnail. `aspect` is the photo's width / height. The square is the
 * face's longer side times `pad`, kept inside the photo, so the avatar never shows blank edges.
 */
export function faceCrop(
  box: Box,
  aspect: number,
  pad = 1.8
): { backgroundSize: string; backgroundPosition: string } {
  const W = aspect > 0 ? aspect : 1.5
  const H = 1
  const [x, y, w, h] = box
  const side = Math.min(Math.max(w * W, h * H) * pad, W, H)
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(v, max))
  const left = clamp((x + w / 2) * W - side / 2, W - side)
  const top = clamp((y + h / 2) * H - side / 2, H - side)
  // background-position p% puts p% of (element - image) at the left: p = left / (W - side)
  const pos = (off: number, room: number): number => (room > 1e-9 ? (off / room) * 100 : 50)
  return {
    backgroundSize: `${r2((W / side) * 100)}% ${r2((H / side) * 100)}%`,
    backgroundPosition: `${r2(pos(left, W - side))}% ${r2(pos(top, H - side))}%`
  }
}

/** Images with every person in `ids` (AND); no ids keeps them all. */
export function withPeople<T extends { people?: string[] | null }>(
  images: T[],
  ids: readonly string[]
): T[] {
  if (!ids.length) return images
  return images.filter((img) => ids.every((id) => img.people?.includes(id)))
}

/**
 * Faces in reading order: rows top to bottom, each row left to right. A face starts a new row
 * when its centre is lower than the row's first face by more than that face's height.
 */
export function byPosition<T extends { box: Box }>(faces: readonly T[]): T[] {
  const cy = (f: T): number => f.box[1] + f.box[3] / 2
  const rows: T[][] = []
  for (const f of [...faces].sort((a, b) => cy(a) - cy(b))) {
    const row = rows.at(-1)
    if (row && cy(f) - cy(row[0]) <= row[0].box[3]) row.push(f)
    else rows.push([f])
  }
  return rows.flatMap((r) => r.sort((a, b) => a.box[0] - b.box[0]))
}

/** The next face after `from` (wrapping) that has no confirmed name, or -1 */
export function nextToName(faces: readonly Pick<Face, 'source'>[], from: number): number {
  for (let k = 1; k <= faces.length; k++) {
    const i = (from + k) % faces.length
    if (faces[i].source !== 'ref') return i
  }
  return -1
}

/**
 * People whose name matches what was typed (any word starts with it), and the person whose
 * name is exactly it. No exact match means Enter makes a new person.
 */
export function matchPeople<T extends { name: string }>(
  people: readonly T[],
  query: string
): { matches: T[]; exact: T | null } {
  const q = query.trim().toLowerCase()
  if (!q) return { matches: [...people], exact: null }
  const matches = people.filter((p) =>
    p.name
      .toLowerCase()
      .split(/\s+/)
      .some((w, i, ws) => w.startsWith(q) || ws.slice(i).join(' ').startsWith(q))
  )
  return { matches, exact: people.find((p) => p.name.trim().toLowerCase() === q) ?? null }
}

/** Review answers: every face is a yes until it is marked no */
/** Faces start unpicked: only the ones tapped are the person; the rest are a no */
export function decisions(
  faces: readonly { faceId: number }[],
  yes: ReadonlySet<number>
): Array<{ faceId: number; yes: boolean }> {
  return faces.map((f) => ({ faceId: f.faceId, yes: yes.has(f.faceId) }))
}

/** Arrow keys in a grid of `n` items, `cols` wide; stays inside the grid */
export function gridMove(i: number, key: string, cols: number, n: number): number {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[key] ?? 0
  const j = i + step
  return j < 0 || j >= n ? i : j
}

/**
 * Why the pick view has no photos to offer yet, and what happens next.
 * Faces are found photo by photo, so an empty list early on is a wait, not an end.
 */
export function pickEmptyText(
  scan: Pick<PeopleConfig, 'state' | 'processed' | 'total'> | null
): string {
  switch (scan?.state) {
    case 'waiting':
      return 'Face finding starts when the photos are in. Photos to pick from show up here then.'
    case 'running':
      return `Still looking for faces: ${scan.processed.toLocaleString()} of ${scan.total.toLocaleString()} photos done. Photos show up here as faces are found.`
    case 'paused':
      return 'Face finding is paused until your Mac is plugged in or cooler. It goes on by itself.'
    default:
      return 'No faces found in this album. Group photos and portraits work best.'
  }
}
