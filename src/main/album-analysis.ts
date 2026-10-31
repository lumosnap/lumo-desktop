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
  getImagesMissingEmbedding,
  getAlbumTags,
  getEmbeddedImageIds,
  getAlbumEmbeddings,
  getAlbumTagSet,
  saveImageEmbeddings,
  saveImageTags,
  setAlbumTagsScored,
  Album,
  Image
} from './database'
import { embedBatch, stopEmbedder, BATCH_SIZE } from './ml/embedder'
import { TAG_MODEL, TAG_SCORING_VERSION, selectAlbumTags, tagLogits } from './tags/select'
import { TAG_PACKS, eventTypeOf } from './tags/vocabulary'
import { uploadPipeline } from './pipeline'
import { albumsApi } from './api-client'
import { groupImages } from './grouping'
import { readExifSignals, thumbnailSignals, ImageSignals } from './image-signals'
import { scanFacesNow } from './people'
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
    tagAlbum(albumId)
  })
}

const thumbnailPathOf = (album: Album, img: Image): string =>
  join(
    album.localFolderPath,
    '.thumbnail',
    `${basename(img.originalFilename, extname(img.originalFilename))}.webp`
  )

function notifyAnalyzed(albumId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('album:analyzed', { albumId })
  }
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
        const thumbnailPath = thumbnailPathOf(album, img)
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
    notifyAnalyzed(albumId)
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
  const dirty = getAlbumImages(albumId).filter(
    (r) => (r.needs_push || r.tags_need_push) && r.serverId != null
  )
  if (dirty.length === 0) return
  const tags = getAlbumTags(albumId)
  const embedded = getEmbeddedImageIds(albumId)

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
        thumbhash: r.thumbhash ?? null,
        // Omitted (not null) until analyzed or edited, so a regroup push never wipes server tags
        tags: embedded.has(r.id) || r.tags_need_push ? (tags.get(r.id) ?? []) : undefined
      }))
    )
    updateImagesBatch(
      batch.map((r) => ({ id: r.id, changes: { needs_push: 0, tags_need_push: 0 } }))
    )
  }
  log.info(`Pushed browse fields for ${dirty.length} images in ${albumId}`)
}

// AI tags. Separate chain from `queue`: an album can take ~40 min, and regroup/sets pushes must
// not wait behind it. DB writes and pushes still go through `queue` so they never interleave.

let tagChain: Promise<void> = Promise.resolve()
const tagQueued = new Set<string>()
const tagCancelled = new Set<string>()
let taggingAlbum: string | null = null
const TAG_PUSH_EVERY = 200 // images between incremental pushes + UI refreshes
const UPLOAD_POLL_MS = 5000

/**
 * Embed + tag images missing embeddings, once uploads are idle, then find faces if the album
 * has People on (same chain, so the two models never run at once). Coalesces repeat calls.
 */
export function tagAlbum(albumId: string): void {
  if (tagQueued.has(albumId)) return
  tagQueued.add(albumId)
  tagCancelled.delete(albumId)
  tagChain = tagChain
    .then(() => {
      tagQueued.delete(albumId) // a call during the run queues one more pass for new images
      return tagNow(albumId)
    })
    .catch((error) => log.error(`Tagging ${albumId} failed:`, getErrorMessage(error)))
    .then(() => scanFacesNow(albumId, () => tagCancelled.has(albumId)))
    .catch((error) => log.error(`People for ${albumId} failed:`, getErrorMessage(error)))
}

/** Stop tagging an album (e.g. it was deleted). Work done so far is kept. */
export function cancelTagging(albumId: string): void {
  tagCancelled.add(albumId)
  if (taggingAlbum === albumId) stopEmbedder()
}

const TAGS_PUSH_DEBOUNCE_MS = 2000
const tagsPushTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Debounced push after a manual tag edit or tag-set change; also refreshes the renderer. */
export function scheduleTagsPush(albumId: string): void {
  notifyAnalyzed(albumId)
  clearTimeout(tagsPushTimers.get(albumId))
  tagsPushTimers.set(
    albumId,
    setTimeout(() => {
      tagsPushTimers.delete(albumId)
      enqueue(`Push tags ${albumId}`, () => pushDirty(albumId))
    }, TAGS_PUSH_DEBOUNCE_MS)
  )
}

