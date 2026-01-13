import { BrowserWindow } from 'electron'
import { join, basename, dirname } from 'path'
import { getAlbum, getAlbumImages, updateImage } from './database'
import { albumsApi, uploadToPresignedUrl } from './api-client'
import { compressionPool } from './compression-pool'

export interface UploadProgress {
  albumId: string
  total: number
  pending: number
  compressing: number
  uploading: number
  complete: number
  failed: number
}

class UploadPipeline {
  private compressionConcurrency = 4
  private uploadBatchSize = 100
  private isRunning = false
  private queuedAlbums: Set<string> = new Set()
  private mainWindowRef: BrowserWindow | null = null

  async startPipeline(albumId: string, mainWindow: BrowserWindow | null): Promise<void> {
    // Store mainWindow reference for queue processing
    if (mainWindow) {
      this.mainWindowRef = mainWindow
    }

    if (this.isRunning) {
      console.log(`[Pipeline] Pipeline already running, queuing album ${albumId}`)
      this.queuedAlbums.add(albumId)
      return
    }

    this.isRunning = true
    console.log(`[Pipeline] Pipeline started for album ${albumId}`)

    try {
      // Get all pending images
      const images = getAlbumImages(albumId)
      const pendingImages = images.filter(
        (img) => img.uploadStatus === 'pending' || img.uploadStatus === 'failed'
      )

      console.log(
        `[Pipeline] Found ${images.length} total images, ${pendingImages.length} pending/failed`
      )

      if (pendingImages.length === 0) {
        console.log(`[Pipeline] No pending images for album ${albumId}, exiting`)
        this.isRunning = false
        if (mainWindow) {
          mainWindow.webContents.send('upload:complete', { albumId })
        }
        return
      }

      // Process in batches
      const totalBatches = Math.ceil(pendingImages.length / this.uploadBatchSize)
      console.log(
        `[Pipeline] Processing in ${totalBatches} batches of size ${this.uploadBatchSize}`
      )

      for (let i = 0; i < pendingImages.length; i += this.uploadBatchSize) {
        const batchIndex = Math.floor(i / this.uploadBatchSize) + 1
        const batchImages = pendingImages.slice(i, i + this.uploadBatchSize)

        console.log(
          `[Pipeline] Starting Batch ${batchIndex}/${totalBatches} (${batchImages.length} images)`
        )

        // Notify start of batch
        if (mainWindow) {
          mainWindow.webContents.send('upload:batch-start', {
            batchIndex,
            totalBatches,
            batchSize: batchImages.length
          })
        }

        await this.processBatch(albumId, batchImages, mainWindow)

        console.log(`[Pipeline] Completed Batch ${batchIndex}/${totalBatches}`)
      }

      console.log(`[Pipeline] Pipeline completed successfully for album ${albumId}`)
      if (mainWindow) {
        mainWindow.webContents.send('upload:complete', { albumId })
      }
    } catch (error) {
      console.error(`[Pipeline] Pipeline failed for album ${albumId}:`, error)
      if (mainWindow) {
        mainWindow.webContents.send('upload:error', { error: (error as Error).message })
      }
      throw error
    } finally {
      this.isRunning = false
      console.log(`[Pipeline] Pipeline isRunning flag reset`)

      // Process next queued album
      if (this.queuedAlbums.size > 0) {
        const nextAlbumId = this.queuedAlbums.values().next().value
        if (nextAlbumId) {
          this.queuedAlbums.delete(nextAlbumId)
          console.log(`[Pipeline] Processing next queued album: ${nextAlbumId}`)
          // Use setImmediate to avoid stack overflow with many queued albums
          setImmediate(() => {
            this.startPipeline(nextAlbumId, this.mainWindowRef).catch((error) => {
              console.error(`[Pipeline] Queued pipeline failed for ${nextAlbumId}:`, error)
            })
          })
        }
      }
    }
  }

