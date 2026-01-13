import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import {
  updateAlbum,
  getAllAlbums,
  createAlbum,
  createImage,
  getAlbumBySourcePath,
  getAlbum,
  getAlbumImages
} from './database'
import { detectAlbumChanges, executeAlbumSync } from './ipc/sync'
import { BrowserWindow } from 'electron'
import { basename, join } from 'path'
import { readdirSync, Dirent } from 'fs'
import { albumsApi } from './api-client'
import { scanImagesInFolder, createAlbumFolder } from './storage'
import { getStorageLocation } from './config'
import { uploadPipeline } from './pipeline'
import { debounceByKey } from './utils'
import { createLogger } from './logger'
import {
  createAlbumMetadata,
  writeAlbumMetadata,
  getFolderStats,
  getAlbumIdFromMetadata,
  hasAlbumMetadata,
  readAlbumMetadata
} from './album-metadata'
import { copyWatcherRegistry } from './copy-watcher'

const logger = createLogger('Watcher')

// Debounce delay for file change events (100ms)
const FILE_CHANGE_DEBOUNCE_MS = 100

class WatcherService {
  private watchers: Map<string, FSWatcher> = new Map()
  private masterFolderWatcher: FSWatcher | null = null
  private mainWindow: BrowserWindow | null = null

  // Debounced file change handler - batches rapid events
  private debouncedHandleFileChange = debounceByKey(
    (albumId: string) => {
      this.processFileChange(albumId)
    },
    FILE_CHANGE_DEBOUNCE_MS
  )

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    const albums = getAllAlbums()
    logger.info(`Initializing watchers for ${albums.length} albums`)

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

