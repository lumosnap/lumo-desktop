/**
 * Album IPC handlers
 */

import { BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { getStorageLocation } from '../config'
import { createAlbumFolder, scanImagesInFolder } from '../storage'
import {
  createAlbum,
  getAlbum,
  getAllAlbums,
  deleteAlbum as dbDeleteAlbum,
  createImage,
  getAlbumImages,
  deleteImages,
  updateAlbum
} from '../database'
import { albumsApi } from '../api-client'
import { uploadPipeline } from '../pipeline'
import { watcherService } from '../watcher'
import { createLogger, getErrorMessage } from '../logger'

const logger = createLogger('IPC:Album')

export function registerAlbumHandlers(mainWindow: BrowserWindow): void {
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

        // Create album on server
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

        // Start compression and upload pipeline
        uploadPipeline.startPipeline(album.id, mainWindow).catch((error) => {
          logger.error('Pipeline failed:', getErrorMessage(error))
        })

        // Start watching the folder
        watcherService.watch(album.id, data.sourceFolderPath)

        return { success: true, album: { ...album, totalImages: imageFiles.length } }
      } catch (error: unknown) {
        logger.error('Failed to create album:', getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('album:list', () => {
    logger.debug('Listing albums (optimized)')
    try {
      const albums = getAllAlbums()
      const storageLocation = getStorageLocation()

      if (!storageLocation) {
        logger.warn('No storage location configured')
        return { success: true, albums: [] }
      }

      // Verify each album's folder exists
      const validAlbums = albums.filter((album) => {
        const exists = existsSync(album.localFolderPath)
        if (!exists) {
          logger.warn(`Album folder does not exist: ${album.localFolderPath}`)
        }
        return exists
      })

      // Get thumbnail and check sync status
      const albumsWithThumbnails = validAlbums.map((album) => {
        // Performance: we don't scan folders here - just fetch minimal data from DB
        const images = getAlbumImages(album.id)
        const randomIndex = images.length > 0 ? Math.floor(Math.random() * images.length) : 0
        const thumbnail = images.length > 0 ? images[randomIndex].localFilePath : null

        // Trigger background sync check
        // This runs asynchronously and will notify frontend if status changes
        // Don't await this!
        if (album.sourceFolderPath && existsSync(album.sourceFolderPath)) {
          watcherService.checkSyncStatus(album.id).catch(err => {
            logger.error(`Background sync check failed for ${album.id}:`, getErrorMessage(err))
          })
        }

        return { ...album, needsSync: album.needsSync, thumbnail }
      })

      return { success: true, albums: albumsWithThumbnails }
    } catch (error: unknown) {
      logger.error('Failed to list albums:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error), albums: [] }
    }
  })

  ipcMain.handle('album:get', (_event, albumId: string) => {
    logger.debug(`Getting album: ${albumId}`)
    try {
      const album = getAlbum(albumId)
      if (!album) {
        return { success: false, error: 'Album not found' }
      }

      // Check sync needs
      let needsSync = album.needsSync
      if (existsSync(album.sourceFolderPath)) {
        try {
          const sourceImages = scanImagesInFolder(album.sourceFolderPath)
          const dbImages = getAlbumImages(albumId)

          if (sourceImages.length !== dbImages.length) {
            needsSync = 1
            updateAlbum(albumId, { needsSync: 1 })
          } else if (album.needsSync === 1) {
            updateAlbum(albumId, { needsSync: 0 })
            needsSync = 0
          }
        } catch {
          // Ignore sync check errors
        }
      }

      return { success: true, album: { ...album, needsSync } }
    } catch (error: unknown) {
      logger.error('Failed to get album:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('album:delete', async (_event, albumId: string) => {
    try {
      const album = getAlbum(albumId)
      if (!album) {
        return { success: false, error: 'Album not found' }
      }

      // Delete from cloud first
      logger.info(`Deleting album ${albumId} from cloud`)
      await albumsApi.delete(albumId)

      // Delete local folder
      if (existsSync(album.localFolderPath)) {
        rmSync(album.localFolderPath, { recursive: true, force: true })
      }

      // Delete from database (cascade deletes images)
      dbDeleteAlbum(albumId)

      // Stop watching
      watcherService.unwatch(albumId)

      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to delete album:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Image handlers within albums
  ipcMain.handle('album:getImages', async (_event, albumId: string) => {
    logger.debug(`Getting images for album: ${albumId}`)
    try {
      const images = getAlbumImages(albumId)

      // Get favorites from API
      let favorites: Array<{
        originalFilename: string
        favoriteCount: number
        notesCount: number
        comments: Array<{ clientName: string; notes: string | null; createdAt: string }>
      }> = []

      try {
        const favoritesResult = await albumsApi.getFavorites(albumId)
        favorites = favoritesResult.data
      } catch {
        // Album may not exist on server yet
      }

      // Helper for base filename
      const getBaseName = (filename: string): string => {
        const lastDot = filename.lastIndexOf('.')
        return lastDot > 0 ? filename.substring(0, lastDot) : filename
      }

      // Combine images with favorite status
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

      return { success: true, images: imagesWithFavorites }
    } catch (error: unknown) {
      logger.error('Failed to get images:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error), images: [] }
    }
  })

  ipcMain.handle('album:deleteImage', async (_event, albumId: string, imageId: number) => {
    try {
      const images = getAlbumImages(albumId)
      const image = images.find((img) => img.id === imageId)

      if (!image) {
        return { success: false, error: 'Image not found' }
      }

      // Delete from cloud if synced
      if (image.serverId) {
        await albumsApi.deleteImages(albumId, [image.serverId])
      }

      // Delete from local database
      deleteImages([imageId])

      // Update album total count
      const album = getAlbum(albumId)
      if (album) {
        updateAlbum(albumId, { totalImages: Math.max(0, album.totalImages - 1) })
      }

      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to delete image:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('album:deleteImages', async (_event, albumId: string, imageIds: number[]) => {
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

      // Delete from cloud
      if (serverIds.length > 0) {
        await albumsApi.deleteImages(albumId, serverIds)
      }

      // Delete from local database
      deleteImages(imageIds)

      // Update album total count
      const album = getAlbum(albumId)
      if (album) {
        updateAlbum(albumId, { totalImages: Math.max(0, album.totalImages - imageIds.length) })
      }

      return { success: true, deletedCount: imageIds.length }
    } catch (error: unknown) {
      logger.error('Failed to delete images:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('album:scanSourceFolder', (_event, folderPath: string) => {
    try {
      const images = scanImagesInFolder(folderPath)
      return { success: true, count: images.length, images }
    } catch (error: unknown) {
      logger.error('Failed to scan folder:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error), count: 0, images: [] }
    }
  })

  ipcMain.handle('album:startUpload', async (_event, albumId: string) => {
    try {
      uploadPipeline.startPipeline(albumId, mainWindow).catch((error) => {
        logger.error('Pipeline failed:', getErrorMessage(error))
      })
      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to start upload:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('album:getProgress', (_event, albumId: string) => {
    try {
      const progress = uploadPipeline.getProgress(albumId)
      return { success: true, progress }
    } catch (error: unknown) {
      logger.error('Failed to get progress:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('album:retryFailed', async (_event, albumId: string) => {
    try {
      await uploadPipeline.retryFailed(albumId, mainWindow)
      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to retry failed uploads:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Show item in folder
  ipcMain.handle('shell:showItemInFolder', (_event, albumId: string, imageId: number) => {
    try {
      const album = getAlbum(albumId)
      if (!album) {
        return { success: false, error: 'Album not found' }
      }

      const images = getAlbumImages(albumId)
      const image = images.find((img) => img.id === imageId)
      if (!image) {
        return { success: false, error: 'Image not found' }
      }

      const originalPath = join(album.sourceFolderPath, image.originalFilename)
      if (!existsSync(originalPath)) {
        return { success: false, error: 'Original file not found' }
      }

      shell.showItemInFolder(originalPath)
      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to show item in folder:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
