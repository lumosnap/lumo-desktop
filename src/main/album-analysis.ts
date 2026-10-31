/**
 * Album analysis: backfills browse signals for images uploaded before they existed,
 * regroups bursts/moments, and pushes changed fields to the server.
 *
 * Everything runs on one serial background queue so it never competes with itself,
 * and nothing here is awaited by the UI or the upload pipeline.
 */

import { BrowserWindow } from 'electron'
import sharp from 'sharp'
import { join, basename, extname } from 'path'
import { existsSync } from 'fs'
import {
  getAlbum,
  getAlbumImages,
  updateImagesBatch,
  listSets,
  clearSetsNeedPush,
  Image
} from './database'
import { albumsApi } from './api-client'
import { groupImages } from './grouping'
import { readExifSignals, thumbnailSignals, ImageSignals } from './image-signals'
import { createLogger, getErrorMessage } from './logger'

const log = createLogger('Analysis')

const BACKFILL_CONCURRENCY = 2
const PATCH_BATCH_SIZE = 100

export function signalsFromRow(img: Image): ImageSignals {
  return {
    capturedAt: img.captured_at ?? null,
    cameraId: img.camera_id ?? null,
    rating: img.rating ?? null,
    phash: img.phash ?? null,
    sharpness: img.sharpness ?? null,
    thumbhash: img.thumbhash ?? null
  }
}

export function signalColumns(s: ImageSignals): Partial<Image> {
  return {
    captured_at: s.capturedAt,
    camera_id: s.cameraId,
    rating: s.rating,
    phash: s.phash,
    sharpness: s.sharpness,
    thumbhash: s.thumbhash
  }
}

let queue: Promise<void> = Promise.resolve()
function enqueue(label: string, job: () => Promise<void>): Promise<void> {
  queue = queue.then(job).catch((error) => {
    log.error(`${label} failed:`, getErrorMessage(error))
  })
  return queue
}

/** Recompute bursts/moments for an album and push what changed. */
export function regroupAlbum(albumId: string): Promise<void> {
  return enqueue(`Regroup ${albumId}`, () => regroupNow(albumId))
}

const analyzedThisSession = new Set<string>()

/** Backfill missing signals, then regroup. Runs once per album per session unless forced. */
export function analyzeAlbum(albumId: string, { force = false } = {}): Promise<void> {
  if (!force && analyzedThisSession.has(albumId)) return Promise.resolve()
  analyzedThisSession.add(albumId)
  return enqueue(`Analyze ${albumId}`, async () => {
    await backfillNow(albumId)
    await regroupNow(albumId)
  })
}

async function backfillNow(albumId: string): Promise<void> {
  const album = getAlbum(albumId)
  if (!album) return

  // phash is always set once an image is analyzed (capturedAt may legitimately stay null)
  const todo = getAlbumImages(albumId).filter((img) => !img.phash)
  if (todo.length === 0) return
  log.info(`Backfilling signals for ${todo.length} images in ${albumId}`)

  let done = 0
  for (let i = 0; i < todo.length; i += BACKFILL_CONCURRENCY) {
    const results = await Promise.all(
      todo.slice(i, i + BACKFILL_CONCURRENCY).map(async (img) => {
        const baseName = basename(img.originalFilename, extname(img.originalFilename))
        const thumbnailPath = join(album.localFolderPath, '.thumbnail', `${baseName}.webp`)
        // No thumbnail yet: the upload pipeline will compute signals when it compresses it
        if (!existsSync(thumbnailPath)) return null
        try {
          const originalPath = join(album.sourceFolderPath, img.originalFilename)
          const exif = existsSync(originalPath)
            ? readExifSignals(await sharp(originalPath).metadata()) // header only, no decode
            : { capturedAt: null, cameraId: null, rating: null }
          const signals = { ...exif, ...(await thumbnailSignals(thumbnailPath)) }
          return { id: img.id, changes: { ...signalColumns(signals), needs_push: 1 } }
        } catch (error) {
          log.warn(`Backfill failed for image ${img.id}:`, getErrorMessage(error))
          return null
        }
      })
    )
    const updates = results.filter((r) => r !== null)
    if (updates.length > 0) updateImagesBatch(updates)
    done += updates.length
    await new Promise((resolve) => setImmediate(resolve)) // stay out of the way
  }
  log.info(`Backfilled ${done}/${todo.length} images in ${albumId}`)
}

