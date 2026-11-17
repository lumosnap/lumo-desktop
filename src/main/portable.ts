/**
 * Portable snapshot: <album>/.lumosnap/ carries enough for another computer to re-attach the
 * folder to its album and show previews without this computer. The local DB stays the source of
 * truth; the snapshot is a best-effort copy and every read checks it.
 *
 *   .lumosnap/manifest.json      the snapshot (checksummed)
 *   .lumosnap/manifest.json.bak  the one before it, for a write torn by a pulled cable
 *   .lumosnap/previews/<hash>.webp, thumbs/<hash>.webp
 *   .lumosnap/.lumosnap-legacy.json   the old single-file .lumosnap, moved here
 */
import { createHash, randomBytes, randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  statfsSync,
  unlinkSync,
  writeSync
} from 'fs'
import { copyFile, mkdir, readdir, rename, rm, stat, statfs } from 'fs/promises'
import { execFile } from 'child_process'
import { basename, dirname, extname, join, resolve } from 'path'
import { app } from 'electron'
import { getConfig } from './config'
import {
  getAlbum,
  getAlbumImages,
  getAlbumPeople,
  getAlbumTags,
  getAllAlbums,
  listSets,
  resolvedPath,
  updateAlbum,
  volumeOf
} from './database'
import type { Album } from './database'
import { drivesKnown, isNetworkDrive, isRemovableVolume } from './volumes'
import { createLogger, getErrorMessage } from './logger'

const log = createLogger('Portable')

export const SNAPSHOT_DIR = '.lumosnap'
export const MANIFEST_SCHEMA = 1
const MIN_FREE_FOR_PREVIEWS = 2 * 1024 ** 3
const REMOVABLE_KEEP_FREE = 0.25 // and on a card, never fill past 75%: the camera needs room

export interface Manifest {
  schema: number
  albumId: string
  writtenAt: string
  app: string
  images: Array<{ path: string; hash: string | null; serverId: number | null; tags: string[] }>
  sets: Array<{
    id: string
    name: string
    position: number
    coverHash: string | null
    imageHashes: string[]
  }>
  setsVersion: number
  people: Array<{ id: string; name: string; imageHashes: string[] }>
  peopleVersion: number
}

/** Names compare in NFC: macOS can hand back NFD names from exFAT */
export const portablePath = (name: string): string => name.split('\\').join('/').normalize('NFC')

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

/** The old .lumosnap single file's album id, wherever it sits now */
export function legacyAlbumId(folder: string): string | null {
  for (const p of [
    join(folder, SNAPSHOT_DIR),
    join(folder, LEGACY_MOVING),
    join(folder, SNAPSHOT_DIR, '.lumosnap-legacy.json')
  ]) {
    try {
      if (!statSync(p).isFile()) continue
      const id = JSON.parse(readFileSync(p, 'utf-8')).albumId
      if (typeof id === 'string' && id) return id
    } catch {
      // missing or unreadable: try the next place
    }
  }
  return null
}

// Where the old file waits while .lumosnap becomes a directory (a fixed name, so a crash
// in between still finds it)
const LEGACY_MOVING = '.lumosnap-legacy.json'

/** Make .lumosnap a directory; an old .lumosnap file moves inside it, id intact */
export function ensureDir(folder: string): string {
  const dir = join(folder, SNAPSHOT_DIR)
  const moving = join(folder, LEGACY_MOVING)
  if (existsSync(dir) && statSync(dir).isFile()) renameSync(dir, moving)
  const made = mkdirSync(dir, { recursive: true }) // the path when it created it
  if (existsSync(moving)) renameSync(moving, join(dir, '.lumosnap-legacy.json'))
  // Hide it once, when made; a console window per call would flash on every write
  if (made && process.platform === 'win32') {
    execFile('attrib', ['+h', dir], { windowsHide: true }, () => {})
  }
  return dir
}

