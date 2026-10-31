// People: faces found on this computer, grouped into persons the photographer can name

/** [x, y, w, h], each 0..1 of the photo's width or height */
export type Box = [number, number, number, number]

export interface Person {
  id: string
  name: string | null
  hidden: boolean
  photoCount: number
  cover: { imageId: number; path: string; box: Box }
}

export interface Face {
  faceId: number
  box: Box
  personId: string | null
  name: string | null
}

export type PeopleState = 'off' | 'waiting' | 'running' | 'paused' | 'done'
export interface PeopleConfig {
  enabled: boolean
  state: PeopleState
  processed: number
  total: number
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
