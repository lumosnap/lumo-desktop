/**
 * Sync IPC handlers
 *
 * Handles detecting and executing sync operations between source folder and database
 */

import { BrowserWindow, ipcMain } from 'electron'
import { copyFileSync } from 'fs'
import { join } from 'path'
import { getAlbum, getAlbumImages, updateAlbum, createImage, deleteImages, updateImage } from '../database'
import { scanImagesInFolder, clearScanCache } from '../storage'
import { uploadPipeline } from '../pipeline'
import { createLogger, getErrorMessage } from '../logger'

const logger = createLogger('IPC:Sync')

export function registerSyncHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('sync:detectChanges', (_event, albumId: string) => {
    logger.debug(`Detecting changes for album: ${albumId}`)
    try {
      const album = getAlbum(albumId)
      if (!album) {
        return { success: false, error: 'Album not found' }
      }

      // Scan source folder
      const sourceFiles = scanImagesInFolder(album.sourceFolderPath)
      const dbImages = getAlbumImages(albumId)
      logger.debug(`Source: ${sourceFiles.length} files, DB: ${dbImages.length} images`)

      // Detect changes
      const changes = {
        new: [] as Array<{ filename: string; size: number; mtime: string; width?: number; height?: number }>,
        modified: [] as Array<{ filename: string; size: number; mtime: string; width?: number; height?: number; existingId: number; serverId: number | null }>,
        deleted: [] as Array<{ id: number; serverId: number | null; originalFilename: string; localFilePath: string }>
      }

      // Get last sync time for optimization
      const lastSync = album.lastSyncedAt ? new Date(album.lastSyncedAt) : null

      // Check for new and modified files
      sourceFiles.forEach((file) => {
        const existing = dbImages.find((img) => img.originalFilename === file.filename)

        if (!existing) {
          changes.new.push(file)
        } else {
          const fileMtime = new Date(file.mtime)
          if (!lastSync || fileMtime > lastSync) {
            const existingMtime = new Date(existing.mtime).getTime()
            const currentMtime = fileMtime.getTime()
            const mtimeChanged = existingMtime !== currentMtime
            const sizeChanged = existing.fileSize !== file.size

            if (mtimeChanged || sizeChanged) {
              changes.modified.push({
                ...file,
                existingId: existing.id,
                serverId: existing.serverId
              })
            }
          }
        }
      })

      // Check for deleted files
      dbImages.forEach((img) => {
        const exists = sourceFiles.find((file) => file.filename === img.originalFilename)
        if (!exists) {
          changes.deleted.push({
            id: img.id,
            serverId: img.serverId,
            originalFilename: img.originalFilename,
            localFilePath: img.localFilePath
          })
        }
      })

      logger.info(
        `Detected: new=${changes.new.length}, modified=${changes.modified.length}, deleted=${changes.deleted.length}`
      )

      return {
        success: true,
        changes,
        summary: {
          new: changes.new.length,
          modified: changes.modified.length,
          deleted: changes.deleted.length
        }
      }
    } catch (error: unknown) {
      logger.error('Failed to detect sync changes:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('sync:execute', async (_event, albumId: string, changes: {
    new?: Array<{ filename: string; size: number; mtime: string; width?: number; height?: number }>;
    modified?: Array<{ filename: string; size: number; mtime: string; width?: number; height?: number; existingId: number }>;
    deleted?: Array<{ id: number; serverId: number | null }>
  }) => {
    logger.info(`Executing sync for album: ${albumId}`)

    try {
      const album = getAlbum(albumId)
      if (!album) {
        return { success: false, error: 'Album not found' }
      }

      // Import albumsApi here to avoid circular dependency issues
      const { albumsApi } = await import('../api-client')

      // Process deleted files FIRST
      if (changes.deleted && changes.deleted.length > 0) {
        logger.info(`Deleting ${changes.deleted.length} images`)

        // Get server IDs for API call
        const serverIds = changes.deleted
          .filter((img) => img.serverId != null)
          .map((img) => img.serverId!)

        // Delete from cloud
        if (serverIds.length > 0) {
          await albumsApi.deleteImages(albumId, serverIds)
        }

        // Delete from local database
        const localIds = changes.deleted.map((img) => img.id)
        deleteImages(localIds)
      }

      // Process new files
      if (changes.new && changes.new.length > 0) {
        logger.info(`Adding ${changes.new.length} new images`)
        const currentImages = getAlbumImages(albumId)
        const maxOrder =
          currentImages.length > 0 ? Math.max(...currentImages.map((i) => i.uploadOrder)) : -1

        changes.new.forEach((file, index) => {
          const localFilePath = join(album.localFolderPath, file.filename)
          const sourceFilePath = join(album.sourceFolderPath, file.filename)

          try {
            copyFileSync(sourceFilePath, localFilePath)
          } catch (err) {
            logger.error(`Failed to copy file ${file.filename}:`, getErrorMessage(err))
            return
          }

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
            uploadOrder: maxOrder + index + 1
          })
        })
      }

      // Process modified files
      if (changes.modified && changes.modified.length > 0) {
        logger.info(`Processing ${changes.modified.length} modified files`)

        for (const file of changes.modified) {
          const localFilePath = join(album.localFolderPath, file.filename)
          const sourceFilePath = join(album.sourceFolderPath, file.filename)

          // Copy updated source file
          try {
            copyFileSync(sourceFilePath, localFilePath)
          } catch (err) {
            logger.error(`Failed to copy updated file ${file.filename}:`, getErrorMessage(err))
            continue
          }

          // Update database record: reset status to pending
          updateImage(file.existingId, {
            uploadStatus: 'pending',
            mtime: file.mtime,
            fileSize: file.size,
            width: file.width || 0,
            height: file.height || 0
          })
        }
      }

      // Update album metadata
      const totalImages = getAlbumImages(albumId).length
      updateAlbum(albumId, {
        totalImages,
        needsSync: 0,
        lastSyncedAt: new Date().toISOString()
      })

      // Clear scan cache
      clearScanCache(album.sourceFolderPath)

      // Start upload for pending images
      const hasPendingImages =
        (changes.new && changes.new.length > 0) || (changes.modified && changes.modified.length > 0)
      if (hasPendingImages) {
        logger.info('Triggering upload pipeline for pending images')
        uploadPipeline.startPipeline(albumId, mainWindow).catch((error) => {
          logger.error('Pipeline trigger failed:', getErrorMessage(error))
        })
      }

      logger.info(`Sync completed for album ${albumId}`)
      return { success: true }
    } catch (error: unknown) {
      logger.error('Sync execution failed:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