      // Check for .lumosnap metadata (Rename Detection)
      try {
        if (hasAlbumMetadata(folderPath)) {
          const metadata = readAlbumMetadata(folderPath)
          if (metadata && metadata.albumId) {
            const existingById = getAlbum(metadata.albumId)
            if (existingById) {
              // It's a match! This is a rename operation.
              logger.info(`Detected renamed album: "${existingById.title}" -> "${folderName}"`)
              
              updateAlbum(existingById.id, {
                title: folderName,
                sourceFolderPath: folderPath,
                isOrphaned: 0
              })

              // Stop watching old path (if active) and start watching new path
              this.unwatch(existingById.id)
              this.watch(existingById.id, folderPath)

              // Notify renderer
              if (this.mainWindow) {
                this.mainWindow.webContents.send('albums:refresh')
              }
              
              return // Skip auto-creation
            }
          }
        }
      } catch (err) {
        logger.error(`[Watcher] Error checking metadata for rename:`, err)
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
        uploadOrder: index
      })
    })

    // Update album total images count
    updateAlbum(album.id, { totalImages: imageFiles.length })

    // Create .lumosnap metadata file in source folder
    const folderStats = getFolderStats(sourceFolderPath)
    const metadata = createAlbumMetadata(
      album.id,
      imageFiles.length,
      folderStats.totalSize
    )
    writeAlbumMetadata(sourceFolderPath, metadata)

    console.log(`[Watcher] Album created: ${album.id} with ${imageFiles.length} images`)

    // Start compression and upload pipeline
    if (imageFiles.length > 0 && this.mainWindow) {
      uploadPipeline.startPipeline(album.id, this.mainWindow).catch((error) => {
        console.error('[Watcher] Pipeline failed:', error)
      })
    }

    // Start watching the folder for changes
    this.watch(album.id, sourceFolderPath)

    // Start temporary copy watcher to detect files still being copied
    this.startCopyWatcher(album.id, sourceFolderPath, localFolderPath)
  }

  /**
   * Start a temporary copy watcher for newly created albums
   * Detects files that are still being copied to the source folder
   */
  private startCopyWatcher(
    albumId: string,
    sourceFolderPath: string,
    localFolderPath: string
  ): void {
    copyWatcherRegistry.create({
      albumId,
      folderPath: sourceFolderPath,
      timeoutMs: 120000, // 2 minutes max
      debounceMs: 5000, // 5 seconds of silence = copy complete
      onNewFiles: (filePaths) => {
        this.handleNewFilesFromCopyWatcher(albumId, filePaths, localFolderPath)
      },
      onComplete: () => {
        logger.info(`Copy watcher completed for album ${albumId}`)
      }
    })
  }

  /**
   * Handle new files detected by copy watcher
   */
  private async handleNewFilesFromCopyWatcher(
    albumId: string,
    filePaths: string[],
    localFolderPath: string
  ): Promise<void> {
    if (filePaths.length === 0) return

    logger.info(
      `Copy watcher detected ${filePaths.length} new files for album ${albumId}`
    )

    const album = getAlbum(albumId)
    if (!album) {
      logger.error(`Album ${albumId} not found`)
      return
    }

    // Get existing images to check for duplicates
    const existingImages = getAlbumImages(albumId)
    const existingFilenames = new Set(existingImages.map((img) => img.originalFilename))

    // Get current max uploadOrder
    let maxUploadOrder = existingImages.reduce(
      (max, img) => Math.max(max, img.uploadOrder),
      -1
    )

    let addedCount = 0

    for (const filePath of filePaths) {
      const filename = basename(filePath)

      // Skip if already exists
      if (existingFilenames.has(filename)) {
        continue
      }

      // Get file info
      try {
        const scanResult = scanImagesInFolder(album.sourceFolderPath, {
          skipDimensions: false
        }).find((f) => f.filename === filename)

        if (!scanResult) continue

        maxUploadOrder++
        createImage({
          albumId,
          serverId: null,
          originalFilename: filename,
          localFilePath: join(localFolderPath, filename),
          fileSize: scanResult.size,
          width: scanResult.width || 0,
          height: scanResult.height || 0,
          mtime: scanResult.mtime,
          sourceFileHash: null,
          uploadStatus: 'pending',
          uploadOrder: maxUploadOrder
        })

        addedCount++
        existingFilenames.add(filename)
      } catch (error) {
        logger.error(`Failed to add file ${filename}:`, error)
      }
    }

    if (addedCount > 0) {
      // Update album total images
      const newTotal = existingImages.length + addedCount
      updateAlbum(albumId, { totalImages: newTotal })

      logger.info(`Added ${addedCount} new images to album ${albumId}`)

      // Trigger pipeline if not already running
      if (this.mainWindow) {
        uploadPipeline.startPipeline(albumId, this.mainWindow).catch((error) => {
          logger.error(`Pipeline failed for album ${albumId}:`, error)
        })

        // Notify renderer to refresh
        this.mainWindow.webContents.send('albums:refresh')
      }
    }
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
      const existingAlbumIds = new Set(albums.map((a) => a.id))

      // Find new folders not in database
      const newFolders = subfolders.filter((f) => !existingPaths.has(f.path))

      if (newFolders.length > 0) {
        console.log(`[Watcher] Found ${newFolders.length} new folders - checking for existing albums`)

        for (const folder of newFolders) {
          try {
            // Check if folder has .lumosnap metadata (moved/renamed album)
            if (hasAlbumMetadata(folder.path)) {
              const existingAlbumId = getAlbumIdFromMetadata(folder.path)
              
              if (existingAlbumId && existingAlbumIds.has(existingAlbumId)) {
                // Album exists but with different path - update the path
                console.log(`[Watcher] Detected moved album ${existingAlbumId} at ${folder.path}`)
                updateAlbum(existingAlbumId, { 
                  sourceFolderPath: folder.path,
                  isOrphaned: 0 
                })
                this.watch(existingAlbumId, folder.path)
                continue
              } else if (existingAlbumId) {
                // Metadata points to album not in DB - could be from another installation
                // or copied folder. Skip and let user handle manually.
                console.log(`[Watcher] Found metadata for unknown album ${existingAlbumId} in ${folder.path}`)
              }
            }
            
            // No existing metadata or album not found - create new album
            await this.autoCreateAlbum(folder.name, folder.path)
            console.log(`[Watcher] Auto-created album for: ${folder.name}`)
          } catch (error) {
            console.error(`[Watcher] Failed to process folder ${folder.name}:`, error)
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
      ignored: [/(^|[\/\\])\.\./, /\.lumosnap$/], // ignore dotfiles and metadata
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

      const { new: newFiles, modified, deleted, renamed, skipped } = result.changes
      const hasRealChanges = newFiles.length > 0 || modified.length > 0 || deleted.length > 0
      const hasTrivialChanges = renamed.length > 0 || skipped.length > 0

      if (hasRealChanges) {
        // Real changes (new, mod, del) -> User needs to review/upload -> Show Badge
        logger.info(`Real changes detected for ${albumId}. Setting needsSync=1`)
        this.setNeedsSync(albumId, 1)
      } else if (hasTrivialChanges) {
        // Only trivial changes (renames/duplicates) -> Auto-sync silently
        logger.info(`Only trivial changes detected for ${albumId}. Auto-syncing silently.`)
        await executeAlbumSync(albumId, result.changes, this.mainWindow)
        
        // Ensure needsSync is 0 (should be done by execute, but good to be sure)
        // We don't need to call setNeedsSync(0) because executeSync does it.
      } else {
        logger.info(`No relevant changes detected for ${albumId}`)
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
      
      const { new: newFiles, modified, deleted, renamed, skipped } = result.changes
      const hasRealChanges = newFiles.length > 0 || modified.length > 0 || deleted.length > 0
      const hasTrivialChanges = renamed.length > 0 || skipped.length > 0
      
      const needsSync = hasRealChanges ? 1 : 0
      
      // If we have trivial changes but no real changes, execute silent sync to update metadata
      if (!hasRealChanges && hasTrivialChanges) {
        logger.info(`[CheckSync] Trivial changes detected for ${albumId}, syncing silently...`)
        await executeAlbumSync(albumId, result.changes, this.mainWindow)
        // executeAlbumSync will update needsSync to 0
      } else {
        // Just update status if changed
        if (album.needsSync !== needsSync) {
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
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    logger.info('Background sync check completed')
  }

  closeAll(): void {
    this.watchers.forEach((watcher) => watcher.close())
    this.watchers.clear()
    this.stopMasterFolderWatcher()
  }
}

export const watcherService = new WatcherService()

