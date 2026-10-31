/**
 * People: opt-in per album. Finds faces in the original photos (ML worker, after tagging, only
 * while uploads are idle), groups them into people, and pushes the photographer-named ones.
 * Face vectors never leave this computer: the server only gets names, photo ids and a cover box.
 */
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { basename, extname, join } from 'path'
import {
  applyPeopleAssignment,
  clearPeopleNeedPush,
  getAlbum,
  getAlbumImages,
  getAlbumPeople,
  getFacesToCluster,
  getImagesToScanForFaces,
  getPeopleProgress,
  markPeopleDirty,
  saveImageFaces,
  setPeopleEnabled as dbSetPeopleEnabled,
  type FaceRow,
  type PersonRow
} from './database'
import { clusterInWorker, detectFaces, isMlPaused } from './ml/embedder'
import { ensureFaceModels } from './ml/model'
import { frontalness } from './ml/faces'
import { assignPeople, CLUSTER_THRESHOLD, FACE_DIM } from './people-cluster'
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
}
export interface PersonSummary {
  id: string
  name: string | null
  hidden: boolean
  photoCount: number
  cover: { imageId: number; path: string; box: Box }
}

let scanning: { albumId: string; waitingForUploads: boolean } | null = null
const clusteredThisSession = new Set<string>()

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
  return { enabled, state, processed, total }
}

/** Off deletes all face data now and empties the server's people (debounced, retried). */
export function setPeopleEnabled(albumId: string, enabled: boolean): PeopleConfig {
  if (!getAlbum(albumId)) throw new Error('Album not found')
  dbSetPeopleEnabled(albumId, enabled)
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

/** Named first (by name), then unnamed by photo count. */
export function listPeople(albumId: string): PersonSummary[] {
  const album = getAlbum(albumId)
  if (!album) return []
  const images = new Map(getAlbumImages(albumId).map((i) => [i.id, i]))
  const people = getAlbumPeople(albumId).map((p) => {
    const cover = coverFace(p)
    const img = images.get(cover.imageId)!
    const thumb = thumbnailPath(album.localFolderPath, img.originalFilename)
    return {
      id: p.id,
      name: p.name,
      hidden: p.hidden,
      photoCount: new Set(p.faces.map((f) => f.imageId)).size,
      cover: {
        imageId: cover.imageId,
        path: existsSync(thumb) ? thumb : img.localFilePath,
        box: cover.box
      }
    }
  })
  return people.sort((a, b) =>
    a.name != null && b.name != null
      ? a.name.localeCompare(b.name)
      : a.name != null
        ? -1
        : b.name != null
          ? 1
          : b.photoCount - a.photoCount
  )
}

/** Person ids (shown people only, hidden included) per local image id. */
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

/** Re-cluster the album's faces (heavy part in the worker) and keep named people stable. */
export async function reclusterAlbum(albumId: string): Promise<void> {
  const faces = getFacesToCluster(albumId)
  const vecs = new Float32Array(faces.length * FACE_DIM)
  faces.forEach((f, i) => vecs.set(f.vec, i * FACE_DIM))
  const labels = faces.length > 1 ? await clusterInWorker(vecs, CLUSTER_THRESHOLD) : [0]
  const byFace = new Map(faces.map((f, i) => [f.id, labels[i]]))
  const changed = applyPeopleAssignment(albumId, (all, persons) =>
    assignPeople(all, byFace, persons, randomUUID)
  )
  if (changed > 0) {
    log.info(`Re-clustered ${albumId}: ${changed} faces changed person`)
    schedulePeoplePush(albumId)
  }
  notifyPeopleChanged(albumId)
}

const UPLOAD_POLL_MS = 5000
// Interim re-clusters + UI refreshes every 100 photos, or every +25% so big albums stay O(final)
const RECLUSTER_EVERY = 100

/**
 * Detect faces in the album's unscanned photos, then re-cluster. Runs on the tagging chain
 * (after tagging), so it never competes with SigLIP. Also retries a pending people push.
 */
export async function scanFacesNow(albumId: string, cancelled: () => boolean): Promise<void> {
  const album = getAlbum(albumId)
  const stop = (): boolean => cancelled() || !getPeopleProgress(albumId).enabled
  if (!album) return
  if (album.people_enabled !== 1 || cancelled()) return pushPeople(albumId)
  const todo = getImagesToScanForFaces(albumId)
  if (todo.length === 0) {
    // Once per session: covers faces saved by a scan that was interrupted before re-clustering
    if (!clusteredThisSession.has(albumId)) await reclusterAlbum(albumId)
    clusteredThisSession.add(albumId)
    return pushPeople(albumId)
  }

  log.info(`Finding faces in ${todo.length} photos of ${albumId}`)
  scanning = { albumId, waitingForUploads: false }
  notifyPeopleChanged(albumId)
  const { total } = getPeopleProgress(albumId)
  let since = 0
  let done = 0
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
      done++
      if (++since >= Math.max(RECLUSTER_EVERY, (total - todo.length + done) / 4)) {
        since = 0
        await reclusterAlbum(albumId)
      } else if (since % 10 === 0) notifyPeopleChanged(albumId) // progress
    }
    await reclusterAlbum(albumId)
    clusteredThisSession.add(albumId)
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
    .filter((p) => p.name != null && !p.hidden)
    .sort((a, b) => a.name!.localeCompare(b.name!))
    .flatMap((p) => {
      const uploaded = p.faces.filter((f) => serverId.get(f.imageId) != null)
      if (uploaded.length < p.faces.length) complete = false
      if (uploaded.length === 0) return []
      const cover = coverFace({ ...p, faces: uploaded })
      return [
        {
          id: p.id,
          name: p.name!,
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
