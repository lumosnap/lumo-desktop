/**
 * Album IPC handlers
 */

import { BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { getStorageLocation } from '../config'
import { createAlbumFolder, scanImagesInFolder } from '../storage'
import {
  createAlbum,
  getAlbum,
  getAllAlbums,
  deleteAlbum as dbDeleteAlbum,
  createImagesBatch,
  runInTransaction,
  getAlbumImages,
  getAlbumTags,
  getAlbumTagSet,
  setAlbumTagSet,
  setAlbumEventType,
  setTagOverride,
  deleteImages,
  updateAlbum,
  listSets,
  createSet,
  createSetFromMoment,
  renameSet,
  deleteSet,
  reorderSets,
  addImagesToSet,
  removeImagesFromSet,
  setSetCover,
  getImageNotes,
  setImageNote,
  getAlbumNote,
  setAlbumNote,
  getImageDone,
  setImageDone
} from '../database'
import { albumsApi } from '../api-client'
import { uploadPipeline } from '../pipeline'
import {
  analyzeAlbum,
  regroupAlbum,
  scheduleSetsPush,
  cancelTagging,
  rescoreAlbum,
  scheduleTagsPush
} from '../album-analysis'
import {
  TAGS,
  TAG_PACKS,
  EVENT_TYPE_LABELS,
  eventTypeOf,
  isEventType,
  tagLabel,
  type EventType,
  type TagCategory
} from '../tags/vocabulary'
import { TAG_SLUG } from '../tags/select'
import { imagePeople, peoplePhotosChanged } from '../people'
import { watcherService } from '../watcher'
import { createLogger, getErrorMessage } from '../logger'
import { handleIpc } from './types'

const logger = createLogger('IPC:Album')

export interface TagConfig {
  eventType: EventType
  eventTypes: Array<{ id: EventType; label: string }>
  enabled: string[] | null // null = the event type's pack
  vocabulary: Array<{ slug: string; label: string; category: TagCategory }> // every event type's tags
  pack: string[] // default tags of the current event type
}

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
        albumType?: 'watch_folder' | 'standalone'
        eventType?: unknown
      }
    ) => {
      try {
        const eventType = data.eventType ?? 'wedding'
        if (!isEventType(eventType)) throw new Error('Invalid event type')
        const storageLocation = getStorageLocation()
        if (!storageLocation) {
          throw new Error('Storage location not configured')
        }

        const albumType = data.albumType || 'watch_folder'

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
          albumType,
          totalImages: 0,
          lastSyncedAt: null,
          needsSync: 0,
          isOrphaned: 0,
          event_type: eventType
        })

        // Scan source folder for images
        const imageFiles = scanImagesInFolder(data.sourceFolderPath)

        // Create image records and update total in one transaction
        runInTransaction(() => {
          createImagesBatch(
            imageFiles.map((file, index) => ({
              albumId: album.id,
              serverId: null,
              originalFilename: file.filename,
              localFilePath: join(localFolderPath, file.filename),
              fileSize: file.size,
              width: file.width || 0,
              height: file.height || 0,
              mtime: file.mtime,
              sourceFileHash: null,
              uploadStatus: 'pending' as const,
              uploadOrder: index
            }))
          )
          updateAlbum(album.id, { totalImages: imageFiles.length })
        })

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
          watcherService.checkSyncStatus(album.id).catch((err) => {
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

      // Trigger background sync check
      if (existsSync(album.sourceFolderPath)) {
        watcherService.checkSyncStatus(albumId).catch((err) => {
          logger.error(`Background sync check failed for ${albumId}:`, getErrorMessage(err))
        })
      }

      // Background backfill + grouping, once per album per session
      analyzeAlbum(albumId)

      return { success: true, album: { ...album, needsSync: album.needsSync } }
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
      cancelTagging(albumId)

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
      const tags = getAlbumTags(albumId)
      const people = imagePeople(albumId)

      // Favorites are now loaded separately by the frontend to improve performance
      // Return images without favorite info (frontend will enrich later)
      // Browse columns are snake_case in SQLite; the renderer gets camelCase
      const imagesWithFavorites = images.map((row) => {
        const {
          captured_at,
          camera_id,
          burst_id,
          is_burst_cover,
          moment_id,
          needs_push,
          tags_need_push,
          ...img
        } = row
        void needs_push
        void tags_need_push
        return {
          ...img,
          capturedAt: captured_at ?? null,
          cameraId: camera_id ?? null,
          rating: img.rating ?? null,
          phash: img.phash ?? null,
          sharpness: img.sharpness ?? null,
          thumbhash: img.thumbhash ?? null,
          burstId: burst_id ?? null,
          isBurstCover: is_burst_cover === 1,
          momentId: moment_id ?? null,
          tags: tags.get(row.id) ?? [], // effective: manual adds, then AI tags not removed
          people: people.get(row.id) ?? [], // people with a reference or auto face here
          isFavorite: false,
          favoriteCount: 0,
          notesCount: 0,
          comments: []
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
      regroupAlbum(albumId)
      peoplePhotosChanged(albumId)

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
      regroupAlbum(albumId)
      peoplePhotosChanged(albumId)

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

  ipcMain.handle('album:copyImages', async (_event, albumId: string, imageIds: number[]) => {
    try {
      const album = getAlbum(albumId)
      if (!album) {
        return { success: false, error: 'Album not found' }
      }

      const images = getAlbumImages(albumId)
      const imagesToCopy = images.filter((img) => imageIds.includes(img.id))

      if (imagesToCopy.length === 0) {
        return { success: false, error: 'No images selected' }
      }

      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Destination Folder',
        properties: ['openDirectory', 'createDirectory']
      })

      if (canceled || filePaths.length === 0) {
        return { success: false, error: 'Operation canceled' }
      }

      const destinationDir = filePaths[0]
      let successCount = 0
      let errorCount = 0

      // Dynamically import fs/promises to avoid top-level await issues if any
      const { copyFile } = await import('fs/promises')

      for (const img of imagesToCopy) {
        try {
          const sourcePath = join(album.sourceFolderPath, img.originalFilename)
          const destPath = join(destinationDir, img.originalFilename)

          if (existsSync(sourcePath)) {
            await copyFile(sourcePath, destPath)
            successCount++
          } else {
            logger.warn(`Source file not found: ${sourcePath}`)
            errorCount++
          }
        } catch (err) {
          logger.error(`Failed to copy image ${img.originalFilename}:`, getErrorMessage(err))
          errorCount++
        }
      }

      return { success: true, count: successCount, errorCount, destinationDir }
    } catch (error: unknown) {
      logger.error('Failed to copy images:', getErrorMessage(error))
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

  // Backfill browse signals + regroup in the background; resolves immediately
  ipcMain.handle('album:analyze', (_event, albumId: string) => {
    analyzeAlbum(albumId, { force: true })
    return { success: true }
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

  // Force refresh all albums - bypasses debounce for instant results
  ipcMain.handle('albums:forceRefresh', async () => {
    try {
      logger.info('Force refresh requested - bypassing debounce')
      await watcherService.forceRefreshAlbums()
      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to force refresh:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Sets: every mutation returns the album's sets, queues a debounced push and tells the renderer
  ipcMain.handle('sets:list', (_event, albumId: string) => {
    try {
      return { success: true, sets: listSets(albumId) }
    } catch (error: unknown) {
      logger.error('Failed to list sets:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error), sets: [] }
    }
  })

  const cleanName = (name: unknown): string => {
    const n = typeof name === 'string' ? name.trim().slice(0, 120) : ''
    if (!n) throw new Error('Set name is required')
    return n
  }
  const ids = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []

  const setsMutation = <A extends unknown[]>(
    channel: string,
    run: (...args: A) => string // returns the album id
  ): void => {
    ipcMain.handle(channel, (_event, ...args) => {
      try {
        const albumId = run(...(args as A))
        scheduleSetsPush(albumId)
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send('album:setsChanged', { albumId })
        return { success: true, sets: listSets(albumId) }
      } catch (error: unknown) {
        logger.error(`${channel} failed:`, getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
      }
    })
  }

  setsMutation('sets:create', (albumId: string, name: string, imageIds?: number[]) => {
    if (!getAlbum(albumId)) throw new Error('Album not found')
    createSet(albumId, cleanName(name), ids(imageIds))
    return albumId
  })
  setsMutation('sets:fromMoment', (albumId: string, momentId: string, name: string) => {
    if (!getAlbum(albumId)) throw new Error('Album not found')
    createSetFromMoment(albumId, String(momentId), cleanName(name))
    return albumId
  })
  setsMutation('sets:rename', (setId: string, name: string) => renameSet(setId, cleanName(name)))
  setsMutation('sets:delete', (setId: string) => deleteSet(setId))
  setsMutation('sets:reorder', (albumId: string, orderedIds: string[]) => {
    reorderSets(albumId, Array.isArray(orderedIds) ? orderedIds.map(String) : [])
    return albumId
  })
  setsMutation('sets:addImages', (setId: string, imageIds: number[]) =>
    addImagesToSet(setId, ids(imageIds))
  )
  setsMutation('sets:removeImages', (setId: string, imageIds: number[]) =>
    removeImagesFromSet(setId, ids(imageIds))
  )
  setsMutation('sets:setCover', (setId: string, imageId: number | null) =>
    setSetCover(setId, Number.isInteger(imageId) ? imageId : null)
  )

  // Private notes: the photographer's own, on this computer only (never pushed)
  const noteBody = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 5000) : '')
  handleIpc('notes:get', logger, (_event, albumId: string) => ({
    notes: getImageNotes(String(albumId)),
    albumNote: getAlbumNote(String(albumId)),
    done: getImageDone(String(albumId))
  }))
  handleIpc('notes:set', logger, (_event, albumId: string, imageId: unknown, body: unknown) => {
    if (!Number.isInteger(imageId)) throw new Error('Photo id is required')
    setImageNote(String(albumId), imageId as number, noteBody(body))
  })
  handleIpc('notes:setDone', logger, (_event, albumId: string, ids: unknown, done: unknown) => {
    if (!Array.isArray(ids) || !ids.length || !ids.every(Number.isInteger))
      throw new Error('Photo ids are required')
    return { doneAt: setImageDone(String(albumId), ids as number[], done === true) }
  })
  handleIpc('notes:setAlbum', logger, (_event, albumId: string, body: unknown) => {
    setAlbumNote(String(albumId), noteBody(body))
  })

  // AI tags: per-album tag set + manual per-photo overrides
  const vocabulary = TAGS.map((t) => ({
    slug: t.slug,
    label: tagLabel(t.slug),
    category: t.category
  }))
  const eventTypes = Object.entries(EVENT_TYPE_LABELS).map(([id, label]) => ({
    id: id as EventType,
    label
  }))
  const tagConfig = (albumId: string): TagConfig => {
    const eventType = eventTypeOf(getAlbum(albumId)?.event_type)
    return {
      eventType,
      eventTypes,
      enabled: getAlbumTagSet(albumId),
      vocabulary,
      pack: TAG_PACKS[eventType]
    }
  }
  ipcMain.handle('tags:getAlbumConfig', (_event, albumId: string) => tagConfig(albumId))
  ipcMain.handle('tags:setAlbumConfig', async (_event, albumId: string, enabled: unknown) => {
    if (!getAlbum(albumId)) throw new Error('Album not found')
    const known = new Set(TAGS.map((t) => t.slug))
    setAlbumTagSet(
      albumId,
      Array.isArray(enabled) ? [...new Set(enabled.filter((s) => known.has(s)))] : null
    )
    await rescoreAlbum(albumId) // tag set is part of the scoring key, so this always recomputes
    scheduleTagsPush(albumId)
    return tagConfig(albumId)
  })
  ipcMain.handle('tags:setEventType', async (_event, albumId: string, eventType: unknown) => {
    if (!getAlbum(albumId)) throw new Error('Album not found')
    if (!isEventType(eventType)) throw new Error('Invalid event type')
    setAlbumEventType(albumId, eventType) // also resets the tag set to the pack
    await rescoreAlbum(albumId)
    scheduleTagsPush(albumId)
    return tagConfig(albumId)
  })
  for (const action of ['add', 'remove'] as const) {
    ipcMain.handle(`tags:${action}`, (_event, albumId: string, imageIds: unknown, tag: unknown) => {
      try {
        if (typeof tag !== 'string' || !TAG_SLUG.test(tag)) throw new Error('Invalid tag')
        if (!getAlbum(albumId)) throw new Error('Album not found')
        setTagOverride(albumId, ids(imageIds), tag, action)
        scheduleTagsPush(albumId)
        return { success: true }
      } catch (error: unknown) {
        logger.error(`tags:${action} failed:`, getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
      }
    })
  }

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