// Sync clients rewrite and conflict-copy files under them; a snapshot there does more harm
const CLOUD_ROOT =
  /[/\\](OneDrive( - [^/\\]+)?|Dropbox( \([^)]*\))?|My Drive|Google Drive|iCloudDrive|com~apple~CloudDocs|Library[/\\]Mobile Documents|Library[/\\]CloudStorage)([/\\]|$)/i

/**
 * Under a sync client's folder (manifest only there, no previews). The real path too, for a link
 * into one. ponytail: macOS "Desktop & Documents in iCloud" keeps ~/Documents at its own path, so
 * it reads as local; check the com.apple.bird state if previews there cause conflict copies.
 */
export function isCloudSynced(folder: string): boolean {
  if (CLOUD_ROOT.test(folder)) return true
  try {
    return CLOUD_ROOT.test(realpathSync.native(folder))
  } catch {
    return false
  }
}

const writable = new Map<string, boolean>()
const loggedNo = new Set<string>()
/**
 * Can we write the snapshot here? False for read-only volumes (NTFS on a Mac), permission
 * errors and network shares. A yes is kept for the session; a no is asked again next time
 * (a drive may still be mounting) and logged once.
 */
export function probeWritable(folder: string): boolean {
  if (writable.get(folder)) return true
  let ok = !folder.startsWith('\\\\') && !isNetworkDrive(folder) // UNC share, mapped drive, SMB mount
  if (ok) {
    try {
      // statfs type: smbfs / nfs / afpfs on macOS report as network (best effort)
      const t = statfsSync(folder).type
      if ([0x517b, 0x6969, 0xfe534d42].includes(t)) ok = false // SMB, NFS, SMB2 (Linux magic)
    } catch {
      // statfs not supported: fall through to the probe
    }
  }
  if (ok) {
    try {
      const probe = join(ensureDir(folder), `.probe-${randomBytes(4).toString('hex')}`)
      closeSync(openSync(probe, 'w'))
      unlinkSync(probe)
    } catch (error) {
      ok = false
      if (!loggedNo.has(folder)) log.info(`No snapshot for ${folder}: ${getErrorMessage(error)}`)
      loggedNo.add(folder)
    }
  }
  // Only a yes is kept: a drive still mounting, or another one at the same path later, gets asked
  // again. Windows: not before the drive types are read (a mapped share reads as local till then)
  if (ok && (process.platform !== 'win32' || drivesKnown())) writable.set(folder, ok)
  return ok
}

function parseChecked(file: string): Manifest | null {
  try {
    const { checksum, ...body } = JSON.parse(readFileSync(file, 'utf-8'))
    if (checksum !== sha256(JSON.stringify(body))) return null
    if (typeof body.albumId !== 'string' || typeof body.schema !== 'number') return null
    return body as Manifest
  } catch {
    return null // missing, torn or not JSON
  }
}

/**
 * Read and check a manifest: the current file, else the .bak. null when neither is valid.
 * `current`: it came from manifest.json itself (so that file is whole).
 */
export function readManifest(
  folder: string
): { manifest: Manifest; readOnly: boolean; current: boolean } | null {
  const dir = join(folder, SNAPSHOT_DIR)
  for (const name of ['manifest.json', 'manifest.json.bak']) {
    const m = parseChecked(join(dir, name))
    // A newer app wrote it: use what we understand, never overwrite it
    if (m) {
      return {
        manifest: m,
        readOnly: m.schema > MANIFEST_SCHEMA,
        current: name === 'manifest.json'
      }
    }
  }
  return null
}

/** Windows: antivirus or the indexer can hold a file just written; one short retry */
function renameRetry(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EBUSY') throw error
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
    renameSync(from, to)
  }
}

/**
 * Write bytes so a power cut leaves either the old file or the new one, never half of each.
 * `currentValid`: the file there now checked out (the caller already read it).
 */
