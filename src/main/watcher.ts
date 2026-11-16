import { updateAlbum, getAllAlbums, getAlbum } from './database'
import { checkSourceFolder, detectAlbumChanges, executeAlbumSync } from './ipc/sync'
import { clearScanCache } from './storage'
import { BrowserWindow } from 'electron'
import { existsSync, watch as fsWatch, type FSWatcher } from 'fs'
import { join } from 'path'
import { debounceByKey, isIgnoredPath } from './utils'
import { createLogger } from './logger'

const logger = createLogger('Watcher')

// Debounce delay for file change events (100ms)
const FILE_CHANGE_DEBOUNCE_MS = 100

class WatcherService {
  private watchers: Map<string, FSWatcher> = new Map()
  private mainWindow: BrowserWindow | null = null
  private volumes: FSWatcher | null = null
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
   * macOS: a drive mounting or going away shows as an entry in /Volumes. Re-check every
   * album's folder then, so "Drive unplugged" and watching it again don't wait for a list.
   * ponytail: macOS only; Windows drive letters and Linux /media still wait for album:list
   */
  private watchVolumes(): void {
    if (process.platform !== 'darwin' || this.volumes) return
    try {
      this.volumes = fsWatch('/Volumes', () => {
        clearTimeout(this.volumesTimer)
        // A drive lists late while it mounts: wait for it to settle
        this.volumesTimer = setTimeout(() => this.recheckFolders(), 1000)
      })
      this.volumes.on('error', () => {
        this.volumes?.close()
        this.volumes = null
      })
    } catch (error) {
      logger.warn('Could not watch /Volumes:', error)
    }
  }

  private recheckFolders(): void {
    for (const album of getAllAlbums()) {
      if (album.adopting) continue
      const present = checkSourceFolder(album)
      // Back: anything copied in while it was away (a listing from before the unplug is stale)
      if (present && album.isOrphaned) {
        clearScanCache(album.sourceFolderPath)
        this.checkSyncStatus(album.id)
      }
    }
    // Always: on an unplug the folder's own watch usually flagged the album first, so nothing
    // above changes, yet the list still shows it as there
    if (this.mainWindow && !this.mainWindow.isDestroyed())
      this.mainWindow.webContents.send('albums:refresh')
  }

  watch(albumId: string, folderPath: string): void {
    if (this.watchers.has(albumId)) {
      console.log(`[Watcher] Already watching album ${albumId}`)
      return
    }

    console.log(`[Watcher] Starting watch for album ${albumId} at ${folderPath}`)

    // The folder itself only, never each file: on macOS a per-file watch (kqueue, which chokidar
    // always adds) aborts the whole process inside libuv when the drive is pulled out. A directory
    // watch (FSEvents) survives it and still reports adds, changes and deletes of its photos.
    let watcher: FSWatcher
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
    if (this.mainWindow && !this.mainWindow.isDestroyed()) this.initialize(this.mainWindow)
  }

  closeAll(): void {
    clearTimeout(this.volumesTimer)
    this.volumes?.close()
    this.volumes = null
    this.watchers.forEach((watcher) => watcher.close())
    this.watchers.clear()
  }
}

export const watcherService = new WatcherService()
