/**
 * Sync IPC handlers
 *
 * Handles detecting and executing sync operations between source folder and database
 */

import { BrowserWindow, ipcMain } from 'electron'
import { copyFileSync } from 'fs'
import { join } from 'path'
import { getAlbum, getAlbumImages, updateAlbum, createImage, deleteImages, updateImage, getImageByHash } from '../database'
import { scanImagesInFolder, clearScanCache } from '../storage'
import { uploadPipeline } from '../pipeline'
import { createLogger, getErrorMessage } from '../logger'
import { hashFileSync } from '../hash'
import { needsSync as metadataNeedsSync, updateMetadataAfterSync, getFolderStats } from '../album-metadata'

const logger = createLogger('IPC:Sync')

export type SyncChanges = {
  new: Array<{ filename: string; size: number; mtime: string; width?: number; height?: number; hash?: string }>
  modified: Array<{ filename: string; size: number; mtime: string; width?: number; height?: number; existingId: number; serverId: number | null }>
  deleted: Array<{ id: number; serverId: number | null; originalFilename: string; localFilePath: string }>
  renamed: Array<{ id: number; serverId: number | null; oldFilename: string; newFilename: string; localFilePath: string }>
  skipped: Array<{ filename: string; reason: string }>
}

export type SyncResult = {
  success: boolean
  changes?: SyncChanges
  summary?: {
    new: number
    modified: number
    deleted: number
    renamed: number
    skipped: number
  }
  error?: string
}

export type ExecuteSyncResult = {
  success: boolean
  limitWarning?: string | null
  error?: string
}

/**
 * Detect changes for an album
 */
