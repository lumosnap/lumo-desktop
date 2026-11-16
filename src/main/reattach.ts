/**
 * Re-attach (flag `reattach`): a folder whose .lumosnap names an album from another computer
 * joins that album instead of making a new one. The album online is matched to the files here;
 * nothing is uploaded or pushed until matching finishes (albums.adopting = 1 meanwhile, so a
 * crash resumes from the start of matching, which is idempotent).
 */
import { BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { basename, extname, join } from 'path'
import { albumsApi, type ServerAlbum } from './api-client'
import { getConfig, getStorageLocation } from './config'
import {
  addPulledSets,
  addRemoteImages,
  createAlbum,
  createImagesBatch,
  deleteAlbum,
  deleteImages,
  deleteSet,
  getAlbum,
  getAlbumImages,
  getAllAlbums,
  listSets,
  runInTransaction,
  setRemotePeople,
  updateAlbum,
  type Image
} from './database'
import { hashFile } from './hash'
import { createLogger, getErrorMessage } from './logger'
import { legacyAlbumId, portablePath, readManifest, SNAPSHOT_DIR, writeManifest } from './portable'
import { createAlbumFolder, scanImagesInFolder } from './storage'
import { uploadPipeline } from './pipeline'
import { watcherService } from './watcher'

const log = createLogger('Reattach')

export type FolderMatch =
  | { kind: 'new' } // no snapshot, or the album isn't online (any more): create as today
  | { kind: 'relink'; albumId: string; title: string } // this computer's album, folder missing
  | { kind: 'copy'; albumId: string; title: string } // its album still has its own folder here
  | { kind: 'adopt'; server: ServerAlbum } // an album from another computer

/** The album being adopted is gone online; its local copy was dropped */
export class AdoptionGoneError extends Error {}

/** Thrown when the server can't be asked: never fall back to a new album while offline */
export class ReattachOfflineError extends Error {
  constructor() {
    super("Can't reach LumoSnap to check this folder. Try again when you're online.")
  }
}

/** Which album, if any, the folder's snapshot belongs to (plan Phase 5, steps 1 to 4) */
export async function matchFolder(folder: string): Promise<FolderMatch> {
  if (!getConfig().reattach) return { kind: 'new' }
  const id = readManifest(folder)?.manifest.albumId ?? legacyAlbumId(folder)
  if (!id) return { kind: 'new' }
  const local = getAlbum(id)
  if (local) {
    return existsSync(local.sourceFolderPath)
      ? { kind: 'copy', albumId: id, title: local.title }
      : { kind: 'relink', albumId: id, title: local.title }
  }
  try {
    return { kind: 'adopt', server: await albumsApi.getAlbumWithImages(id) }
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 404 || status === 403) return { kind: 'new' } // deleted, or another account's
    throw new ReattachOfflineError()
  }
}

const stem = (name: string): string => basename(name, extname(name)).normalize('NFC')

/**
 * Match the folder's files to the album online and write the local rows. Order: source hash,
 * then the manifest's serverId for the same path, then the filename stem for server rows
 * without a hash. Matched photos are complete (their preview comes from .lumosnap/previews),
 * unmatched files are new, unmatched server photos are online-only ('remote').
 */