async function regroupNow(albumId: string): Promise<void> {
  const rows = getAlbumImages(albumId)
  const groups = groupImages(
    rows.map((r) => ({
      id: r.id,
      filename: r.originalFilename,
      uploadOrder: r.uploadOrder,
      hash: r.sourceFileHash,
      capturedAt: r.captured_at ?? null,
      cameraId: r.camera_id ?? null,
      phash: r.phash ?? null,
      sharpness: r.sharpness ?? null,
      rating: r.rating ?? null
    }))
  )

  const updates: Array<{ id: number; changes: Partial<Image> }> = []
  for (const r of rows) {
    const g = groups.get(r.id)!
    const cover = g.isBurstCover ? 1 : 0
    if (
      (r.burst_id ?? null) !== g.burstId ||
      r.is_burst_cover !== cover ||
      (r.moment_id ?? null) !== g.momentId
    ) {
      updates.push({
        id: r.id,
        changes: {
          burst_id: g.burstId,
          is_burst_cover: cover,
          moment_id: g.momentId,
          needs_push: 1
        }
      })
    }
  }
  if (updates.length > 0) {
    updateImagesBatch(updates) // one transaction
    log.info(`Regrouped ${albumId}: ${updates.length} images changed`)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('album:analyzed', { albumId })
    }
  }

  await pushDirty(albumId)
  await pushSets(albumId) // regroup runs when uploads finish, so newly uploaded set photos go up here
}

const SETS_PUSH_DEBOUNCE_MS = 2000
const setsPushTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Debounced PUT of an album's sets after a local change. */
export function scheduleSetsPush(albumId: string): void {
  clearTimeout(setsPushTimers.get(albumId))
  setsPushTimers.set(
    albumId,
    setTimeout(() => {
      setsPushTimers.delete(albumId)
      enqueue(`Push sets ${albumId}`, () => pushSets(albumId))
    }, SETS_PUSH_DEBOUNCE_MS)
  )
}

/**
 * PUT all sets when the album's sets are dirty. Images without a serverId are left out and the
 * album stays dirty, so a later push (e.g. after uploads finish) includes them.
 */
async function pushSets(albumId: string): Promise<void> {
  const seen = getAlbum(albumId)?.sets_need_push ?? 0
  if (!seen) return
  const serverIds = new Map(getAlbumImages(albumId).map((r) => [r.id, r.serverId]))
  let complete = true
  const toServer = (id: number): number | null => {
    const sid = serverIds.get(id) ?? null
    if (sid == null) complete = false
    return sid
  }
  const sets = listSets(albumId).map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    coverImageId: s.coverImageId == null ? null : toServer(s.coverImageId),
    imageIds: s.imageIds.map(toServer).filter((id): id is number => id != null)
  }))
  await albumsApi.putSets(albumId, sets)
  // A mutation during the PUT bumps the counter, so this no-ops and that one's push follows
  if (complete) clearSetsNeedPush(albumId, seen)
  log.info(
    `Pushed ${sets.length} sets for ${albumId}${complete ? '' : ' (some photos not uploaded yet)'}`
  )
}

/** PATCH rows marked needs_push. Failures stay marked and retry on the next run. */
async function pushDirty(albumId: string): Promise<void> {
  const dirty = getAlbumImages(albumId).filter((r) => r.needs_push && r.serverId != null)
  if (dirty.length === 0) return

  for (let i = 0; i < dirty.length; i += PATCH_BATCH_SIZE) {
    const batch = dirty.slice(i, i + PATCH_BATCH_SIZE)
    await albumsApi.updateImageBrowse(
      albumId,
      batch.map((r) => ({
        id: r.serverId!,
        capturedAt: r.captured_at ?? null,
        burstId: r.burst_id ?? null,
        isBurstCover: r.is_burst_cover === 1,
        momentId: r.moment_id ?? null,
        phash: r.phash ?? null,
        sharpness: r.sharpness ?? null,
        thumbhash: r.thumbhash ?? null
      }))
    )
    updateImagesBatch(batch.map((r) => ({ id: r.id, changes: { needs_push: 0 } })))
  }
  log.info(`Pushed browse fields for ${dirty.length} images in ${albumId}`)
}
