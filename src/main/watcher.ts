import chokidar from 'chokidar'
import { updateAlbum, getAllAlbums } from './database'
import { BrowserWindow } from 'electron'

class WatcherService {
  private watchers: Map<string, chokidar.FSWatcher> = new Map()
  private mainWindow: BrowserWindow | null = null

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    const albums = getAllAlbums()
    console.log(`[Watcher] Initializing watchers for ${albums.length} albums`)

    albums.forEach((album) => {
      if (album.sourceFolderPath) {
        this.watch(album.id, album.sourceFolderPath)
      }
    })
  }

  watch(albumId: string, folderPath: string): void {
    if (this.watchers.has(albumId)) {
      console.log(`[Watcher] Already watching album ${albumId}`)
      return
    }

    console.log(`[Watcher] Starting watch for album ${albumId} at ${folderPath}`)

    // Initialize watcher
    // ignoreInitial: true prevents firing 'add' events for existing files on startup
    const watcher = chokidar.watch(folderPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      depth: 0 // Only watch the immediate directory, not recursive?
      // Requirement says "folder", usually implies recursive but for flat photo folders maybe not needed.
      // Let's stick to default depth (recursive) or depth 0 if we only want top level.
      // Given "photographer picks a folder", usually images are in that folder.
      // Let's use default (recursive) to be safe, or depth 0 if we want to be strict.
      // Given "photographer picks a folder", usually images are in that folder.
      // Let's use default (recursive) to be safe, or depth 0 if we want to be strict.
      // Default is recursive.
    })

    watcher
      .on('add', (path) => this.handleFileChange(albumId, 'add', path))
      .on('change', (path) => this.handleFileChange(albumId, 'change', path))
      .on('unlink', (path) => this.handleFileChange(albumId, 'unlink', path))
      .on('error', (error) => console.error(`[Watcher] Error watching ${albumId}:`, error))

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
    console.log(`[Watcher] Detected ${event} on ${path} for album ${albumId}`)

    // Update database to mark album as needing sync
    try {
      updateAlbum(albumId, { needsSync: 1 })
      console.log(`[Watcher] Marked album ${albumId} as needing sync`)

      // Notify renderer to update UI
      if (this.mainWindow) {
        this.mainWindow.webContents.send('album:status-changed', {
          albumId,
          needsSync: 1
        })
      }
    } catch (error) {
      console.error(`[Watcher] Failed to update album status:`, error)
    }
  }

  closeAll(): void {
    this.watchers.forEach((watcher) => watcher.close())
    this.watchers.clear()
  }
}

export const watcherService = new WatcherService()
