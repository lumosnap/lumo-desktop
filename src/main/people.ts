/**
 * People: opt-in per album. Finds faces in the original photos (ML worker, after tagging, only
 * while uploads are idle). The photographer picks faces to make people (references); every
 * other face is matched to them (people-match.ts): auto, "Is this X?" review, or no one.
 * Face vectors never leave this computer: the server only gets names, photo ids and a cover box.
 */
import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { basename, extname, join } from 'path'
import {
  clearPeopleNeedPush,
  getAlbum,
  getAlbumFaces,
  getAlbumImages,
  getAlbumPeople,
  getImagesToScanForFaces,
  getPeopleProgress,
  markPeopleDirty,
  rematchPeople,
  saveImageFaces,
  setPeopleEnabled as dbSetPeopleEnabled,
  type FaceRow,
  type PersonRow
} from './database'
import { detectFaces, isMlOnBattery, isMlPaused } from './ml/embedder'
import { ensureFaceModels } from './ml/model'
import { frontalness } from './ml/faces'
import { uploadPipeline } from './pipeline'
import { albumsApi } from './api-client'
import { createLogger, getErrorMessage } from './logger'

const log = createLogger('People')

type Box = [number, number, number, number]

export type PeopleState = 'off' | 'waiting' | 'running' | 'paused' | 'done'
export interface PeopleConfig {
  enabled: boolean
  state: PeopleState
  processed: number
  total: number
  onBattery: boolean // running unplugged (battery above the pause level)
}
export interface PersonSummary {
  id: string
  name: string
  hidden: boolean
  photoCount: number
  reviewCount: number
  cover: { imageId: number; path: string; box: Box }
}
export interface PickPhoto {
  imageId: number
  path: string
  faceCount: number
}
export interface ReviewFace {
  faceId: number
  imageId: number
  path: string
  box: Box
  score: number
}

let scanning: { albumId: string; waitingForUploads: boolean } | null = null
/** Review queues per album, from the last re-match. */
const reviews = new Map<string, Map<string, Array<{ faceId: number; score: number }>>>()

/** Re-match the album's faces to the references; call after every people change or scan batch. */
export function rematch(albumId: string): Map<string, Array<{ faceId: number; score: number }>> {
  const { changed, review } = rematchPeople(albumId)
  reviews.set(albumId, review)
  if (changed > 0) schedulePeoplePush(albumId)
  return review
}

const reviewsFor = (albumId: string): Map<string, Array<{ faceId: number; score: number }>> =>
  reviews.get(albumId) ?? rematch(albumId)

export function notifyPeopleChanged(albumId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('album:peopleChanged', { albumId })
  }
}

export function peopleConfig(albumId: string): PeopleConfig {
  const { enabled, processed, total } = getPeopleProgress(albumId)
  let state: PeopleState
  if (!enabled) state = 'off'
  else if (scanning?.albumId === albumId)
    state = scanning.waitingForUploads ? 'waiting' : isMlPaused() ? 'paused' : 'running'
  else state = processed >= total ? 'done' : 'waiting'
  return { enabled, state, processed, total, onBattery: state === 'running' && isMlOnBattery() }
}

/** Off deletes all face data now and empties the server's people (debounced, retried). */
export function setPeopleEnabled(albumId: string, enabled: boolean): PeopleConfig {
  if (!getAlbum(albumId)) throw new Error('Album not found')
  dbSetPeopleEnabled(albumId, enabled)
  reviews.delete(albumId)
  schedulePeoplePush(albumId)
  notifyPeopleChanged(albumId)
  return peopleConfig(albumId)
}

/** Manual cover if still theirs, else the face that is most confident × frontal × large. */
export function coverFace(p: PersonRow): FaceRow {
  const manual = p.faces.find((f) => f.id === p.coverFaceId)
  if (manual) return manual
  const rank = (f: FaceRow): number =>
    f.score * (0.25 + frontalness(f.landmarks)) * Math.sqrt(f.box[2] * f.box[3])
  return p.faces.reduce((best, f) => (rank(f) > rank(best) ? f : best))
}

const thumbnailPath = (localFolderPath: string, originalFilename: string): string =>
  join(
    localFolderPath,
    '.thumbnail',
    `${basename(originalFilename, extname(originalFilename))}.webp`
  )