  private async processBatch(
    albumId: string,
    batchImages: any[],
    mainWindow: BrowserWindow | null
  ): Promise<void> {
    // 1. Compression Step
    console.log(`[Pipeline] Batch: Compressing ${batchImages.length} images...`)
    const compressedImages: any[] = []

    // Process compression in parallel chunks to respect concurrency limit
    const compressionQueue = [...batchImages]
    const activeCompressions: Promise<void>[] = []

    while (compressionQueue.length > 0 || activeCompressions.length > 0) {
      while (
        activeCompressions.length < this.compressionConcurrency &&
        compressionQueue.length > 0
      ) {
        const image = compressionQueue.shift()!
        const task = this.compressImageTask(image, mainWindow).then((success) => {
          if (success) compressedImages.push(image)
        })
        activeCompressions.push(task)

        // Remove completed task from active list
        task.finally(() => {
          activeCompressions.splice(activeCompressions.indexOf(task), 1)
        })
      }

      if (activeCompressions.length > 0) {
        await Promise.race(activeCompressions)
      }
    }

    if (compressedImages.length === 0) {
      console.log('[Pipeline] Batch: No images successfully compressed, skipping upload')
      return
    }

    // 2. Upload Step
    console.log(`[Pipeline] Batch: Uploading ${compressedImages.length} images...`)

    try {
      // Request signed URLs for the batch
      const signedUrls = await albumsApi.getUploadUrls(
        albumId,
        compressedImages.map((img) => ({
          filename: basename(img.localFilePath)
        }))
      )

      // Track uploaded images with their local IDs for reliable matching
      const uploadedImages: Array<{
        localId: number
        serverId: number | null // If set, this is a modified file that needs PATCH
        filename: string
        sourceImageHash: string | null
        key: string
        fileSize: number
        width: number
        height: number
        uploadOrder: number
      }> = []
      const uploadQueue = compressedImages.map((img, index) => ({
        img,
        signedUrl: signedUrls[index]
      }))
      const activeUploads: Promise<void>[] = []
      const uploadConcurrency = 5 // Limit concurrent uploads

      while (uploadQueue.length > 0 || activeUploads.length > 0) {
        while (activeUploads.length < uploadConcurrency && uploadQueue.length > 0) {
          const { img, signedUrl } = uploadQueue.shift()!

          const task = (async () => {
            try {
              updateImage(img.id, { uploadStatus: 'uploading' })
              if (mainWindow) {
                mainWindow.webContents.send('upload:progress', this.getProgress(albumId))
              }

              // Upload main image
              const result = await uploadToPresignedUrl(signedUrl.uploadUrl, img.localFilePath)

              if (result.success) {
                uploadedImages.push({
                  localId: img.id,
                  serverId: img.serverId, // Track if this was a modified file
                  filename: signedUrl.filename,
                  sourceImageHash: img.sourceFileHash, // Use hash from DB (computed during compression)
                  key: signedUrl.key,
                  fileSize: img.fileSize,
                  width: img.width,
                  height: img.height,
                  uploadOrder: img.uploadOrder
                })
              } else {
                updateImage(img.id, { uploadStatus: 'failed' })
              }
            } catch (err) {
              console.error(`[Pipeline] Upload failed for ${img.id}:`, err)
              updateImage(img.id, { uploadStatus: 'failed' })
            }
          })()

          activeUploads.push(task)
          task.finally(() => {
            activeUploads.splice(activeUploads.indexOf(task), 1)
          })
        }

        if (activeUploads.length > 0) {
          await Promise.race(activeUploads)
        }
      }

      // 3. Confirm Step - handle new and modified images differently
      if (uploadedImages.length > 0) {
        // Split into new images (no serverId) and modified images (has serverId)
        const newImages = uploadedImages.filter((u) => u.serverId === null)
        const modifiedImages = uploadedImages.filter((u) => u.serverId !== null)

        // Confirm new uploads
        if (newImages.length > 0) {
          console.log(`[Pipeline] Batch: Confirming ${newImages.length} new uploads...`)

          const confirmPayload = newImages.map((u) => ({
            filename: u.filename,
            sourceImageHash: u.sourceImageHash,
            key: u.key,
            fileSize: u.fileSize,
            width: u.width,
            height: u.height,
            uploadOrder: u.uploadOrder
          }))

          const confirmed = await albumsApi.confirmUpload(albumId, confirmPayload)

          // Match confirmed results back to local images by filename
          for (const conf of confirmed) {
            const uploaded = newImages.find((u) => u.filename === conf.originalFilename)
            if (uploaded) {
              updateImage(uploaded.localId, {
                uploadStatus: 'complete',
                serverId: conf.id
              })
              console.log(
                `[Pipeline] Image ${uploaded.localId} marked complete with serverId ${conf.id}`
              )
              if (mainWindow) {
                mainWindow.webContents.send('upload:progress', this.getProgress(albumId))
              }
            } else {
              console.warn(
                `[Pipeline] Could not find local image for confirmed file: ${conf.originalFilename}`
              )
            }
          }
        }

        // Update modified images via PATCH
        if (modifiedImages.length > 0) {
          console.log(
            `[Pipeline] Batch: Updating ${modifiedImages.length} modified images via PATCH...`
          )

          const updatePayload = modifiedImages.map((u) => ({
            imageId: u.serverId!,
            sourceImageHash: u.sourceImageHash,
            b2FileName: u.key,
            fileSize: u.fileSize,
            width: u.width,
            height: u.height
          }))

          await albumsApi.updateImages(albumId, updatePayload)

          // Mark modified images as complete
          for (const uploaded of modifiedImages) {
            updateImage(uploaded.localId, { uploadStatus: 'complete' })
            console.log(
              `[Pipeline] Modified image ${uploaded.localId} (serverId ${uploaded.serverId}) updated successfully`
            )
            if (mainWindow) {
              mainWindow.webContents.send('upload:progress', this.getProgress(albumId))
            }
          }
        }
      }
    } catch (error) {
      console.error('[Pipeline] Batch upload failed:', error)
      compressedImages.forEach((img) => updateImage(img.id, { uploadStatus: 'failed' }))
    }
  }

