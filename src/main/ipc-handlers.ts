import { ipcMain, BrowserWindow, shell } from 'electron'
import {
  isConfigured,
  getStorageLocation,
  setStorageLocation,
  getConfig,
  getMasterFolder,
  setMasterFolder
} from './config'
import {
  getFreeSpace,
  createAlbumFolder,
  ensureBaseDirectory,
  scanImagesInFolder,
  formatBytes
} from './storage'
import {
  createAlbum,
  getAlbum,
  getAllAlbums,
  deleteAlbum as dbDeleteAlbum,
  createImage,
  getAlbumImages,
  deleteImages,
  updateAlbum
} from './database'
import { albumsApi, profileApi, plansApi } from './api-client'
import { uploadPipeline } from './pipeline'
import { existsSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { watcherService } from './watcher'
import { startAuth } from './oauth-handler'
import { getAuth, clearAuth } from './auth-storage'
import { createAlbumMetadata, writeAlbumMetadata, getFolderStats } from './album-metadata'
import { networkService } from './network'
import { notificationService } from './notifications'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ==================== Auth Handlers ====================

  ipcMain.handle('auth:getStoredAuth', () => {
    console.log('[IPC] Getting stored auth')
    const auth = getAuth()
    if (auth) {
      return { success: true, token: auth.token, user: auth.user }
    }
    return { success: false, token: null, user: null }
  })

  ipcMain.handle('auth:startAuth', async () => {
    console.log('[IPC] Starting auth flow')
    const result = await startAuth()
    return result
  })

  ipcMain.handle('auth:logout', () => {
    console.log('[IPC] Logging out')
    clearAuth()
    return { success: true }
  })

  // ==================== Config Handlers ====================

  ipcMain.handle('config:isConfigured', () => {
    return isConfigured()
  })

  ipcMain.handle('config:getStorageLocation', () => {
    return getStorageLocation()
  })

  ipcMain.handle('config:setStorageLocation', async (_event, path: string) => {
    try {
      // Validate path exists
      if (!existsSync(path)) {
        throw new Error('Selected path does not exist')
      }

      // Set storage location
      setStorageLocation(path)

      // Create base directory structure
      ensureBaseDirectory(path)

      return { success: true }
    } catch (error: any) {
      console.error('Failed to set storage location:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('config:getFreeSpace', async (_event, path: string) => {
    try {
      const bytes = await getFreeSpace(path)
      return {
        bytes,
        formatted: formatBytes(bytes)
      }
    } catch (error: any) {
      console.error('Failed to get free space:', error)
      return { bytes: 0, formatted: '0 Bytes', error: error.message }
    }
  })

  ipcMain.handle('config:getConfig', () => {
    return getConfig()
  })

  // 10GB threshold for low storage warning
  const LOW_STORAGE_THRESHOLD = 10 * 1024 * 1024 * 1024

  ipcMain.handle('config:getCurrentStorageInfo', async () => {
    try {
      const storageLocation = getStorageLocation()
      if (!storageLocation) {
        return {
          success: false,
          error: 'Storage location not configured',
          path: null,
          freeSpace: 0,
          freeSpaceFormatted: '0 Bytes',
          isLowStorage: false
        }
      }

      const freeSpace = await getFreeSpace(storageLocation)
      const isLowStorage = freeSpace < LOW_STORAGE_THRESHOLD

      return {
        success: true,
        path: storageLocation,
        freeSpace,
        freeSpaceFormatted: formatBytes(freeSpace),
        isLowStorage
      }
    } catch (error: any) {
      console.error('Failed to get storage info:', error)
      return {
        success: false,
        error: error.message,
        path: null,
        freeSpace: 0,
        freeSpaceFormatted: '0 Bytes',
        isLowStorage: false
      }
    }
  })

  // ==================== Profile Handlers ====================

  ipcMain.handle('profile:get', async () => {
    try {
      const profile = await profileApi.get()
      return { success: true, data: profile }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get profile'
      console.error('[IPC] Failed to get profile:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('profile:update', async (_, data: { businessName?: string; phone?: string }) => {
    try {
      const profile = await profileApi.update(data)
      return { success: true, data: profile }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update profile'
      console.error('[IPC] Failed to update profile:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('profile:getBillingAddresses', async () => {
    try {
      const addresses = await profileApi.getBillingAddresses()
      return { success: true, data: addresses }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get billing addresses'
      console.error('[IPC] Failed to get billing addresses:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    'profile:createBillingAddress',
    async (
      _,
      data: {
        street: string
        city: string
        state: string
        zip: string
        country: string
        isDefault?: boolean
      }
    ) => {
      try {
        const address = await profileApi.createBillingAddress(data)
        return { success: true, data: address }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to create billing address'
        console.error('[IPC] Failed to create billing address:', message)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    'profile:updateBillingAddress',
    async (
      _,
      addressId: number,
      data: {
        street?: string
        city?: string
        state?: string
        zip?: string
        country?: string
        isDefault?: boolean
      }
    ) => {
      try {
        const address = await profileApi.updateBillingAddress(addressId, data)
        return { success: true, data: address }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update billing address'
        console.error('[IPC] Failed to update billing address:', message)
        return { success: false, error: message }
      }
    }
  )

  // ==================== Plans Handlers ====================

  ipcMain.handle('plans:list', async () => {
    try {
      const plans = await plansApi.list()
      return { success: true, data: plans }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get plans'
      console.error('[IPC] Failed to get plans:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plans:requestUpgrade', async (_, planId: number) => {
    try {
      await plansApi.requestUpgrade(planId)
      return { success: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to request upgrade'
      console.error('[IPC] Failed to request upgrade:', message)
      return { success: false, error: message }
    }
  })

  // ==================== Master Folder Handlers ====================

  ipcMain.handle('config:getMasterFolder', () => {
    return getMasterFolder()
  })

  ipcMain.handle('config:setMasterFolder', async (_event, path: string) => {
    try {
      if (!existsSync(path)) {
        throw new Error('Selected path does not exist')
      }

      setMasterFolder(path)
      watcherService.watchMasterFolder(path)

      return { success: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to set master folder'
      console.error('[IPC] Failed to set master folder:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('config:scanMasterFolder', () => {
    try {
      const masterFolder = getMasterFolder()
      if (!masterFolder || !existsSync(masterFolder)) {
        return { success: false, error: 'Master folder not configured', folders: [] }
      }

      // Read all directories in master folder
      const entries = readdirSync(masterFolder, { withFileTypes: true })
      const folders = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => {
          const folderPath = join(masterFolder, entry.name)
          const images = scanImagesInFolder(folderPath)
          return {
            name: entry.name,
            path: folderPath,
            imageCount: images.length
          }
        })

      return { success: true, folders }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to scan master folder'
      console.error('[IPC] Failed to scan master folder:', message)
      return { success: false, error: message, folders: [] }
    }
  })

  // Open folder in system file manager
  ipcMain.handle('shell:openFolder', async (_event, folderPath: string) => {
    try {
      if (!existsSync(folderPath)) {
        return { success: false, error: 'Folder does not exist' }
      }
      await shell.openPath(folderPath)
      return { success: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to open folder'
      console.error('[IPC] Failed to open folder:', message)
      return { success: false, error: message }
    }
  })

  // ==================== Album Handlers ====================

  ipcMain.handle(
    'album:create',
    async (
      _event,
      data: {
        title: string
        eventDate: string | null
        startTime: string | null
        endTime: string | null
        sourceFolderPath: string
      }
    ) => {
      try {
        const storageLocation = getStorageLocation()
        if (!storageLocation) {
          throw new Error('Storage location not configured')
        }

        // Create album on server (real API)
        // Note: Assuming API might not support startTime/endTime yet, or we send them if supported.
        // For now, we'll just pass what we have.
        const apiAlbum = await albumsApi.create({
          title: data.title,
          eventDate: data.eventDate
        })

        // Create local album folder
        const localFolderPath = createAlbumFolder(storageLocation, apiAlbum.id)

        // Create album in local database
        const album = createAlbum({
          id: apiAlbum.id,
          title: data.title,
          eventDate: data.eventDate,
          startTime: data.startTime,
          endTime: data.endTime,
          localFolderPath,
          sourceFolderPath: data.sourceFolderPath,
          totalImages: 0,
          lastSyncedAt: null,
          needsSync: 0,
          isOrphaned: 0
        })

        // Scan source folder for images
        const imageFiles = scanImagesInFolder(data.sourceFolderPath)

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
        const folderStats = getFolderStats(data.sourceFolderPath)
        const metadata = createAlbumMetadata(album.id, imageFiles.length, folderStats.totalSize)
        writeAlbumMetadata(data.sourceFolderPath, metadata)

        // Start compression and upload pipeline
        uploadPipeline.startPipeline(album.id, mainWindow).catch((error) => {
          console.error('Pipeline failed:', error)
        })

        // Start watching the folder
        watcherService.watch(album.id, data.sourceFolderPath)

        // Notify user of successful album creation
        notificationService.albumCreated(data.title)

        return { success: true, album: { ...album, totalImages: imageFiles.length } }
      } catch (error: any) {
        console.error('Failed to create album:', error)
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle('album:list', () => {
    console.log('[IPC] album:list called')
    try {
      const albums = getAllAlbums()
      const storageLocation = getStorageLocation()
      console.log(`[IPC] Found ${albums.length} albums in database`)

      if (!storageLocation) {
        console.warn('[IPC] No storage location configured')
        return { success: true, albums: [] }
      }

      // Verify each album's folder exists
      const validAlbums = albums.filter((album) => {
        const exists = existsSync(album.localFolderPath)
        if (!exists) {
          console.warn(`[IPC] Album folder does not exist: ${album.localFolderPath}`)
        }
        return exists
      })
      console.log(`[IPC] ${validAlbums.length} albums have valid folder paths`)

      // Get thumbnail for each album and check for sync status
      const albumsWithThumbnails = validAlbums.map((album) => {
        const images = getAlbumImages(album.id)
        // Select a random image for preview
        const randomIndex = images.length > 0 ? Math.floor(Math.random() * images.length) : 0
        const thumbnail = images.length > 0 ? images[randomIndex].localFilePath : null
        console.log(`[IPC] Album ${album.id} has ${images.length} images`)

        // Quick sync check: compare file counts
        let needsSync = album.needsSync
        if (existsSync(album.sourceFolderPath)) {
          try {
            console.log(`[IPC] Checking sync for album ${album.id}...`)
            const sourceImages = scanImagesInFolder(album.sourceFolderPath)
            const dbImageCount = images.length

            // If counts don't match, mark as needing sync
            if (sourceImages.length !== dbImageCount) {
              console.log(
                `[IPC] Sync needed for album ${album.id}: source=${sourceImages.length}, db=${dbImageCount}`
              )
              needsSync = 1
              // Update database
              updateAlbum(album.id, { needsSync: 1 })
            } else {
              console.log(`[IPC] Album ${album.id} is in sync`)
              // Reset needsSync in database if it was previously set
              if (album.needsSync === 1) {
                console.log(`[IPC] Resetting needsSync to 0 for album ${album.id}`)
                updateAlbum(album.id, { needsSync: 0 })
              }
              needsSync = 0
            }
          } catch (error) {
            console.warn(`[IPC] Failed to check sync for album ${album.id}:`, error)
          }
        } else {
          console.warn(
            `[IPC] Source folder does not exist for album ${album.id}: ${album.sourceFolderPath}`
          )
        }

        return {
          ...album,
          needsSync,
          thumbnail
        }
      })

      console.log(`[IPC] Returning ${albumsWithThumbnails.length} albums with thumbnails`)
      return { success: true, albums: albumsWithThumbnails }
    } catch (error: any) {
      console.error('[IPC] Failed to list albums:', error)
      return { success: false, error: error.message, albums: [] }
    }
  })

  ipcMain.handle('album:get', (_event, albumId: string) => {
    console.log(`[IPC] album:get called for albumId: ${albumId}`)
    try {
      const album = getAlbum(albumId)
      if (!album) {
        console.error(`[IPC] Album not found: ${albumId}`)
        return { success: false, error: 'Album not found' }
      }
      console.log(`[IPC] Album found:`, album)

      // Check for sync needs
      let needsSync = album.needsSync
      if (existsSync(album.sourceFolderPath)) {
        try {
          console.log(`[IPC] Checking sync for album ${albumId}...`)
          const sourceImages = scanImagesInFolder(album.sourceFolderPath)
          const dbImages = getAlbumImages(albumId)

          // Quick check: if counts don't match, needs sync
          if (sourceImages.length !== dbImages.length) {
            console.log(`[IPC] Sync needed: source=${sourceImages.length}, db=${dbImages.length}`)
            needsSync = 1
            updateAlbum(albumId, { needsSync: 1 })
          } else {
            console.log(`[IPC] Album ${albumId} is in sync (count match)`)
            // Reset needsSync in database if it was previously set
            if (album.needsSync === 1) {
              console.log(`[IPC] Resetting needsSync to 0 for album ${albumId}`)
              updateAlbum(albumId, { needsSync: 0 })
            }
            needsSync = 0
          }
        } catch (error) {
          console.warn(`[IPC] Failed to check sync for album ${albumId}:`, error)
        }
      } else {
        console.warn(`[IPC] Source folder does not exist: ${album.sourceFolderPath}`)
      }

      console.log(`[IPC] Returning album with needsSync=${needsSync}`)
      return { success: true, album: { ...album, needsSync } }
    } catch (error: any) {
      console.error('[IPC] Failed to get album:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('album:delete', async (_event, albumId: string) => {
    try {
      const album = getAlbum(albumId)
      if (!album) {
        return { success: false, error: 'Album not found' }
      }

      // Delete from cloud first
      console.log(`[IPC] Deleting album ${albumId} from cloud...`)
      await albumsApi.delete(albumId)
      console.log(`[IPC] Cloud deletion successful`)

      // Delete local folder
      if (existsSync(album.localFolderPath)) {
        console.log(`[IPC] Deleting local folder: ${album.localFolderPath}`)
        rmSync(album.localFolderPath, { recursive: true, force: true })
      }

      // Delete from database (cascade will delete images)
      console.log(`[IPC] Deleting from database...`)
      dbDeleteAlbum(albumId)

      // Stop watching
      watcherService.unwatch(albumId)

      return { success: true }
    } catch (error: any) {
      console.error('Failed to delete album:', error)
      return { success: false, error: error.message }
    }
  })

  // ==================== Image Handlers ====================

  ipcMain.handle('album:getImages', async (_event, albumId: string) => {
    console.log(`[IPC] album:getImages called for albumId: ${albumId}`)
    try {
      const images = getAlbumImages(albumId)
      console.log(`[IPC] Found ${images.length} images in database for album ${albumId}`)

      images.forEach((img, index) => {
        console.log(
          `[IPC]   Image ${index + 1}: ${img.originalFilename} - path: ${img.localFilePath}, status: ${img.uploadStatus}`
        )
      })

      // Get favorites from API (new format with enriched data)
      // The response now returns favorited images with comments, favoriteCount, notesCount
      let favorites: Array<{
        originalFilename: string
        favoriteCount: number
        notesCount: number
        comments: Array<{ clientName: string; notes: string | null; createdAt: string }>
      }> = []

      console.log(`[IPC] Fetching favorites from API...`)
      try {
        const favoritesResult = await albumsApi.getFavorites(albumId)
        favorites = favoritesResult.data
        console.log(`[IPC] Received ${favorites.length} favorited images from API`)
      } catch {
        // Album may not exist on server yet (offline-first), just return empty favorites
        console.log(`[IPC] Could not fetch favorites (album may not be synced to cloud yet)`)
        favorites = []
      }

      // Helper to get base filename without extension
      const getBaseName = (filename: string): string => {
        const lastDot = filename.lastIndexOf('.')
        return lastDot > 0 ? filename.substring(0, lastDot) : filename
      }

      // Combine images with favorite status
      // Match by base filename (without extension) since local files have original extensions
      // (.jpg, .png, etc.) but API returns .webp filenames after compression
      const imagesWithFavorites = images.map((img) => {
        const imgBaseName = getBaseName(img.originalFilename)
        const favorite = favorites.find((fav) => getBaseName(fav.originalFilename) === imgBaseName)
        return {
          ...img,
          isFavorite: !!favorite,
          favoriteCount: favorite?.favoriteCount || 0,
          notesCount: favorite?.notesCount || 0,
          comments: favorite?.comments || []
        }
      })

      console.log(`[IPC] Returning ${imagesWithFavorites.length} images with favorite status`)
      console.log(
        `[IPC] Images with favorites:`,
        imagesWithFavorites.filter((img) => img.isFavorite).map((img) => img.originalFilename)
      )
      return { success: true, images: imagesWithFavorites }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[IPC] Failed to get images:', message)
      return { success: false, error: message, images: [] }
    }
  })

  ipcMain.handle('album:deleteImage', async (_event, albumId: string, imageId: number) => {
    console.log(`[IPC] album:deleteImage called for albumId: ${albumId}, imageId: ${imageId}`)
    try {
      const images = getAlbumImages(albumId)
      const image = images.find((img) => img.id === imageId)

      if (!image) {
        return { success: false, error: 'Image not found' }
      }

      // Delete from cloud if synced (has serverId)
      if (image.serverId) {
        console.log(`[IPC] Deleting image from cloud, serverId: ${image.serverId}`)
        await albumsApi.deleteImages(albumId, [image.serverId])
      }

      // Delete from local database
      console.log(`[IPC] Deleting image from local database`)
      deleteImages([imageId])

      // Update album total count
      const album = getAlbum(albumId)
      if (album) {
        updateAlbum(albumId, { totalImages: Math.max(0, album.totalImages - 1) })
      }

      return { success: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[IPC] Failed to delete image:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('album:deleteImages', async (_event, albumId: string, imageIds: number[]) => {
    console.log(
      `[IPC] album:deleteImages called for albumId: ${albumId}, count: ${imageIds.length}`
    )
    try {
      const images = getAlbumImages(albumId)
      const imagesToDelete = images.filter((img) => imageIds.includes(img.id))

      if (imagesToDelete.length === 0) {
        return { success: false, error: 'No images found' }
      }

      // Get server IDs for cloud deletion
      const serverIds = imagesToDelete
        .filter((img) => img.serverId != null)
        .map((img) => img.serverId!)

      // Delete from cloud if any are synced
      if (serverIds.length > 0) {
        console.log(`[IPC] Deleting ${serverIds.length} images from cloud`)
        await albumsApi.deleteImages(albumId, serverIds)
      }

      // Delete from local database
      console.log(`[IPC] Deleting ${imageIds.length} images from local database`)
      deleteImages(imageIds)

      // Update album total count
      const album = getAlbum(albumId)
      if (album) {
        updateAlbum(albumId, { totalImages: Math.max(0, album.totalImages - imageIds.length) })
      }

      return { success: true, deletedCount: imageIds.length }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[IPC] Failed to delete images:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('album:scanSourceFolder', (_event, folderPath: string) => {
    try {
      const images = scanImagesInFolder(folderPath)
      return { success: true, count: images.length, images }
    } catch (error: any) {
      console.error('Failed to scan folder:', error)
      return { success: false, error: error.message, count: 0, images: [] }
    }
  })

  ipcMain.handle('album:startUpload', async (_event, albumId: string) => {
    try {
      uploadPipeline.startPipeline(albumId, mainWindow).catch((error) => {
        console.error('Pipeline failed:', error)
      })

      return { success: true }
    } catch (error: any) {
      console.error('Failed to start upload:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('album:getProgress', (_event, albumId: string) => {
    try {
      const progress = uploadPipeline.getProgress(albumId)
      return { success: true, progress }
    } catch (error: any) {
      console.error('Failed to get progress:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('album:retryFailed', async (_event, albumId: string) => {
    try {
      await uploadPipeline.retryFailed(albumId, mainWindow)
      return { success: true }
    } catch (error: any) {
      console.error('Failed to retry failed uploads:', error)
      return { success: false, error: error.message }
    }
  })

  // ==================== Instant Refresh Handler ====================

  ipcMain.handle('albums:forceRefresh', async () => {
    try {
      console.log('[IPC] Force refresh requested - bypassing debounce')
      await watcherService.forceRefreshAlbums()
      return { success: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[IPC] Failed to force refresh:', message)
      return { success: false, error: message }
    }
  })

  // ==================== Sync Handlers ====================
  // NOTE: Sync handlers are registered in ipc/sync.ts for better modularity
  // They include hash-based rename detection and duplicate content checking

  // ==================== API Handlers ====================

  ipcMain.handle('api:generateShareLink', async (_event, albumId: string) => {
    try {
      console.log(`[IPC] Generating share link for album ${albumId}`)
      const result = await albumsApi.createShareLink(albumId)
      return {
        success: true,
        shareLink: {
          shareLinkToken: result.shareLinkToken,
          shareUrl: result.shareLink,
          expiresAt: null
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[IPC] Failed to generate share link:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('api:getFavorites', async (_event, albumId: string, clientName?: string) => {
    try {
      const result = await albumsApi.getFavorites(albumId, clientName)
      return { success: true, favorites: result.data, clientNames: result.clientNames }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Failed to get favorites:', error)
      return { success: false, error: message, favorites: [], clientNames: [] }
    }
  })

  // ==================== Shell Handlers ====================

  ipcMain.handle('shell:showItemInFolder', (_event, albumId: string, imageId: number) => {
    try {
      console.log(
        `[IPC] shell:showItemInFolder called for albumId: ${albumId}, imageId: ${imageId}`
      )

      // Get album to get source folder path
      const album = getAlbum(albumId)
      if (!album) {
        return { success: false, error: 'Album not found' }
      }

      // Get image to get original filename
      const images = getAlbumImages(albumId)
      const image = images.find((img) => img.id === imageId)
      if (!image) {
        return { success: false, error: 'Image not found' }
      }

      // Construct original file path
      const originalPath = join(album.sourceFolderPath, image.originalFilename)

      // Check if file exists
      if (!existsSync(originalPath)) {
        console.error(`[IPC] Original file not found: ${originalPath}`)
        return { success: false, error: 'Original file not found' }
      }

      // Show in folder
      console.log(`[IPC] Showing file in folder: ${originalPath}`)
      shell.showItemInFolder(originalPath)

      return { success: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[IPC] Failed to show item in folder:', message)
      return { success: false, error: message }
    }
  })

  // ==================== Network Handlers ====================

  ipcMain.handle('network:getStatus', () => {
    return { online: networkService.isOnline() }
  })

  ipcMain.handle('network:checkConnectivity', async () => {
    const online = await networkService.checkConnectivity()
    return { online }
  })
}
