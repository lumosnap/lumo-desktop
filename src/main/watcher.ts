import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import {
  updateAlbum,
  getAllAlbums,
  createAlbum,
  createImage,
  getAlbumBySourcePath
} from './database'
import { BrowserWindow } from 'electron'
import { basename, join } from 'path'
import { readdirSync, Dirent } from 'fs'
import { albumsApi } from './api-client'
import { scanImagesInFolder, createAlbumFolder } from './storage'
import { getStorageLocation } from './config'
import { uploadPipeline } from './pipeline'

class WatcherService {
  private watchers: Map<string, FSWatcher> = new Map()
  private masterFolderWatcher: FSWatcher | null = null
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

  // Watch master folder for new/deleted subfolders
  watchMasterFolder(masterFolderPath: string): void {
    if (this.masterFolderWatcher) {
      console.log('[Watcher] Stopping existing master folder watcher')
      this.masterFolderWatcher.close()
    }

    console.log(`[Watcher] Starting master folder watcher at ${masterFolderPath}`)

    this.masterFolderWatcher = chokidar.watch(masterFolderPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      depth: 0 // Only watch immediate directory level
    })

    this.masterFolderWatcher
      .on('addDir', (path) => this.handleMasterFolderChange('add', path))
      .on('unlinkDir', (path) => this.handleMasterFolderChange('remove', path))
      .on('error', (error) => console.error('[Watcher] Master folder error:', error))
  }

  private async handleMasterFolderChange(
    event: 'add' | 'remove',
    folderPath: string
  ): Promise<void> {
    const folderName = basename(folderPath)
    console.log(`[Watcher] Master folder ${event}: ${folderName} at ${folderPath}`)

    if (event === 'add') {
      // Check if album already exists for this path
      const existingAlbum = getAlbumBySourcePath(folderPath)
      if (existingAlbum) {
        console.log(`[Watcher] Album already exists for ${folderPath}`)
        return
      }

      // Auto-create album
      try {
        await this.autoCreateAlbum(folderName, folderPath)
        
        // Notify renderer to refresh album list
        if (this.mainWindow) {
          this.mainWindow.webContents.send('albums:refresh')
        }
      } catch (error) {
        console.error(`[Watcher] Failed to auto-create album:`, error)
      }
    }

    if (event === 'remove') {
      // Mark album as orphaned when folder is deleted
      const album = getAlbumBySourcePath(folderPath)
      if (album) {
        console.log(`[Watcher] Marking album ${album.id} as orphaned`)
        updateAlbum(album.id, { isOrphaned: 1 })
        
        // Stop watching this folder
        this.unwatch(album.id)
        
        // Notify renderer to refresh
        if (this.mainWindow) {
          this.mainWindow.webContents.send('albums:refresh')
        }
      }
    }

    // Notify renderer about the change
    if (this.mainWindow) {
      this.mainWindow.webContents.send('master-folder:change', {
        event,
        folderPath,
        folderName
      })
    }
  }

  private async autoCreateAlbum(title: string, sourceFolderPath: string): Promise<void> {
    const storageLocation = getStorageLocation()
    if (!storageLocation) {
      console.error('[Watcher] Storage location not configured')
      return
    }

    console.log(`[Watcher] Auto-creating album: ${title}`)

    // Create album on server
    const apiAlbum = await albumsApi.create({
      title,
      eventDate: null
    })

    // Create local album folder
    const localFolderPath = createAlbumFolder(storageLocation, apiAlbum.id)

    // Create album in local database
    const album = createAlbum({
      id: apiAlbum.id,
      title,
      eventDate: null,
      startTime: null,
      endTime: null,
      localFolderPath,
      sourceFolderPath,
      totalImages: 0,
      lastSyncedAt: null,
      needsSync: 0,
      isOrphaned: 0
    })

    // Scan source folder for images
    const imageFiles = scanImagesInFolder(sourceFolderPath)

    // Create image records
    imageFiles.forEach((file, index) => {
      const localFilePath = join(localFolderPath, file.filename)

      createImage({
        albumId: album.id,
        serverId: null,
        originalFilename: file.filename,
        localFilePath,
        fileSize: file.size,
        width: file.width || 0,
        height: file.height || 0,
        mtime: file.mtime,
        sourceFileHash: null,
        uploadStatus: 'pending',
        uploadOrder: index,
        localNotes: null,
        localTodoStatus: null
      })
    })

    // Update album total images count
    updateAlbum(album.id, { totalImages: imageFiles.length })

    console.log(`[Watcher] Album created: ${album.id} with ${imageFiles.length} images`)

    // Start compression and upload pipeline
    if (imageFiles.length > 0 && this.mainWindow) {
      uploadPipeline.startPipeline(album.id, this.mainWindow).catch((error) => {
        console.error('[Watcher] Pipeline failed:', error)
      })
    }

    // Start watching the folder for changes
    this.watch(album.id, sourceFolderPath)
  }

  stopMasterFolderWatcher(): void {
    if (this.masterFolderWatcher) {
      console.log('[Watcher] Stopping master folder watcher')
      this.masterFolderWatcher.close()
      this.masterFolderWatcher = null
    }
  }

  // Scan master folder on startup to detect folders created while app was closed
  async scanMasterFolderOnStartup(masterFolderPath: string): Promise<void> {
    try {
      const entries = readdirSync(masterFolderPath, { withFileTypes: true })
      const subfolders = entries
        .filter((entry: Dirent) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry: Dirent) => ({
          name: entry.name,
          path: join(masterFolderPath, entry.name)
        }))

      console.log(`[Watcher] Found ${subfolders.length} subfolders in master folder`)

      // Get existing albums to compare
      const albums = getAllAlbums()
      const existingPaths = new Set(albums.map((a) => a.sourceFolderPath))

      // Find new folders not in database
      const newFolders = subfolders.filter((f) => !existingPaths.has(f.path))

      if (newFolders.length > 0) {
        console.log(`[Watcher] Found ${newFolders.length} new folders - auto-creating albums`)

        // Auto-create albums for new folders
        for (const folder of newFolders) {
          try {
            await this.autoCreateAlbum(folder.name, folder.path)
            console.log(`[Watcher] Auto-created album for: ${folder.name}`)
          } catch (error) {
            console.error(`[Watcher] Failed to auto-create album for ${folder.name}:`, error)
          }
        }

        // Notify renderer to refresh
        if (this.mainWindow) {
          this.mainWindow.webContents.send('albums:refresh')
        }
      }
    } catch (error) {
      console.error('[Watcher] Failed to scan master folder:', error)
    }
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
      ignored: /(^|[\/\\])\.\./, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      depth: 0 // Only watch the immediate directory
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
    this.stopMasterFolderWatcher()
  }
}

export const watcherService = new WatcherService()