async function matchImages(
  albumId: string,
  server: ServerAlbum
): Promise<{ matched: number; remote: number }> {
  const album = getAlbum(albumId)!
  const folder = album.sourceFolderPath
  const manifest = readManifest(folder)?.manifest
  const byPath = new Map((manifest?.images ?? []).map((i) => [i.path, i.serverId]))
  const byHash = new Map(
    server.images.filter((s) => s.sourceImageHash).map((s) => [s.sourceImageHash!, s])
  )
  const byId = new Map(server.images.map((s) => [s.id, s]))
  const hashless = new Map<string, ServerAlbum['images'][number]>()
  // Two hashless server photos with one name (IMG_1.jpg, IMG_1.png online): match neither by name
  const serverStems = new Map<string, number>()
  for (const s of server.images)
    if (!s.sourceImageHash) {
      const k = stem(s.originalFilename)
      serverStems.set(k, (serverStems.get(k) ?? 0) + 1)
      hashless.set(k, s)
    }
  for (const [k, n] of serverStems) if (n > 1) hashless.delete(k)
  const used = new Set<number>()
  const files = scanImagesInFolder(folder, { useCache: false })
  const rows: Array<Omit<Image, 'id' | 'createdAt'>> = []
  const previews = join(folder, SNAPSHOT_DIR, 'previews')
  const thumbs = join(folder, SNAPSHOT_DIR, 'thumbs')
  mkdirSync(join(album.localFolderPath, '.thumbnail'), { recursive: true })
  let matched = 0

  // Hash every file first, then match in passes so a stronger match is never taken by a weaker
  // one of an earlier file: source hash, then the manifest's id for the path, then the name
  const hashes: Array<string | null> = []
  for (const [index, file] of files.entries()) {
    if (index % 10 === 0) await new Promise((r) => setImmediate(r)) // keep the UI responsive
    try {
      hashes.push(await hashFile(join(folder, file.filename)))
    } catch {
      hashes.push(null) // unreadable: a new photo that fails in the pipeline like any other
    }
  }
  const hits: Array<ServerAlbum['images'][number] | undefined> = files.map(() => undefined)
  const claim = (i: number, s: ServerAlbum['images'][number] | undefined): void => {
    if (!hits[i] && s && !used.has(s.id)) {
      hits[i] = s
      used.add(s.id)
    }
  }
  files.forEach((_, i) => claim(i, hashes[i] ? byHash.get(hashes[i]!) : undefined))
  files.forEach((f, i) => {
    const id = byPath.get(portablePath(f.filename))
    claim(i, id != null ? byId.get(id) : undefined)
  })
  // By name only when one local file has that name (IMG_1.jpg + IMG_1.png: neither)
  const stemCount = new Map<string, number>()
  for (const f of files) stemCount.set(stem(f.filename), (stemCount.get(stem(f.filename)) ?? 0) + 1)
  files.forEach((f, i) => {
    if (stemCount.get(stem(f.filename)) === 1) claim(i, hashless.get(stem(f.filename)))
  })

  for (const [index, file] of files.entries()) {
    const hash = hashes[index]
    const hit = hits[index]
    const base = {
      albumId,
      originalFilename: file.filename,
      fileSize: file.size,
      // A matched photo keeps the size measured when it was compressed; others get it then
      width: hit?.width ?? 0,
      height: hit?.height ?? 0,
      mtime: file.mtime,
      sourceFileHash: hash,
      uploadOrder: hit?.uploadOrder ?? server.images.length + index
    }
    if (!hit) {
      rows.push({
        ...base,
        serverId: null,
        localFilePath: join(album.localFolderPath, file.filename),
        uploadStatus: 'pending'
      })
      continue
    }
    matched++
    // The compressed copy and thumbnail, from the folder's previews (the pipeline's own names)
    const out = join(album.localFolderPath, `${stem(file.filename)}.webp`)
    const thumb = join(album.localFolderPath, '.thumbnail', `${stem(file.filename)}.webp`)
    const p = hash ? join(previews, `${hash}.webp`) : ''
    const t = hash ? join(thumbs, `${hash}.webp`) : ''
    if (hash && existsSync(p) && existsSync(t)) {
      copyFileSync(p, out)
      copyFileSync(t, thumb)
      rows.push({ ...base, serverId: hit.id, localFilePath: out, uploadStatus: 'complete' })
    } else {
      // ponytail: no preview in the folder, so the pipeline compresses it and uploads it again
      // over the same server photo (updateImages keeps its id, favourites and links). Add a
      // compress-only pipeline mode if the bandwidth matters.
      rows.push({
        ...base,
        serverId: hit.id,
        localFilePath: join(album.localFolderPath, file.filename),
        uploadStatus: 'pending'
      })
    }
  }

  runInTransaction(() => {
    // Idempotent: a resumed adoption starts over (nothing was pushed while adopting). Its sets
    // go too, or their members would be lost with the rows and the re-pull would skip them.
    for (const set of listSets(albumId)) deleteSet(set.id)
    const ids = getAlbumImages(albumId).map((i) => i.id)
    if (ids.length) deleteImages(ids)
    if (rows.length) createImagesBatch(rows)
  })
  const remote = addRemoteImages(
    albumId,
    album.localFolderPath,
    server.images.filter((s) => !used.has(s.id))
  )
  return { matched, remote }
}