/**
 * Recompute an album's AI tags from stored embeddings (no model run). Album-relative, so it
 * runs over the whole album whenever its embedded set, tag set or the scoring version changes.
 * Returns how many photos' tags changed.
 */
export function rescoreAlbum(albumId: string, { force = false } = {}): Promise<number> {
  let changed = 0
  return enqueue(`Rescore ${albumId}`, async () => {
    const album = getAlbum(albumId)
    if (!album) return
    const rows = getAlbumEmbeddings(albumId, TAG_MODEL)
    const tagSet = getAlbumTagSet(albumId)
    const eventType = eventTypeOf(album.event_type)
    const enabled = tagSet ?? TAG_PACKS[eventType]
    const key = `${TAG_SCORING_VERSION}:${TAG_MODEL}:${rows.length}:${rows.reduce((s, r) => s + r.imageId, 0)}:${tagSet?.join() ?? eventType}`
    if (!force && album.tags_scored === key) return
    // ponytail: O(album) on the main thread, ~1s per 5k photos; move to the embedder process if it janks
    const tags = selectAlbumTags(
      rows.map((r) => tagLogits(r.vec)),
      new Set(enabled)
    )
    changed = saveImageTags(rows.map((r, i) => ({ imageId: r.imageId, tags: tags[i] })))
    setAlbumTagsScored(albumId, key)
    if (changed > 0) log.info(`Rescored ${albumId}: ${changed}/${rows.length} images changed`)
  }).then(() => changed)
}

async function tagNow(albumId: string): Promise<void> {
  const album = getAlbum(albumId)
  if (!album || tagCancelled.has(albumId)) return
  const todo = getImagesMissingEmbedding(albumId, TAG_MODEL)
    .map((img) => ({ img, path: thumbnailPathOf(album, img) }))
    .filter((t) => existsSync(t.path)) // no thumbnail yet: the post-upload pass gets it
  if (todo.length > 0) log.info(`Tagging ${todo.length} images in ${albumId}`)

  taggingAlbum = albumId
  let done = 0
  let sinceRescore = 0
  // Album-relative scores: every flush rescores the whole album (cheap, embeddings are stored)
  const flush = async (): Promise<void> => {
    const embedded = sinceRescore
    sinceRescore = 0
    if ((await rescoreAlbum(albumId)) > 0 || embedded > 0) notifyAnalyzed(albumId)
    await enqueue(`Push tags ${albumId}`, () => pushDirty(albumId))
  }
  try {
    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
      // Uploads keep all their CPU and bandwidth: ML only runs between them
      while (uploadPipeline.isBusy() && !tagCancelled.has(albumId)) {
        await new Promise((r) => setTimeout(r, UPLOAD_POLL_MS))
      }
      if (tagCancelled.has(albumId)) return
      const chunk = todo.slice(i, i + BATCH_SIZE)
      const vecs = await embedBatch(chunk.map((t) => t.path))
      // ponytail: undecodable thumbnails stay unembedded and retry next session
      const items = chunk.flatMap(({ img }, k) =>
        vecs[k] ? [{ imageId: img.id, vec: vecs[k] }] : []
      )
      await enqueue(`Save embeddings ${albumId}`, async () => {
        saveImageEmbeddings(TAG_MODEL, items)
      })
      done += items.length
      sinceRescore += items.length
      if (sinceRescore >= TAG_PUSH_EVERY) await flush()
    }
  } catch (error) {
    if (tagCancelled.has(albumId)) return
    throw error
  } finally {
    taggingAlbum = null
    // Also covers albums scored with an older TAG_SCORING_VERSION or with deleted photos
    if (!tagCancelled.has(albumId)) await flush()
    if (todo.length > 0) log.info(`Tagged ${done}/${todo.length} images in ${albumId}`)
  }
}
