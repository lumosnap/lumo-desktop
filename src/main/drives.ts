/**
 * Removable drives: notice them mounting, and find an album's folder again when its drive comes
 * back under another name (/Volumes/NO NAME 1, another Windows letter).
 */
import type { BrowserWindow } from 'electron'
import { watch as fsWatch, type FSWatcher } from 'fs'
import { access, readdir, realpath } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { getConfig } from './config'
import { getAlbum, getAllAlbums, resolvedPath, updateAlbum } from './database'
import { currentUser, forgetDrives, readMacMounts, systemLetter, windowsDrives } from './volumes'
import { folderOwner, folderUser, readManifest, sourcePresent } from './portable'
import { uploadPipeline } from './pipeline'
import { watcherService } from './watcher'
import { checkSourceFolder } from './ipc/sync'
import { samePath } from './ipc/albums'
import { createLogger, getErrorMessage } from './logger'

const logger = createLogger('Drives')

// Probes still pending from an earlier round (a hung network drive): not probed again till done
const hung = new Set<string>()
/** The drive's root answers within 2 s. A hung one counts as absent this round. */
async function rootPresent(root: string): Promise<boolean> {
  if (hung.has(root)) return false
  const probe = access(root).then(
    () => true,
    () => false
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), 2000)))
  const ok = await Promise.race([probe, late])
  clearTimeout(timer)
  if (ok !== null) return ok
  hung.add(root)
  void probe.finally(() => hung.delete(root))
  return false
}

/** Root folder of every mounted removable drive. Never lists inside them. */
export async function mountedRoots(): Promise<string[]> {
  const list = async (base: string): Promise<string[]> =>
    readdir(base).then(
      (names) => names.map((n) => join(base, n)),
      () => []
    )
  if (process.platform === 'darwin') {
    const roots = await list('/Volumes')
    // The startup disk is linked in /Volumes too
    const real = await Promise.all(roots.map((r) => realpath(r).catch(() => r)))
    return roots.filter((_, i) => real[i] !== '/')
  }
  if (process.platform === 'win32') {
    const present: string[] = []
    // One at a time: a hung network drive then holds one libuv thread, not all four
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => l !== systemLetter())) {
      if (await rootPresent(`${l}:\\`)) present.push(`${l}:\\`)
    }
    return present
  }
  // /media/<LABEL> is Debian's layout (no user folder), next to /media/$USER/<LABEL>
  const media = (await list('/media')).filter((r) => basename(r) !== currentUser())
  const nested = await Promise.all(
    [`/media/${currentUser()}`, `/run/media/${currentUser()}`].map(list)
  )
  return [...media, ...nested.flat()]
}

export type RelinkError = 'NOT_FOUND' | 'ADOPTING' | 'BUSY' | 'IN_USE'

/**
 * Point an album at its folder again: the core of album:relink and of auto re-attach.
 * Returns why it didn't, or null once done.
 */
export async function relinkAlbum(
  albumId: string,
  folder: string,
  mainWindow: BrowserWindow
): Promise<RelinkError | null> {
  const album = getAlbum(albumId)
  if (!album) return 'NOT_FOUND'
  if (album.adopting) return 'ADOPTING'
  // The pipeline reads this album's files from its folder as it goes
  if (uploadPipeline.isActive(albumId)) return 'BUSY'
  // Another album stored here whose own card is away does not hold it (folderUser)
  if (folderUser(folder, albumId)) return 'IN_USE'
  // Its manifest names another album here whose own folder is gone: that album's folder
  if (folderOwner(folder, albumId)) return 'IN_USE'
  watcherService.unwatch(albumId)
  updateAlbum(albumId, { sourceFolderPath: folder, isOrphaned: 0 })
  // Re-watches, then flags changes ("Folder changed") or applies pure renames silently
  if (checkSourceFolder(getAlbum(albumId)!)) await watcherService.checkSyncStatus(albumId)
  // Uploads that waited while the folder was missing (exits at once if there are none)
  uploadPipeline.startPipeline(albumId, mainWindow).catch((err) => {
    logger.error(`Pipeline after relink failed for ${albumId}:`, getErrorMessage(err))
  })
  logger.info(`Relinked ${albumId} to ${folder}`)
  return null
}

/**
 * "NO NAME 1" → "NO NAME": macOS mounts a second drive with a taken name so. Comparison only.
 * ponytail: also folds a drive really named "CARD 2" into "CARD"; it only ranks candidates
 */
const baseLabel = (label: string | null | undefined): string | null =>
  label == null ? null : label.replace(/ \d+$/, '')

async function labelOf(root: string): Promise<string | null> {
  if (process.platform !== 'win32') return basename(root)
  return (await windowsDrives())?.get(root[0].toUpperCase())?.label || null
}

/**
 * A drive mounted: every album whose folder is missing looks for its folder at the same place on
 * each mounted drive; one whose manifest names it is a candidate. No missing-photos check: the
 * manifest proves it is the same folder, and any differences show as "Folder changed".
 * Which candidate: the album's drive label known → only a drive with that label ("NO NAME" back
 * as /Volumes/NO NAME 1); a copy on another drive (a backup) is never it. Label unknown (Windows,
 * not read yet) → only while its own drive is away, and only one candidate. Two: the person relinks.
 * Returns true when an album was skipped because it was uploading (look again once it ends).
 */