/** The thumbnail if there is one, else the local copy; local image id → path. */
function imagePaths(albumId: string): Map<number, string> {
  const album = getAlbum(albumId)
  if (!album) return new Map()
  return new Map(
    getAlbumImages(albumId).map((i) => {
      const thumb = thumbnailPath(album.localFolderPath, i.originalFilename)
      return [i.id, existsSync(thumb) ? thumb : i.localFilePath]
    })
  )
}

/** All people (every person is named), by name. */
export function listPeople(albumId: string): PersonSummary[] {
  const paths = imagePaths(albumId)
  const review = reviewsFor(albumId)
  return getAlbumPeople(albumId)
    .map((p) => {
      const cover = coverFace(p)
      return {
        id: p.id,
        name: p.name,
        hidden: p.hidden,
        photoCount: new Set(p.faces.map((f) => f.imageId)).size,
        reviewCount: review.get(p.id)?.length ?? 0,
        cover: { imageId: cover.imageId, path: paths.get(cover.imageId)!, box: cover.box }
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** "Is this X?" candidates, best first. */
export function reviewQueue(albumId: string, personId: string, limit = 24): ReviewFace[] {
  const queue = reviewsFor(albumId).get(personId)?.slice(0, limit) ?? []
  const faces = new Map(getAlbumFaces(albumId).map((f) => [f.id, f]))
  const paths = imagePaths(albumId)
  return queue.flatMap(({ faceId, score }) => {
    const f = faces.get(faceId)
    return f ? [{ faceId, imageId: f.imageId, path: paths.get(f.imageId)!, box: f.box, score }] : []
  })
}

/**
 * Good photos to pick people from: many faces that are large, frontal and confident
 * (group and family portraits win). Faces too small to click count for nothing.
 * ponytail: heuristic weights eyeballed on LumoTest; no burst/duplicate spreading.
 */
export function pickPhotos(albumId: string, limit = 12): PickPhoto[] {
  const byImage = new Map<number, { score: number; faceCount: number }>()
  for (const f of getAlbumFaces(albumId)) {
    const side = Math.sqrt(f.box[2] * f.box[3]) // fraction of the photo
    const q =
      side < 0.03 ? 0 : f.score * (0.25 + frontalness(f.landmarks)) * Math.min(1, side / 0.1)
    const e = byImage.get(f.imageId) ?? { score: 0, faceCount: 0 }
    e.score += q
    e.faceCount++
    byImage.set(f.imageId, e)
  }
  const paths = imagePaths(albumId)
  return [...byImage]
    .filter(([id, e]) => e.score > 0 && paths.has(id))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([imageId, e]) => ({ imageId, path: paths.get(imageId)!, faceCount: e.faceCount }))
}

/** Person ids (reference or auto, hidden included) per local image id. */
export function imagePeople(albumId: string): Map<number, string[]> {
  const out = new Map<number, string[]>()
  for (const p of getAlbumPeople(albumId)) {
    for (const id of new Set(p.faces.map((f) => f.imageId))) {
      const list = out.get(id)
      if (list) list.push(p.id)
      else out.set(id, [p.id])
    }
  }
  return out
}

const UPLOAD_POLL_MS = 5000
const REMATCH_EVERY = 10 // photos per re-match + UI refresh while scanning

/**
 * Detect faces in the album's unscanned photos, matching them to people as they come. Runs on the tagging chain
 * (after tagging), so it never competes with SigLIP. Also retries a pending people push.
 */
export async function scanFacesNow(albumId: string, cancelled: () => boolean): Promise<void> {
  const album = getAlbum(albumId)
  const stop = (): boolean => cancelled() || !getPeopleProgress(albumId).enabled
  if (!album) return
  if (album.people_enabled !== 1 || cancelled()) return pushPeople(albumId)
  const todo = getImagesToScanForFaces(albumId)
  if (todo.length === 0) return pushPeople(albumId)

  log.info(`Finding faces in ${todo.length} photos of ${albumId}`)
  scanning = { albumId, waitingForUploads: false }
  notifyPeopleChanged(albumId)
  let since = 0
  let found = 0
  try {
    await ensureFaceModels() // download failure: abort, retry next session
    for (const img of todo) {
      while (uploadPipeline.isBusy() && !stop()) {
        if (!scanning.waitingForUploads) notifyPeopleChanged(albumId)
        scanning.waitingForUploads = true
        await new Promise((r) => setTimeout(r, UPLOAD_POLL_MS))
      }
      scanning.waitingForUploads = false
      if (stop()) return
      // The original at full quality; the compressed upload copy if the original moved
      const original = join(album.sourceFolderPath, img.originalFilename)
      const path = existsSync(original) ? original : img.localFilePath
      // ponytail: undecodable photos are marked scanned with no faces, never retried
      const faces = existsSync(path)
        ? await detectFaces(path).catch((error) => {
            if (!stop()) log.warn(`Face scan failed for ${img.id}:`, getErrorMessage(error))
            return []
          })
        : []
      if (stop()) return
      saveImageFaces(img.id, faces)
      found += faces.length
      if (++since >= REMATCH_EVERY) {
        since = 0
        rematch(albumId)
        notifyPeopleChanged(albumId)
      }
    }
    rematch(albumId)
    log.info(`Found ${found} faces in ${todo.length} photos of ${albumId}`)
  } finally {
    scanning = null
    notifyPeopleChanged(albumId)
  }
  await pushPeople(albumId)
}

/** Photos of an album were deleted: refresh the server's people if People is on. */
export function peoplePhotosChanged(albumId: string): void {
  if (!getPeopleProgress(albumId).enabled) return
  markPeopleDirty(albumId)
  rematch(albumId) // a deleted photo may have held a person's only reference
  schedulePeoplePush(albumId)
  notifyPeopleChanged(albumId)
}

const PUSH_DEBOUNCE_MS = 2000
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>()
let pushChain: Promise<void> = Promise.resolve()

export function schedulePeoplePush(albumId: string): void {
  clearTimeout(pushTimers.get(albumId))
  pushTimers.set(
    albumId,
    setTimeout(() => {
      pushTimers.delete(albumId)
      pushPeople(albumId).catch((error) =>
        log.warn(`People push for ${albumId} failed (will retry):`, getErrorMessage(error))
      )
    }, PUSH_DEBOUNCE_MS)
  )
}

/** Named, non-hidden people in server ids. complete = false if some photos aren't uploaded yet. */
export function peoplePayload(albumId: string): {
  people: Array<{
    id: string
    name: string
    position: number
    coverImageId: number
    box: Box
    imageIds: number[]
  }>
  complete: boolean
} {
  const album = getAlbum(albumId)
  if (!album?.people_enabled) return { people: [], complete: true }
  const serverId = new Map(getAlbumImages(albumId).map((i) => [i.id, i.serverId]))
  let complete = true
  const people = getAlbumPeople(albumId)
    .filter((p) => !p.hidden)
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((p) => {
      const uploaded = p.faces.filter((f) => serverId.get(f.imageId) != null)
      if (uploaded.length < p.faces.length) complete = false
      if (uploaded.length === 0) return []
      const cover = coverFace({ ...p, faces: uploaded })
      return [
        {
          id: p.id,
          name: p.name,
          coverImageId: serverId.get(cover.imageId)!,
          box: cover.box,
          imageIds: [...new Set(uploaded.map((f) => serverId.get(f.imageId)!))]
        }
      ]
    })
    .map((p, position) => ({ ...p, position }))
  return { people, complete }
}

/** PUT the album's people when dirty. Serialized, so two pushes never race. */
export function pushPeople(albumId: string): Promise<void> {
  const run = async (): Promise<void> => {
    const seen = getAlbum(albumId)?.people_need_push ?? 0
    if (!seen) return
    const { people, complete } = peoplePayload(albumId)
    await albumsApi.putPeople(albumId, people)
    // A change during the PUT bumps the counter, so this no-ops and that change's push follows
    if (complete) clearPeopleNeedPush(albumId, seen)
    log.info(`Pushed ${people.length} people for ${albumId}${complete ? '' : ' (incomplete)'}`)
  }
  const p = pushChain.then(run)
  pushChain = p.catch(() => {})
  return p
}