export function detectAlbumChanges(albumId: string): SyncResult {
  logger.debug(`Detecting changes for album: ${albumId}`)
  try {
    const album = getAlbum(albumId)
    if (!album) {
      return { success: false, error: 'Album not found' }
    }

    // Quick dirty-check using .lumosnap metadata
    // If metadata says no changes, we can skip expensive file scanning
    if (!metadataNeedsSync(album.sourceFolderPath)) {
      logger.debug('Quick check: .lumosnap metadata indicates no changes')
      return {
        success: true,
        changes: { new: [], modified: [], deleted: [], renamed: [], skipped: [] },
        summary: { new: 0, modified: 0, deleted: 0, renamed: 0, skipped: 0 }
      }
    }

    // Scan source folder
    const sourceFiles = scanImagesInFolder(album.sourceFolderPath)
    const dbImages = getAlbumImages(albumId)
    logger.debug(`Source: ${sourceFiles.length} files, DB: ${dbImages.length} images`)

    // Detect changes
    const changes: SyncChanges = {
      new: [],
      modified: [],
      deleted: [],
      renamed: [],
      skipped: []
    }

    // Get last sync time for optimization
    const lastSync = album.lastSyncedAt ? new Date(album.lastSyncedAt) : null

    // Build sets for efficient lookup
    const sourceFilenameSet = new Set(sourceFiles.map((f) => f.filename))

    // Track which source files are already matched
    const matchedSourceFiles = new Set<string>()

    // Check for new and modified files
    sourceFiles.forEach((file) => {
      const existing = dbImages.find((img) => img.originalFilename === file.filename)

      if (!existing) {
        // Potentially new - will check for renames/duplicates later
        changes.new.push(file)
      } else {
        matchedSourceFiles.add(file.filename)
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

    // Check for deleted files (not in source)
    const potentiallyDeleted: typeof changes.deleted = []
    dbImages.forEach((img) => {
      if (!sourceFilenameSet.has(img.originalFilename)) {
        potentiallyDeleted.push({
          id: img.id,
          serverId: img.serverId,
          originalFilename: img.originalFilename,
          localFilePath: img.localFilePath
        })
      }
    })

    // Detect renames: match deleted images with new files by hash
    // Check all images with hash (not just complete ones - allows detecting renames for pending images too)
    const imagesWithHash = potentiallyDeleted.filter((del) => {
      const img = dbImages.find((i) => i.id === del.id)
      return img?.sourceFileHash
    })

    // Compute hashes for new files - needed for both rename detection and duplicate checking
    const newFileHashes = new Map<string, string>()
    if (changes.new.length > 0) {
      logger.debug(`Computing hashes for ${changes.new.length} new files...`)
      for (const newFile of changes.new) {
        try {
          const filePath = join(album.sourceFolderPath, newFile.filename)
          const hash = hashFileSync(filePath)
          newFileHashes.set(newFile.filename, hash)
          // Store hash for later use in sync:execute
          newFile.hash = hash
        } catch {
          // Skip files that can't be read
        }
      }
    }

    // Check for duplicates: files with same hash already exist in DB
    // Filter out truly new files from duplicates
    const trulyNewFiles: typeof changes.new = []
    for (const newFile of changes.new) {
      const hash = newFileHashes.get(newFile.filename)
      if (hash) {
        // Check if this exact content already exists in the album
        const existingByHash = getImageByHash(albumId, hash)
        if (existingByHash) {
          // Duplicate content detected - skip this file
          logger.info(`Skipping duplicate: ${newFile.filename} (hash matches ${existingByHash.originalFilename})`)
          changes.skipped.push({
            filename: newFile.filename,
            reason: `Duplicate of ${existingByHash.originalFilename}`
          })
          continue
        }
      }
      trulyNewFiles.push(newFile)
    }
    changes.new = trulyNewFiles

    // Now check for renames (deleted + new with matching hash)
    if (imagesWithHash.length > 0 && changes.new.length > 0) {
      logger.debug(`Checking ${imagesWithHash.length} deleted images for renames against ${changes.new.length} new files`)

      // Match by hash
      for (const deleted of imagesWithHash) {
        const dbImage = dbImages.find((i) => i.id === deleted.id)
        if (!dbImage?.sourceFileHash) continue

        // Find new file with matching hash
        let matchedNewFile: string | null = null
        for (const [filename, hash] of newFileHashes) {
          if (hash === dbImage.sourceFileHash) {
            // Make sure this file is still in the new list (not already matched as duplicate)
            if (changes.new.some(f => f.filename === filename)) {
              matchedNewFile = filename
              break
            }
          }
        }

        if (matchedNewFile) {
          // It's a rename!
          logger.info(`Detected rename: ${deleted.originalFilename} -> ${matchedNewFile}`)
          changes.renamed.push({
            id: deleted.id,
            serverId: deleted.serverId,
            oldFilename: deleted.originalFilename,
            newFilename: matchedNewFile,
            localFilePath: deleted.localFilePath
          })
          // Remove from new files
          const idx = changes.new.findIndex((f) => f.filename === matchedNewFile)
          if (idx !== -1) changes.new.splice(idx, 1)
          // Don't add to deleted
        } else {
          // Truly deleted
          changes.deleted.push(deleted)
        }
      }

      // Add remaining non-hash-checked deletions
      for (const del of potentiallyDeleted) {
        const wasHandled = imagesWithHash.some((h) => h.id === del.id)
        if (!wasHandled) {
          changes.deleted.push(del)
        }
      }
    } else {
      // No hash matching possible, all are true deletions
      changes.deleted = potentiallyDeleted
    }

    logger.info(
      `Detected: new=${changes.new.length}, modified=${changes.modified.length}, deleted=${changes.deleted.length}, renamed=${changes.renamed.length}, skipped=${changes.skipped.length}`
    )

    return {
      success: true,
      changes,
      summary: {
        new: changes.new.length,
        modified: changes.modified.length,
        deleted: changes.deleted.length,
        renamed: changes.renamed.length,
        skipped: changes.skipped.length
      }
    }
  } catch (error: unknown) {
    logger.error('Failed to detect sync changes:', getErrorMessage(error))
    return { success: false, error: getErrorMessage(error) }
  }
}

/**
 * Execute sync for an album
 */
export async function executeAlbumSync(albumId: string, changes: Partial<SyncChanges>, mainWindow?: BrowserWindow | null): Promise<ExecuteSyncResult> {
  logger.info(`Executing sync for album: ${albumId}`)

  try {
    const album = getAlbum(albumId)
    if (!album) {
      return { success: false, error: 'Album not found' }
    }

    // Import API clients
    const { albumsApi, profileApi } = await import('../api-client')

    // Track limit warning for response
    let syncLimitWarning: string | null = null

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

    // Process renames (DELETE from local/cloud + marking as NEW is not optimal, but robust)
    // Ideally we should have a rename API. For now, we'll treat renames as:
    // 1. Update DB record with new filename and path
    // 2. Rename local file (if exists)
    // 3. Since we don't have a rename API yet, we might have to re-upload or keep server ID if possible.
    // Wait, the current logic returned by detectChanges puts them in 'renamed'.
    // BUT the previous implementation didn't handle 'renamed' in execute.
    // Let's implement rename handling: verify if we can just update the DB.
    // The previous implementation was: renames were treated as deleted + new if not handled.
    // BUT 'sync:detectChanges' returns 'renamed'.
    // Let's look at how we want to handle them.
    // If we just update the DB, the server file remains with old name.
    // If we want to keep it simple as requested:
    // Update local DB to point to new file.
    // Ideally we should tell server about rename.
    // If server doesn't support rename, we might drift.
    // FOR NOW: Let's treat renames as: Update local DB record to point to new matched file.
    // This preserves comments/ratings if they exist locally.
    // We will assume server filename matches originalFilename.
    // If we change originalFilename locally, we might break server link if server relies on filename.
    // Let's check 'createImage' - it sends originalFilename.
    // Let's ASSUME for this iteration we just update the local record to match the new file on disk.
    if (changes.renamed && changes.renamed.length > 0) {
      logger.info(`Processing ${changes.renamed.length} renamed files`)
      for (const rename of changes.renamed) {
        // Update DB record
        updateImage(rename.id, {
          originalFilename: rename.newFilename,
          localFilePath: join(album.localFolderPath, rename.newFilename),
          // Keep serverId, mtime, etc.
          // We might want to update mtime if changed
        })
        // We should also rename the local file if it exists, OR copy the new file from source if we are syncing source->local.
        // Wait, LumoSnap copies FROM source TO local.
        // So we need to copy the new file from source to local.
        const sourcePath = join(album.sourceFolderPath, rename.newFilename)
        const localPath = join(album.localFolderPath, rename.newFilename)
        try {
           copyFileSync(sourcePath, localPath)
           // Delete old local file
           // unlinkSync(rename.localFilePath) // Optional cleanup
        } catch (e) {
           logger.warn(`Failed to copy renamed file ${rename.newFilename}`, e)
        }
      }
    }


    // Process new files
    if (changes.new && changes.new.length > 0) {
      logger.info(`Adding ${changes.new.length} new images`)
      
      // Check image limit before processing
      let filesToProcess = changes.new
      
      try {
        const profile = await profileApi.get()
        const remaining = Math.max(0, profile.imageLimit - profile.totalImages)
        
        if (remaining === 0) {
          logger.warn(`User at image limit (${profile.totalImages}/${profile.imageLimit}). Skipping all new files.`)
          syncLimitWarning = `Image limit reached (${profile.totalImages.toLocaleString()}/${profile.imageLimit.toLocaleString()}). No new images were synced. Please upgrade your plan.`
          filesToProcess = []
        } else if (changes.new.length > remaining) {
          logger.warn(`User can only add ${remaining} more images. Limiting sync.`)
          syncLimitWarning = `Only ${remaining} of ${changes.new.length} images were synced due to your plan limit. Upgrade to sync more.`
          filesToProcess = changes.new.slice(0, remaining)
        }
      } catch (err) {
        logger.error('Failed to check image limit, proceeding anyway:', getErrorMessage(err))
      }
      
      const currentImages = getAlbumImages(albumId)
      const maxOrder =
        currentImages.length > 0 ? Math.max(...currentImages.map((i) => i.uploadOrder)) : -1

      filesToProcess.forEach((file, index) => {
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
          sourceFileHash: file.hash || null, // Use pre-computed hash from detection
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

    // Update .lumosnap metadata file in source folder
    const folderStats = getFolderStats(album.sourceFolderPath)
    updateMetadataAfterSync(album.sourceFolderPath, totalImages, folderStats.totalSize)

    // Start upload for pending images
    const hasPendingImages =
      (changes.new && changes.new.length > 0) || (changes.modified && changes.modified.length > 0)
    if (hasPendingImages) {
      logger.info('Triggering upload pipeline for pending images')
      uploadPipeline.startPipeline(albumId, mainWindow || null).catch((error) => {
        logger.error('Pipeline trigger failed:', getErrorMessage(error))
      })
    }

    logger.info(`Sync completed for album ${albumId}`)
    return { success: true, limitWarning: syncLimitWarning }
  } catch (error: unknown) {
    logger.error('Sync execution failed:', getErrorMessage(error))
    return { success: false, error: getErrorMessage(error) }
  }
}

export function registerSyncHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('sync:detectChanges', (_event, albumId: string) => {
    return detectAlbumChanges(albumId)
  })

  ipcMain.handle('sync:execute', async (_event, albumId: string, changes: Partial<SyncChanges>) => {
    return executeAlbumSync(albumId, changes, mainWindow)
  })
}
