import { updateAlbum, getAllAlbums, getAlbum } from './database'
import { checkSourceFolder, detectAlbumChanges, executeAlbumSync } from './ipc/sync'
import { clearScanCache, IMAGE_EXTENSIONS } from './storage'
import { BrowserWindow } from 'electron'
import { existsSync, watch as fsWatch } from 'fs'
import { readdir, stat } from 'fs/promises'
import { reattachMoved, watchMounts } from './drives'
import { cancelPreviews, resumePreviews } from './portable'
import { systemLetter } from './volumes'
import { extname, join } from 'path'
import { debounceByKey, isIgnoredPath } from './utils'
import { createLogger } from './logger'

const logger = createLogger('Watcher')

// Debounce delay for file change events (100ms)
const FILE_CHANGE_DEBOUNCE_MS = 100
const POLL_MS = 10_000

/** Windows: a watch handle on a drive (ReadDirectoryChangesW) blocks "Safely remove" */
const pollInstead = (folder: string): boolean =>
  process.platform === 'win32' &&
  /^[A-Za-z]:/.test(folder) &&
  folder[0].toUpperCase() !== systemLetter()

/** Names, sizes and times of the folder's photos; null when the folder isn't there */
async function photosSignature(folder: string): Promise<string | null> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return null
  }
  const parts: string[] = []
  for (const name of names.sort()) {
    if (name.startsWith('.') || !IMAGE_EXTENSIONS.includes(extname(name).toLowerCase())) continue
    try {
      const s = await stat(join(folder, name))
      parts.push(`${name}|${s.size}|${s.mtimeMs}`)
    } catch {
      parts.push(`${name}|gone`) // removed between the listing and here
    }
  }
  return parts.join('\n')
}

class WatcherService {
  private watchers: Map<string, { close(): void }> = new Map()
  private closed = false // closeAll ran: nothing watches again until restart()
  private mainWindow: BrowserWindow | null = null
  private stopMounts: (() => void) | null = null
  private volumesTimer: ReturnType<typeof setTimeout> | undefined

  // Debounced file change handler - batches rapid events
  private debouncedHandleFileChange = debounceByKey((albumId: string) => {
    this.processFileChange(albumId)
  }, FILE_CHANGE_DEBOUNCE_MS)

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    const albums = getAllAlbums()
    logger.info(`Initializing watchers for ${albums.length} albums`)

