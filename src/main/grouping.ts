/**
 * Burst + moment grouping (pure, no I/O).
 *
 * Bursts: consecutive frames from the same camera, close in time and near-identical.
 * Moments: PhotoTOC-style event segmentation on capture-time gaps
 * (Platt et al., "PhotoTOC: Automatic Clustering for Browsing Personal Photographs").
 */

// ponytail: tuning knobs, picked from the usual burst/event heuristics; tune on real shoots
export const BURST_MAX_GAP_MS = 3000 // ponytail: max gap to the previous frame of the same camera
export const BURST_MAX_HAMMING = 12 // ponytail: max dHash distance (of 64 bits) between chained frames
export const MOMENT_WINDOW = 10 // ponytail: ±gaps averaged for the local log-gap baseline
export const MOMENT_K = Math.log(17) // ponytail: how far above the local baseline a gap must be
export const MOMENT_MIN_GAP_MS = 2 * 60 * 1000 // ponytail: floor, no moment split below this gap
const ID_PREFIX_LENGTH = 12

export interface GroupingInput {
  id: number
  filename: string
  uploadOrder: number
  hash: string | null // source file hash, used for deterministic group ids
  capturedAt: number | null
  cameraId: string | null
  phash: string | null
  sharpness: number | null
  rating: number | null
}

export interface Grouping {
  burstId: string | null
  isBurstCover: boolean // true only for the chosen frame of a burst
  momentId: string | null
}

export function hamming(a: string, b: string): number {
  let bits = 0
  for (let i = 0; i < 16; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0
    while (x) {
      x &= x - 1
      bits++
    }
  }
  return bits
}

function groupId(prefix: string, first: GroupingInput): string {
  return prefix + (first.hash ?? `id${first.id}`).slice(0, ID_PREFIX_LENGTH)
}

function byCaptureTime(a: GroupingInput, b: GroupingInput): number {
  return (
    a.capturedAt! - b.capturedAt! ||
    (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0) ||
    a.id - b.id
  )
}

/** Returns grouping for every input image, keyed by id. */
export function groupImages(images: GroupingInput[]): Map<number, Grouping> {
  const result = new Map<number, Grouping>()
  for (const img of images)
    result.set(img.id, { burstId: null, isBurstCover: false, momentId: null })

  const timed = images.filter((img) => img.capturedAt != null).sort(byCaptureTime)

  // Bursts: chain each frame to the previous frame of the same camera
  const lastByCamera = new Map<string, { img: GroupingInput; group: GroupingInput[] }>()
  const bursts: GroupingInput[][] = []
  for (const img of timed) {
    const camera = img.cameraId ?? ''
    const prev = lastByCamera.get(camera)
    const chains =
      prev &&
      img.capturedAt! - prev.img.capturedAt! <= BURST_MAX_GAP_MS &&
      img.phash &&
      prev.img.phash &&
      hamming(img.phash, prev.img.phash) <= BURST_MAX_HAMMING
    const group = chains ? prev.group : []
    if (!chains) bursts.push(group)
    group.push(img)
    lastByCamera.set(camera, { img, group })
  }
  for (const burst of bursts) {
    if (burst.length < 2) continue
    const burstId = groupId('b-', burst[0])
    // Cover: highest rating, then sharpest, then first frame
    let cover = burst[0]
    for (const img of burst) {
      result.get(img.id)!.burstId = burstId
      const dr = (img.rating ?? 0) - (cover.rating ?? 0)
      if (dr > 0 || (dr === 0 && (img.sharpness ?? -1) > (cover.sharpness ?? -1))) cover = img
    }
    result.get(cover.id)!.isBurstCover = true
  }

  // Moments: split where log(gap + 1) exceeds the local mean log-gap by K (gaps in seconds)
  if (timed.length > 0) {
    const logGaps: number[] = []
    for (let i = 1; i < timed.length; i++) {
      logGaps.push(Math.log((timed[i].capturedAt! - timed[i - 1].capturedAt!) / 1000 + 1))
    }
    let momentId = groupId('m-', timed[0])
    result.get(timed[0].id)!.momentId = momentId
    for (let i = 1; i < timed.length; i++) {
      const g = i - 1 // gap between timed[i - 1] and timed[i]
      const from = Math.max(0, g - MOMENT_WINDOW)
      const to = Math.min(logGaps.length - 1, g + MOMENT_WINDOW)
      let sum = 0
      for (let j = from; j <= to; j++) sum += logGaps[j]
      const mean = sum / (to - from + 1)
      const gapMs = timed[i].capturedAt! - timed[i - 1].capturedAt!
      if (gapMs >= MOMENT_MIN_GAP_MS && logGaps[g] > mean + MOMENT_K) {
        momentId = groupId('m-', timed[i])
      }
      result.get(timed[i].id)!.momentId = momentId
    }

    // Images without capturedAt join the moment of their nearest earlier neighbour in
    // upload order (or the next one if none came before). Albums with no capture times
    // at all get no moments.
    const byUpload = [...images].sort((a, b) => a.uploadOrder - b.uploadOrder || a.id - b.id)
    let lastMoment: string | null = null
    const leading: GroupingInput[] = []
    for (const img of byUpload) {
      const grouping = result.get(img.id)!
      if (img.capturedAt != null) {
        lastMoment = grouping.momentId
        for (const pending of leading.splice(0)) result.get(pending.id)!.momentId = lastMoment
      } else if (lastMoment) {
        grouping.momentId = lastMoment
      } else {
        leading.push(img)
      }
    }
  }

  return result
}