  private async compressImageTask(image: any, mainWindow: BrowserWindow | null): Promise<boolean> {
    try {
      updateImage(image.id, { uploadStatus: 'compressing' })
      if (mainWindow)
        mainWindow.webContents.send('upload:progress', this.getProgress(image.albumId))

      const album = getAlbum(image.albumId)
      if (!album) throw new Error(`Album ${image.albumId} not found`)

      const sourceFilePath = join(album.sourceFolderPath, image.originalFilename)
      const result = await compressionPool.compress(sourceFilePath, {
        outputDir: dirname(image.localFilePath)
      })

      if (result.success) {
        updateImage(image.id, {
          // Keep status as compressing until upload starts, or change to 'pending_upload' if we had that state
          // For now, keep as compressing or switch to pending?
          // Let's keep it as 'compressing' until upload starts to avoid UI flicker
          fileSize: result.fileSize,
          width: result.width,
          height: result.height,
          localFilePath: result.compressedPath,
          sourceFileHash: result.hash
        })

        // Update in-memory object for next steps
        image.localFilePath = result.compressedPath
        image.thumbnailPath = result.thumbnailPath
        image.fileSize = result.fileSize
        image.width = result.width
        image.height = result.height

        return true
      } else {
        updateImage(image.id, { uploadStatus: 'failed' })
        return false
      }
    } catch (error) {
      console.error(`[Pipeline] Compression failed for ${image.id}:`, error)
      updateImage(image.id, { uploadStatus: 'failed' })
      return false
    }
  }

  getProgress(albumId: string): UploadProgress {
    const images = getAlbumImages(albumId)

    const progress: UploadProgress = {
      albumId,
      total: images.length,
      pending: 0,
      compressing: 0,
      uploading: 0,
      complete: 0,
      failed: 0
    }

    images.forEach((img) => {
      progress[img.uploadStatus]++
    })

    return progress
  }

  async retryFailed(albumId: string, mainWindow: BrowserWindow | null): Promise<void> {
    const images = getAlbumImages(albumId)
    const failedImages = images.filter((img) => img.uploadStatus === 'failed')

    console.log(`Retrying ${failedImages.length} failed images`)

    // Reset failed images to pending
    failedImages.forEach((img) => {
      updateImage(img.id, { uploadStatus: 'pending' })
    })

    // Restart pipeline
    await this.startPipeline(albumId, mainWindow)
  }
}

// Export singleton instance
export const uploadPipeline = new UploadPipeline()