    albums.forEach((album) => {
      // A missing folder is watched again once album:list or a sync check finds it back
      if (album.sourceFolderPath && existsSync(album.sourceFolderPath)) {
        this.watch(album.id, album.sourceFolderPath)
      }
    })
    this.watchVolumes()
  }

  /**
   * A drive mounting or going away (drives.ts: /Volumes, /media, Windows letters): re-check every
   * album's folder then, re-attach ones whose drive came back under another name, and watch again.
   */
  private watchVolumes(): void {
    if (!this.mainWindow) return
    // A new window (crash recovery, macOS activate): the mount hook moves to it
    this.stopMounts?.()
    this.stopMounts = null
    this.stopMounts = watchMounts(this.mainWindow, () => {
      cancelPreviews() // a drive going away: preview copies from it stop now, not on errors
      this.recheckSoon()
    })
    this.recheckSoon() // a drive already plugged in under another name at launch
  }

  private busySkipped = false // the last re-attach left an album alone because it was uploading
  /** The pipeline ended: an album skipped as BUSY gets its re-attach now */
  uploadEnded(): void {
    if (this.busySkipped) this.recheckSoon()
  }

  /** Re-check folders in a second (a drive lists late while it mounts) */
  recheckSoon(): void {
    if (!this.stopMounts) return // not started, or closed
    clearTimeout(this.volumesTimer)
    this.volumesTimer = setTimeout(() => void this.recheckFolders(), 1000)
  }

  private rechecking: Promise<void> | null = null
  private recheckAgain = false
  /** One run at a time; asked during one, exactly one more runs after it */
  private recheckFolders(): Promise<void> {
    if (this.rechecking) {
      this.recheckAgain = true
      return this.rechecking
    }
    const run = async (): Promise<void> => {
      try {
        do {
          this.recheckAgain = false
          await this.recheckOnce()
        } while (this.recheckAgain)
        resumePreviews() // a run the drive event cut short, if its folder is still here
      } catch (error) {
        logger.error('Folder re-check failed:', error)
      } finally {
        this.rechecking = null // same tick as the last check above: no ask is lost
      }
    }
    this.rechecking = run()
    return this.rechecking
  }

  private async recheckOnce(): Promise<void> {
    for (const album of getAllAlbums()) {
      if (album.adopting) continue
      const present = checkSourceFolder(album)
      // Back: anything copied in while it was away (a listing from before the unplug is stale)
      if (present && album.isOrphaned) {
        clearScanCache(album.sourceFolderPath)
        this.checkSyncStatus(album.id)
      }
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.busySkipped = await reattachMoved(this.mainWindow)
      } catch (error) {
        logger.error('Re-attach after a mount failed:', error)
      }
    }
    // Always: on an unplug the folder's own watch usually flagged the album first, so nothing
    // above changes, yet the list still shows it as there
    if (this.mainWindow && !this.mainWindow.isDestroyed())
      this.mainWindow.webContents.send('albums:refresh')
  }

  watch(albumId: string, folderPath: string): void {
    if (this.closed) return
    if (this.watchers.has(albumId)) {
      console.log(`[Watcher] Already watching album ${albumId}`)
      return
    }

    console.log(`[Watcher] Starting watch for album ${albumId} at ${folderPath}`)
    if (pollInstead(folderPath)) {
      this.watchers.set(albumId, this.poll(albumId, folderPath))
      return
    }

    // The folder itself only, never each file: on macOS a per-file watch (kqueue, which chokidar
    // always adds) aborts the whole process inside libuv when the drive is pulled out. A directory
    // watch (FSEvents) survives it and still reports adds, changes and deletes of its photos.
    let watcher: ReturnType<typeof fsWatch>
    try {
      watcher = fsWatch(folderPath, (event, name) => {
        // No name (Windows, when its event buffer overflows during a big copy): rescan anyway
        if (!name || !isIgnoredPath(folderPath, join(folderPath, name))) {
          // The next scan must list the folder again, not reuse one from before this change
          clearScanCache(folderPath)
          this.handleFileChange(albumId, event, name ?? folderPath)
        }
      })
    } catch (error) {
      console.error(`[Watcher] Could not watch ${albumId}:`, error)
      return
    }
    // Windows reports a lost folder here (macOS and Linux send an event instead): drop it, a later
    // check watches it again
    watcher.on('error', (error) => {
      console.error(`[Watcher] Error watching ${albumId}:`, error)
      if (this.watchers.get(albumId) === watcher) this.unwatch(albumId)
    })

    this.watchers.set(albumId, watcher)
  }

  /**
   * Look at the folder every 10 s instead of holding a watch handle; a change runs the same
   * debounced check as a watch event. Missing (unplugged): skipped until it is back.
   * ponytail: a readdir + one stat per photo every 10 s per album on a drive (~2k stats for a
   * 2k-photo card, 0.2k/s); a longer interval or a watch released on eject if that bites
   */
  private poll(albumId: string, folder: string): { close(): void } {
    let last: string | null = null
    let busy = false
    let stopped = false
    const tick = async (): Promise<void> => {
      if (busy) return // never two at once on a slow card
      busy = true
      try {
        const now = await photosSignature(folder)
        if (stopped) return
        if (now === null) {
          // Gone or renamed: flag it now (unwatches it), not on the next drive event
          const album = getAlbum(albumId)
          if (
            album &&
            !checkSourceFolder(album) &&
            this.mainWindow &&
            !this.mainWindow.isDestroyed()
          )
            this.mainWindow.webContents.send('albums:refresh')
          return
        }
        if (last !== null && now !== last) {
          clearScanCache(folder)
          this.handleFileChange(albumId, 'poll', folder)
        }
        last = now
      } finally {
        busy = false
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return {
      close: () => {
        stopped = true
        clearInterval(timer)
      }
    }
  }

  unwatch(albumId: string): void {
    const watcher = this.watchers.get(albumId)
    if (watcher) {
      console.log(`[Watcher] Stopping watch for album ${albumId}`)
      watcher.close()
      this.watchers.delete(albumId)
    }
  }

  private handleFileChange(albumId: string, event: string, path: string): void {
    logger.debug(`Detected ${event} on ${path} for album ${albumId}`)
    // Use debounced handler to batch rapid events
    this.debouncedHandleFileChange(albumId)
  }

  private async processFileChange(albumId: string): Promise<void> {
    logger.info(`Processing file changes for album ${albumId}`)

    // Smart Sync: Detect changes first to decide if we need to show badge or auto-sync
    try {
      const result = await detectAlbumChanges(albumId)

      if (!result.success || !result.changes) {
        // Fallback to safe default: just show sync badge if detection failed
        this.setNeedsSync(albumId, 1)
        return
      }

      const { new: newFiles, modified, deleted, renamed } = result.changes
      const hasRealChanges = newFiles.length > 0 || modified.length > 0 || deleted.length > 0
      // Only renames are trivial changes that need silent sync
      // 'skipped' means duplicates already in DB - not a change at all
      const hasTrivialChanges = renamed.length > 0

      if (hasRealChanges) {
        // Real changes (new, mod, del) -> User needs to review/upload -> Show Badge
        logger.info(`Real changes detected for ${albumId}. Setting needsSync=1`)
        this.setNeedsSync(albumId, 1)
      } else if (hasTrivialChanges) {
        // Only renames -> Auto-sync silently to update filenames
        logger.info(`Only renames detected for ${albumId}. Auto-syncing silently.`)
        await executeAlbumSync(albumId, result.changes, this.mainWindow)

        // Ensure needsSync is 0 (should be done by execute, but good to be sure)
        // We don't need to call setNeedsSync(0) because executeSync does it.
      } else {
        logger.debug(`No relevant changes detected for ${albumId}`)
      }
    } catch (error) {
      logger.error(`Failed to process file changes for ${albumId}:`, error)
      this.setNeedsSync(albumId, 1) // Safe fallback
    }
  }

  private setNeedsSync(albumId: string, status: number): void {
    try {
      updateAlbum(albumId, { needsSync: status })
      if (this.mainWindow) {
        this.mainWindow.webContents.send('album:status-changed', {
          albumId,
          needsSync: status
        })
      }
    } catch (error) {
      logger.error(`Failed to update album status:`, error)
    }
  }

  /**
   * Check sync status for a specific album
   * Compares local file count with database count without full processing
   */
  async checkSyncStatus(albumId: string): Promise<void> {
    try {
      const album = getAlbum(albumId)
      if (!album || !album.sourceFolderPath) return

      // Use smart detection logic to check for actual changes
      const result = await detectAlbumChanges(albumId)

      if (!result.success || !result.changes) {
        return
      }
      // needsSync as it is now, not from before the detection (another check may have set it)
      const current = getAlbum(albumId)
      if (!current) return

      const { new: newFiles, modified, deleted, renamed } = result.changes
      const hasRealChanges = newFiles.length > 0 || modified.length > 0 || deleted.length > 0
      // Only renames need silent sync, not skipped duplicates
      const hasTrivialChanges = renamed.length > 0

      const needsSync = hasRealChanges ? 1 : 0

      // If we have trivial changes (renames) but no real changes, execute silent sync
      if (!hasRealChanges && hasTrivialChanges) {
        logger.info(`[CheckSync] Renames detected for ${albumId}, syncing silently...`)
        await executeAlbumSync(albumId, result.changes, this.mainWindow)
        // executeAlbumSync will update needsSync to 0
      } else {
        // Just update status if changed
        if (current.needsSync !== needsSync) {
          updateAlbum(albumId, { needsSync })

          if (this.mainWindow) {
            this.mainWindow.webContents.send('album:status-changed', {
              albumId,
              needsSync
            })
          }
        }
      }
    } catch (error) {
      console.error(`[Watcher] Failed to check sync status for ${albumId}:`, error)
    }
  }

  /**
   * Refresh sync status for all albums (background task)
   */
  async refreshSyncStatus(): Promise<void> {
    const albums = getAllAlbums()

    logger.info(`Starting background sync check for ${albums.length} albums...`)

    // Process sequentially to avoid IO spikes
    for (const album of albums) {
      await this.checkSyncStatus(album.id)
      // Small delay to yield to other tasks
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    logger.info('Background sync check completed')
  }

  /**
   * Force refresh all albums immediately - bypasses debouncing
   * Use this when user manually triggers refresh for instant results
   */
  async forceRefreshAlbums(): Promise<void> {
    const albums = getAllAlbums()

    logger.info(`Force refreshing ${albums.length} albums (bypassing debounce)...`)

    // Process all albums immediately without delays
    const promises = albums.map((album) => this.processFileChange(album.id))
    await Promise.all(promises)
    // The renderer reloads the list itself once this returns

    logger.info('Force refresh completed')
  }

  /** Watch again after closeAll (a reset that stopped part way) */
  restart(): void {
    this.closed = false
    if (this.mainWindow && !this.mainWindow.isDestroyed()) this.initialize(this.mainWindow)
  }

  closeAll(): void {
    this.closed = true
    clearTimeout(this.volumesTimer)
    this.stopMounts?.()
    this.stopMounts = null
    this.watchers.forEach((watcher) => watcher.close())
    this.watchers.clear()
  }
}

export const watcherService = new WatcherService()