const inFlight = new Map<string, Promise<{ matched: number; remote: number; total: number }>>()

/** Steps 5 to 7, once at a time per album (startup resume and sign-in can both ask) */
export function finishAdoption(
  albumId: string,
  mainWindow: BrowserWindow | null
): Promise<{ matched: number; remote: number; total: number }> {
  const running = inFlight.get(albumId)
  if (running) return running
  const p = runAdoption(albumId, mainWindow).finally(() => inFlight.delete(albumId))
  inFlight.set(albumId, p)
  return p
}

/** Match photos, pull sets and people with their versions, then go */
async function runAdoption(
  albumId: string,
  mainWindow: BrowserWindow | null
): Promise<{ matched: number; remote: number; total: number }> {
  let server: ServerAlbum
  try {
    server = await albumsApi.getAlbumWithImages(albumId)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status !== 404 && status !== 403) throw error // offline: try again later
    // The album went away online (deleted, or another account's) before matching finished.
    // Nothing was pushed while adopting: drop it here, so the folder can be a new album.
    const album = getAlbum(albumId)
    deleteAlbum(albumId)
    if (album?.localFolderPath) rmSync(album.localFolderPath, { recursive: true, force: true })
    log.info(`Adoption of ${albumId} abandoned: the album is not online (${status})`)
    throw new AdoptionGoneError()
  }
  const { matched, remote } = await matchImages(albumId, server)
  const serverToLocal = new Map(
    getAlbumImages(albumId)
      .filter((i) => i.serverId != null)
      .map((i) => [i.serverId!, i.id])
  )
  const toLocal = (ids: number[]): number[] =>
    ids.map((id) => serverToLocal.get(id)).filter((id): id is number => id != null)
  const { sets, version: setsVersion } = await albumsApi.getSets(albumId)
  addPulledSets(
    albumId,
    sets.map((s) => ({
      ...s,
      coverImageId: s.coverImageId == null ? null : (serverToLocal.get(s.coverImageId) ?? null),
      imageIds: toLocal(s.imageIds)
    }))
  )
  const { people, version: peopleVersion } = await albumsApi.getPeople(albumId)
  setRemotePeople(albumId, people) // no faces here yet: they ride along in pushes unchanged
  updateAlbum(albumId, {
    adopting: 0,
    sets_need_push: 0, // what we hold is what the server has
    sets_version: setsVersion ?? 0,
    people_version: peopleVersion ?? 0,
    totalImages: getAlbumImages(albumId).length
  })
  writeManifest(albumId, true) // the folder now names this album, previews refreshed
  watcherService.watch(albumId, getAlbum(albumId)!.sourceFolderPath)
  uploadPipeline.startPipeline(albumId, mainWindow).catch((error) => {
    log.error(`Pipeline after adoption failed for ${albumId}:`, getErrorMessage(error))
  })
  log.info(`Adopted ${albumId}: ${matched}/${server.images.length} matched, ${remote} online only`)
  return { matched, remote, total: server.images.length }
}

/** Step 5: insert the album with its server id (adopting), then finish */
export async function adopt(
  folder: string,
  server: ServerAlbum,
  albumType: 'watch_folder' | 'standalone',
  mainWindow: BrowserWindow | null
): Promise<{ albumId: string; title: string; matched: number; remote: number; total: number }> {
  const storage = getStorageLocation()
  if (!storage) throw new Error('Storage location not configured')
  createAlbum({
    id: server.id,
    title: server.title,
    eventDate: server.eventDate,
    startTime: null,
    endTime: null,
    localFolderPath: createAlbumFolder(storage, server.id),
    sourceFolderPath: folder,
    albumType,
    totalImages: 0,
    lastSyncedAt: null,
    needsSync: 0,
    isOrphaned: 0,
    adopting: 1
  })
  const r = await finishAdoption(server.id, mainWindow)
  return { albumId: server.id, title: server.title, ...r }
}

/** Startup: an adoption a crash or quit cut short starts its matching again */
export function resumeAdoptions(mainWindow: BrowserWindow | null): void {
  for (const a of getAllAlbums().filter((a) => a.adopting)) {
    finishAdoption(a.id, mainWindow).catch((error) =>
      log.warn(`Adoption of ${a.id} not finished, retrying next launch: ${getErrorMessage(error)}`)
    )
  }
}
