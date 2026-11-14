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
import { createHash, randomBytes } from 'crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  unlinkSync,
  writeSync
} from 'fs'
import { execFile } from 'child_process'
import { basename, extname, join } from 'path'
import { app } from 'electron'
import { getConfig } from './config'
import { getAlbum, getAlbumImages, getAlbumPeople, getAlbumTags, listSets } from './database'
import { createLogger, getErrorMessage } from './logger'

const log = createLogger('Portable')

export const SNAPSHOT_DIR = '.lumosnap'
export const MANIFEST_SCHEMA = 1
const MIN_FREE_FOR_PREVIEWS = 2 * 1024 ** 3

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
  mkdirSync(dir, { recursive: true })
  if (existsSync(moving)) renameSync(moving, join(dir, '.lumosnap-legacy.json'))
  if (process.platform === 'win32') execFile('attrib', ['+h', dir], () => {})
  return dir
}

// Sync clients rewrite and conflict-copy files under them; a snapshot there does more harm
const CLOUD_ROOT =
  /[/\\](Library[/\\]CloudStorage|Mobile Documents|OneDrive|Dropbox|Google Drive)([/\\]|$)/i

export function isCloudSynced(folder: string): boolean {
  return CLOUD_ROOT.test(folder)
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
  let ok = !folder.startsWith('\\\\') // UNC share
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
  // Only a yes is kept: a drive still mounting, or another one at the same path later, gets asked again
  if (ok) writable.set(folder, ok)
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
const validFile = (file: string): boolean => parseChecked(file) !== null

/** Read and check a manifest: the current file, else the .bak. null when neither is valid. */
export function readManifest(folder: string): { manifest: Manifest; readOnly: boolean } | null {
  const dir = join(folder, SNAPSHOT_DIR)
  for (const name of ['manifest.json', 'manifest.json.bak']) {
    const m = parseChecked(join(dir, name))
    // A newer app wrote it: use what we understand, never overwrite it
    if (m) return { manifest: m, readOnly: m.schema > MANIFEST_SCHEMA }
  }
  return null
}

/** Write bytes so a power cut leaves either the old file or the new one, never half of each */
function writeDurable(dir: string, name: string, data: string): void {
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
  if (validFile(target)) renameSync(target, `${target}.bak`)
  renameSync(tmp, target)
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

/** Copy each photo's compressed preview and thumbnail in by hash; drop ones no longer in it */
function syncPreviews(albumId: string, dir: string): void {
  const prev = join(dir, 'previews')
  const thumbs = join(dir, 'thumbs')
  mkdirSync(prev, { recursive: true })
  mkdirSync(thumbs, { recursive: true })
  const keep = new Set<string>()
  let room = true
  try {
    const s = statfsSync(dir)
    room = s.bavail * s.bsize > MIN_FREE_FOR_PREVIEWS
  } catch {
    // unknown free space: copy
  }
  const album = getAlbum(albumId)
  if (!album) return
  for (const img of getAlbumImages(albumId)) {
    if (!img.sourceFileHash || img.uploadStatus !== 'complete') continue
    keep.add(img.sourceFileHash)
    if (!room) continue
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
      if (!existsSync(from)) continue
      // A copy torn by a power cut has the wrong size: copy it again
      if (existsSync(to) && statSync(to).size === statSync(from).size) continue
      try {
        copyFileSync(from, `${to}.tmp`)
        renameSync(`${to}.tmp`, to)
      } catch (error) {
        log.warn(`Preview copy failed for ${from}: ${getErrorMessage(error)}`)
        return // a full or failing drive: stop, the manifest is what matters
      }
    }
  }
  for (const d of [prev, thumbs]) {
    for (const f of readdirSync(d)) {
      if (!keep.has(basename(f, extname(f)))) rmSync(join(d, f), { force: true })
    }
  }
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
    writeDurable(
      dir,
      'manifest.json',
      JSON.stringify({ ...body, checksum: sha256(JSON.stringify(body)) })
    )
    if (!isCloudSynced(folder)) syncPreviews(albumId, dir)
    return true
  } catch (error) {
    log.warn(`Snapshot write failed for ${albumId}: ${getErrorMessage(error)}`)
    return false
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