export async function reattachMoved(mainWindow: BrowserWindow, roots?: string[]): Promise<boolean> {
  if (!getConfig().reattach) return false
  const lost = getAllAlbums().filter((a) => a.isOrphaned && a.volume_path != null && !a.adopting)
  if (lost.length === 0) return false
  forgetDrives() // drives just changed: read their labels again
  const mounted = roots ?? (await mountedRoots())
  const done: Array<{ albumId: string; title: string; folder: string }> = []
  let busy = false
  for (const album of lost) {
    const rel = album.volume_path!.split('/').filter(Boolean)
    const found: Array<{ folder: string; label: string | null }> = []
    for (const root of mounted) {
      const folder = join(root, ...rel)
      if (readManifest(folder)?.manifest.albumId !== album.id || folderUser(folder, album.id))
        continue
      found.push({ folder, label: baseLabel(await labelOf(root)) })
    }
    if (found.length === 0) continue
    const own = baseLabel(album.volume_label)
    // The same resolved path volumeOf took volume_path from
    let ownRoot = resolvedPath(album.sourceFolderPath)
    for (let i = 0; i < rel.length; i++) ownRoot = dirname(ownRoot)
    const fits =
      own != null
        ? found.filter((f) => f.label === own)
        : mounted.some((r) => samePath(r, ownRoot))
          ? [] // its drive is here, the folder moved on it: a copy elsewhere is not it
          : found
    if (fits.length !== 1) {
      logger.info(
        `${album.id} is in ${found.map((f) => f.folder).join(', ')}: not re-attaching (${fits.length} fit)`
      )
      continue
    }
    const folder = fits[0].folder
    // A relink by hand, or the folder coming back, may have settled it meanwhile
    const now = getAlbum(album.id)
    if (!now?.isOrphaned || sourcePresent(now)) continue
    const error = await relinkAlbum(album.id, folder, mainWindow)
    if (error) {
      if (error === 'BUSY') busy = true
      logger.info(`Found ${album.id} at ${folder} but did not re-attach: ${error}`)
      continue
    }
    done.push({ albumId: album.id, title: album.title, folder })
  }
  if (done.length) await fillLabels()
  for (const d of done) {
    if (mainWindow.isDestroyed()) break
    const volumeLabel = getAlbum(d.albumId)?.volume_label ?? null
    mainWindow.webContents.send('album:reattached', { ...d, volumeLabel })
  }
  return busy
}

const labelTried = new Set<string>()

/** Windows: fill volume_label for albums on a present drive that have none. Once per folder. */
export async function fillLabels(): Promise<void> {
  if (process.platform !== 'win32') return
  const want = getAllAlbums().filter(
    (a) =>
      /^[A-Za-z]:/.test(a.sourceFolderPath ?? '') &&
      a.volume_path != null &&
      !a.volume_label &&
      !a.isOrphaned &&
      !labelTried.has(`${a.id}\n${a.sourceFolderPath}`)
  )
  if (want.length === 0) return
  const drives = await windowsDrives()
  if (!drives) return // tried again on the next poll
  for (const a of want) {
    const letter = a.sourceFolderPath[0].toUpperCase()
    if (!drives.has(letter)) continue // mounted after the drives were read
    labelTried.add(`${a.id}\n${a.sourceFolderPath}`)
    const label = drives.get(letter)!.label
    if (label) updateAlbum(a.id, { volume_label: label })
  }
}

const WM_DEVICECHANGE = 0x0219
const DBT_DEVICEARRIVAL = 0x8000
const DBT_DEVICEREMOVECOMPLETE = 0x8004

/** Calls onChange when a drive may have mounted or gone. Returns a stop function. */
export function watchMounts(win: BrowserWindow, onChange: () => void): () => void {
  if (process.platform === 'win32') {
    void windowsDrives()
    win.hookWindowMessage(WM_DEVICECHANGE, (wParam: Buffer) => {
      // WPARAM is pointer-sized: 8 bytes in a 64-bit build
      const event = wParam.length >= 8 ? Number(wParam.readBigUInt64LE(0)) : wParam.readUInt32LE(0)
      if (event !== DBT_DEVICEARRIVAL && event !== DBT_DEVICEREMOVECOMPLETE) return
      forgetDrives()
      void windowsDrives()
      onChange()
    })
    // Fallback (a message missed, a network drive mapped): compare the letters every 30 s
    let last: string | null = null
    let busy = false
    let stopped = false
    const timer = setInterval(async () => {
      if (busy) return
      busy = true
      try {
        const now = (await mountedRoots()).join('|')
        if (stopped) return // closeAll ran while the drives were probed
        if (last !== null && now !== last) {
          forgetDrives()
          onChange()
        }
        last = now
        await fillLabels()
      } catch (error) {
        logger.warn('Drive poll failed:', getErrorMessage(error))
      } finally {
        busy = false
      }
    }, 30_000)
    return () => {
      stopped = true
      clearInterval(timer)
      if (!win.isDestroyed()) win.unhookWindowMessage(WM_DEVICECHANGE)
    }
  }
  // ponytail: Linux watches /media/$USER and /run/media/$USER only if they exist at launch
  const bases =
    process.platform === 'darwin'
      ? ['/Volumes']
      : ['/media', `/media/${currentUser()}`, `/run/media/${currentUser()}`]
  if (process.platform === 'darwin') void readMacMounts()
  const watchers: FSWatcher[] = []
  for (const base of bases) {
    try {
      const w = fsWatch(base, () => {
        if (process.platform === 'darwin') void readMacMounts()
        onChange()
      })
      w.on('error', () => w.close())
      watchers.push(w)
    } catch {
      // not there (or not this platform's layout)
    }
  }
  return () => watchers.forEach((w) => w.close())
}