function writeDurable(dir: string, name: string, data: string, currentValid: boolean): void {
  const target = join(dir, name)
  const tmp = `${target}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  // The current file becomes the .bak by rename (never copied over it), and only if it is valid:
  // a torn current must not replace a good .bak. Between the two renames readers find the .bak.
  if (currentValid) renameRetry(target, `${target}.bak`)
  renameRetry(tmp, target)
  if (process.platform !== 'win32') {
    const dfd = openSync(dir, 'r')
    try {
      fsyncSync(dfd)
    } finally {
      closeSync(dfd)
    }
  }
}

export function buildManifest(albumId: string): Manifest | null {
  const album = getAlbum(albumId)
  if (!album) return null
  // Online-only photos aren't in this folder: a path for them would match a stranger's file
  const images = getAlbumImages(albumId).filter((i) => i.uploadStatus !== 'remote')
  const tags = getAlbumTags(albumId)
  const hashOf = new Map(images.map((i) => [i.id, i.sourceFileHash]))
  const hashes = (ids: number[]): string[] =>
    ids.map((id) => hashOf.get(id)).filter((h): h is string => !!h)
  return {
    schema: MANIFEST_SCHEMA,
    albumId,
    writtenAt: new Date().toISOString(),
    app: app.getVersion(),
    images: images.map((i) => ({
      path: portablePath(i.originalFilename),
      hash: i.sourceFileHash,
      serverId: i.serverId,
      tags: tags.get(i.id) ?? []
    })),
    sets: listSets(albumId).map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      coverHash: s.coverImageId == null ? null : (hashOf.get(s.coverImageId) ?? null),
      imageHashes: hashes(s.imageIds)
    })),
    setsVersion: album.sets_version ?? 0,
    people: getAlbumPeople(albumId)
      .filter((p) => !p.hidden && p.name)
      .map((p) => ({
        id: p.id,
        name: p.name,
        imageHashes: [...new Set(hashes(p.faces.map((f) => f.imageId)))]
      })),
    peopleVersion: album.people_version ?? 0
  }
}

/**
 * Copy each photo's compressed preview and thumbnail in by hash; drop ones no longer in it.
 * One file at a time, yielding between them. Stops before the drive's free space drops below
 * MIN_FREE_FOR_PREVIEWS, or on a removable card below a quarter of its size (the manifest is
 * what matters). A file the OS won't let us write (EPERM/EBUSY/EACCES) is skipped; a full or
 * failing drive (ENOSPC/EIO), or the folder going, stops the run.
 * ponytail: previews/ is one flat folder; FAT32 caps a folder near 9k long names, so a huge
 * album on a FAT32 card stops copying there. Shard by hash prefix if that shows up.
 * ponytail: Windows "Safely remove" fails while a copy holds a file open on the card; the run is
 * cancelled only on the device event after removal. Cancel on DBT_DEVICEQUERYREMOVE if it bites.
 */
async function syncPreviews(albumId: string, dir: string): Promise<void> {
  const gen = cancelGen
  const prev = join(dir, 'previews')
  const thumbs = join(dir, 'thumbs')
  await mkdir(prev, { recursive: true })
  await mkdir(thumbs, { recursive: true })
  const keep = new Set<string>()
  const removable = isRemovableVolume(dir)
  let free = Infinity // unknown free space: copy
  let floor = MIN_FREE_FOR_PREVIEWS
  const readFree = async (): Promise<void> => {
    try {
      const s = await statfs(dir)
      free = s.bavail * s.bsize
      if (removable) floor = Math.max(floor, s.blocks * s.bsize * REMOVABLE_KEEP_FREE)
    } catch {
      // statfs not supported here
    }
  }
  const size = (p: string): Promise<number | null> =>
    stat(p).then(
      (s) => s.size,
      () => null
    )
  const album = getAlbum(albumId)
  if (!album) return
  log.info(`Previews for ${albumId} started`)
  let copied = 0
  let skipped = 0
  let copying = true
  let stopped = ''
  for (const img of getAlbumImages(albumId)) {
    if (!img.sourceFileHash || img.uploadStatus !== 'complete') continue
    keep.add(img.sourceFileHash)
    if (!copying) continue
    await new Promise((r) => setImmediate(r)) // never hold the main process for a whole album
    if (gen !== cancelGen) {
      cancelled.add(albumId)
      log.info(`Previews for ${albumId} cancelled: ${copied} copied, ${skipped} skipped`)
      return // the keep list is partial: no clean-up
    }
    // The pipeline's own output names (pipeline compressImageTask), not localFilePath: a renamed
    // photo's localFilePath can name the raw source copy
    const stem = basename(img.originalFilename, extname(img.originalFilename))
    const pairs: Array<[string, string]> = [
      [join(album.localFolderPath, `${stem}.webp`), join(prev, `${img.sourceFileHash}.webp`)],
      [
        join(album.localFolderPath, '.thumbnail', `${stem}.webp`),
        join(thumbs, `${img.sourceFileHash}.webp`)
      ]
    ]
    for (const [from, to] of pairs) {
      const need = await size(from)
      if (need == null) continue
      // A copy torn by a power cut has the wrong size: copy it again
      if ((await size(to)) === need) continue
      if ((copied + skipped) % 100 === 0) await readFree() // other writers use the drive too
      if (free - need < floor) {
        stopped = 'the drive is nearly full'
        copying = false
        break
      }
      try {
        await copyFile(from, `${to}.tmp`)
        await rename(`${to}.tmp`, to)
        free -= need
        copied++
      } catch (error) {
        await rm(`${to}.tmp`, { force: true }).catch(() => {})
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOSPC' || code === 'EIO' || !existsSync(dir)) {
          log.warn(`Previews for ${albumId} stopped at ${from}: ${getErrorMessage(error)}`)
          return // a full, failing or pulled drive: stop, the manifest is what matters
        }
        skipped++ // locked or refused (antivirus, permissions): the next one may go
        log.warn(`Preview copy skipped for ${from}: ${getErrorMessage(error)}`)
      }
    }
  }
  for (const d of [prev, thumbs]) {
    for (const f of await readdir(d)) {
      if (!keep.has(basename(f, extname(f)))) await rm(join(d, f), { force: true }).catch(() => {})
    }
  }
  log.info(
    `Previews for ${albumId} done: ${copied} copied, ${skipped} skipped${stopped && `, stopped: ${stopped}`}`
  )
}

let cancelGen = 0
const cancelled = new Set<string>() // albums whose run cancelPreviews cut short
/** Stop the running preview run before its next file (a drive came or went). Queued runs still go. */
export function cancelPreviews(): void {
  cancelGen++
}
/** After the drives settle: a run cut short goes again if its album's folder is still here */
export function resumePreviews(): void {
  for (const id of cancelled) {
    cancelled.delete(id)
    const album = getAlbum(id)
    if (album && getConfig().portableSnapshot && sourcePresent(album)) writeManifest(id)
  }
}

// ponytail: one preview run app-wide (one disk at a time is gentler on cards and USB hubs);
// per-drive queues if several drives' albums wait on each other too long
let previewChain: Promise<void> = Promise.resolve()
const previewRuns = new Map<string, Promise<void>>() // album id → its queued or running run
const previewAgain = new Map<string, string>() // album id → snapshot dir, still to do
/** Queue the album's preview run; asked again before it ends, it runs once more after */
function kickPreviews(albumId: string, dir: string): void {
  previewAgain.set(albumId, dir)
  if (previewRuns.has(albumId)) return
  const run = async (): Promise<void> => {
    try {
      for (let d = previewAgain.get(albumId); d; d = previewAgain.get(albumId)) {
        previewAgain.delete(albumId)
        await syncPreviews(albumId, d)
      }
    } catch (error) {
      log.warn(`Previews failed for ${albumId}: ${getErrorMessage(error)}`)
    } finally {
      previewRuns.delete(albumId) // same tick as the last check above: no ask is lost
    }
  }
  previewChain = previewChain.then(run) // run never rejects
  previewRuns.set(albumId, previewChain)
}

/** Resolves once the album's preview copying (if any) has finished. Tests and callers that wait. */
export function previewsSettled(albumId: string): Promise<void> {
  return previewRuns.get(albumId) ?? Promise.resolve()
}

/**
 * The album id a folder's manifest names, from its first bytes (writeDurable puts albumId
 * second). No checksum: a torn file is cut at its tail, and this runs on every folder check.
 */
export function manifestAlbumId(folder: string): string | null {
  let fd: number | undefined
  try {
    fd = openSync(join(folder, SNAPSHOT_DIR, 'manifest.json'), 'r')
    const buf = Buffer.alloc(512)
    const n = readSync(fd, buf, 0, buf.length, 0)
    return buf.toString('utf-8', 0, n).match(/"albumId":"([^"]+)"/)?.[1] ?? null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// Same as ipc/albums samePath (not imported: albums.ts pulls in most of the app)
const realOr = (p: string): string => {
  try {
    return realpathSync.native(p)
  } catch {
    return resolve(p)
  }
}
const samePath = (a: string, b: string): boolean =>
  process.platform === 'linux'
    ? realOr(a) === realOr(b)
    : realOr(a).toLowerCase() === realOr(b).toLowerCase()

/**
 * The id of another album that this folder belongs to, else null. The folder's manifest names
 * album X:
 * - X's own folder is gone: X's card is mounted where this album's was → X's.
 * - X's folder is elsewhere and there: a copy whose new manifest couldn't be written → shared.
 * - X stored this same path (two "NO NAME" cards; or one folder made into two albums before
 *   manifests): this album's own photos decide. Half of a sample of them here → shared, else X's.
 * - X is not on this computer (another computer's card): X's only when none of this album's
 *   hashed photos is in the manifest, and it has some; else shared.
 * - The folder can't be written (read-only card, network share): path only, as before manifests.
 *   A manifest there may be stale, never rewritten for a copied album.
 * ponytail: the sample is a heuristic; a card whose names happen to match (IMG_0001.jpg on both)
 * reads as shared. The per-album sync review and the mass-delete gate still stand behind it.
 * ponytail: the manifest on a mapped network root is read synchronously here, on every
 * folder check; a slow share stalls the main process. Read it async if that shows up.
 */
export function folderOwner(folder: string, albumId: string): string | null {
  const named = manifestAlbumId(folder)
  if (!named || named === albumId) return null
  // A network share can't be trusted to hold an up-to-date snapshot (another computer writes
  // there): path only. A write-locked SD card's snapshot is real (written while unlocked): kept.
  // ponytail: a copy made into a new album on a locked card keeps naming the original, so it
  // reads missing while the original's drive is away; unlock and sync once to fix it
  if (folder.startsWith('\\\\') || isNetworkDrive(folder)) return null
  const other = getAlbum(named)
  if (!other) {
    const hashes = getAlbumImages(albumId)
      .filter((i) => i.uploadStatus !== 'remote' && i.sourceFileHash)
      .map((i) => i.sourceFileHash!)
    if (!hashes.length) return null
    const m = readManifest(folder)?.manifest // rare: the whole file only here
    if (m?.albumId !== named) return null
    const theirs = new Set(m.images.map((i) => i.hash))
    return hashes.some((h) => theirs.has(h)) ? null : named
  }
  const own = other.sourceFolderPath
  if (!own || !existsSync(own)) return named
  if (!samePath(own, folder)) return null
  const rows = getAlbumImages(albumId).filter((i) => i.uploadStatus !== 'remote')
  // No photos of its own to check: the folder is X's (worst case an empty album reads missing)
  if (!rows.length) return named
  const n = Math.min(20, rows.length)
  const sample = Array.from({ length: n }, (_, k) => rows[Math.floor((k * rows.length) / n)])
  const here = sample.filter((i) => existsSync(join(folder, i.originalFilename))).length
  return here * 2 >= n ? null : named
}

/**
 * Another album that uses this folder: it stored this path, and the folder is not someone else's
 * (its own card away, another card here: see folderOwner).
 * ponytail: two cards both labelled "NO NAME" are told apart by manifest only; Windows'
 * VolumeSerialNumber would tell empty-label cards apart too, if manifests aren't enough.
 */
export function folderUser(folder: string, albumId?: string): Album | undefined {
  return getAllAlbums().find(
    (a) =>
      a.id !== albumId &&
      !!a.sourceFolderPath &&
      samePath(a.sourceFolderPath, folder) &&
      folderOwner(folder, a.id) === null
  )
}

/** The album's folder is there and no other album's (see folderOwner) */
export function sourcePresent(album: Pick<Album, 'id' | 'sourceFolderPath'>): boolean {
  if (!album.sourceFolderPath || !existsSync(album.sourceFolderPath)) return false
  return folderOwner(album.sourceFolderPath, album.id) === null
}

/**
 * Write the album's snapshot now. Returns false when it was skipped or failed.
 * A manifest naming another album that still lives on this computer, with its folder there, is
 * never overwritten (an on-disk copy: re-attach decides, then passes `force`).
 */
export function writeManifest(albumId: string, force = false): boolean {
  const album = getAlbum(albumId)
  const folder = album?.sourceFolderPath
  if (!album || !folder || !existsSync(folder) || !probeWritable(folder)) return false
  // Another album's card at this album's path (its own card away): never write over it.
  // force is an explicit "this folder is this album's now" (create, re-attach)
  if (!force && !sourcePresent(album)) return false
  try {
    const dir = ensureDir(folder)
    const existing = readManifest(folder)
    if (existing?.readOnly) return false // written by a newer app
    // The first album keeps the folder: two albums writing here would undo each other
    const other =
      existing && existing.manifest.albumId !== albumId && getAlbum(existing.manifest.albumId)
    if (!force && other && existsSync(other.sourceFolderPath)) return false
    const body = buildManifest(albumId)
    if (!body) return false
    // ponytail: built, hashed and written synchronously on the main process; ~2 MB and tens of
    // ms at 10k photos. Move to a worker if albums reach 100k.
    writeDurable(
      dir,
      'manifest.json',
      JSON.stringify({ ...body, checksum: sha256(JSON.stringify(body)) }),
      !!existing?.current
    )
    if (!isCloudSynced(folder)) kickPreviews(albumId, dir) // not awaited: the manifest is written
    noteOnDrive(albumId)
    return true
  } catch (error) {
    log.warn(`Snapshot write failed for ${albumId}: ${getErrorMessage(error)}`)
    return false
  }
}

export interface DriveIndex {
  schema: number
  driveId: string
  albums: Record<string, string> // album id → its folder from the drive root, as volume_path
}
const DRIVE_INDEX = 'drive.json'

function parseIndex(file: string): DriveIndex | null {
  try {
    const d = JSON.parse(readFileSync(file, 'utf-8'))
    const albums = d?.albums
    if (typeof d?.schema !== 'number' || typeof d.driveId !== 'string' || !d.driveId) return null
    const ok =
      !!albums &&
      typeof albums === 'object' &&
      !Array.isArray(albums) &&
      Object.values(albums).every((v) => typeof v === 'string')
    // A newer app's file: its id counts, its albums only if they read as ours (never rewritten)
    if (d.schema > 1) return { ...d, albums: ok ? albums : {} }
    return ok ? (d as DriveIndex) : null
  } catch {
    return null // missing, torn or not JSON
  }
}

/** The drive's index at its root: drive.json, else its .bak. null when neither is valid. */
export function readDriveIndex(root: string): DriveIndex | null {
  const file = join(root, SNAPSHOT_DIR, DRIVE_INDEX)
  return parseIndex(file) ?? parseIndex(`${file}.bak`)
}

/** An index entry (or volume_path) as a folder under the drive's root */
export const folderOnDrive = (root: string, rel: string): string =>
  join(root, ...rel.split('/').filter((s) => s && s !== '..')) // never off the drive

/**
 * The root of the drive the album's folder is on: its resolved path less volume_path's
 * segments (the same path volumeOf took volume_path from). null on the internal disk.
 */
export function driveRootOf(album: Pick<Album, 'sourceFolderPath' | 'volume_path'>): string | null {
  if (album.volume_path == null || !album.sourceFolderPath) return null
  let root = resolvedPath(album.sourceFolderPath)
  for (let n = album.volume_path.split('/').filter(Boolean).length; n > 0; n--) root = dirname(root)
  return root
}

/**
 * Record the album in its drive's index (made with a new driveId if none), drop entries whose
 * folder is gone, and keep the driveId in volume_id. Written only when it changed (cards).
 * Never throws. Sync on purpose: two albums noted back to back can't interleave.
 * ponytail: a cloned drive keeps the same driveId; re-attach then refuses to pick (drives.ts).
 * Re-roll the id on a clash if cloning turns out common.
 * ponytail: macOS reads its network mounts just after launch; an SMB share under /Volumes noted
 * in that first second gets an index (as writeManifest writes there). Await readMacMounts if seen.
 */
export function noteOnDrive(albumId: string): void {
  if (!getConfig().portableSnapshot) return
  const album = getAlbum(albumId)
  // Its path still leads to the drive it was stored on: a link retargeted to the home folder or
  // C:\ would make driveRootOf strip the wrong segments
  const v = album?.sourceFolderPath ? volumeOf(album.sourceFolderPath) : null
  const root = album && v && v.path === album.volume_path ? driveRootOf(album) : null
  // Windows: a mapped network letter reads as local until the drive types are read
  if (!album || !root || (process.platform === 'win32' && !drivesKnown())) return
  try {
    // read-only, locked card, network, a sync client's folder
    if (!existsSync(root) || isCloudSynced(root) || !probeWritable(root)) return
    const file = join(root, SNAPSHOT_DIR, DRIVE_INDEX)
    const current = parseIndex(file)
    const had = current ?? parseIndex(`${file}.bak`)
    // There but unreadable (locked, failing, not ours): a new id would split the drive in two
    if (!had && (existsSync(file) || existsSync(`${file}.bak`))) {
      log.warn(`Drive index at ${root} unreadable: left alone`)
      return
    }
    const index: DriveIndex = had ?? { schema: 1, driveId: randomUUID(), albums: {} }
    if (index.schema <= 1) {
      const before = JSON.stringify(index)
      for (const [id, rel] of Object.entries(index.albums)) {
        if (!existsSync(folderOnDrive(root, rel))) delete index.albums[id]
      }
      index.albums[albumId] = album.volume_path!
      const after = JSON.stringify(index)
      if (!had || after !== before) writeDurable(ensureDir(root), DRIVE_INDEX, after, !!current)
    } // else written by a newer app: its id is used, the file left alone
    if (album.volume_id !== index.driveId) updateAlbum(albumId, { volume_id: index.driveId })
  } catch (error) {
    log.warn(`Drive index not written for ${albumId}: ${getErrorMessage(error)}`)
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** After a sync or a sets/people push: write the snapshot 5 s later (flag portableSnapshot) */
export function scheduleManifest(albumId: string): void {
  if (!getConfig().portableSnapshot) return
  clearTimeout(timers.get(albumId))
  timers.set(
    albumId,
    setTimeout(() => {
      timers.delete(albumId)
      writeManifest(albumId)
    }, 5000)
  )
}
