import { BrowserWindow } from 'electron'
import { join, basename, dirname } from 'path'
import { getAlbum, getAlbumImages, updateImage } from './database'
import { albumsApi, uploadToPresignedUrl } from './api-client'
import { compressImage } from './compresss-image'

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

  async startPipeline(albumId: string, mainWindow: BrowserWindow | null): Promise<void> {
    if (this.isRunning) {
      console.log(`[Pipeline] Pipeline already running for album ${albumId}`)
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
        filename: string
        b2FileId: string
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

              const result = await uploadToPresignedUrl(signedUrl.uploadUrl, img.localFilePath)

              if (result.success && result.b2FileId) {
                uploadedImages.push({
                  localId: img.id, // Track local ID for matching after confirm
                  filename: signedUrl.filename,
                  b2FileId: result.b2FileId,
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

      // 3. Confirm Step
      if (uploadedImages.length > 0) {
        console.log(`[Pipeline] Batch: Confirming ${uploadedImages.length} uploads...`)

        // Send only the fields the API expects
        const confirmPayload = uploadedImages.map((u) => ({
          filename: u.filename,
          b2FileId: u.b2FileId,
          fileSize: u.fileSize,
          width: u.width,
          height: u.height,
          uploadOrder: u.uploadOrder
        }))

        const confirmed = await albumsApi.confirmUpload(albumId, confirmPayload)

        // Match confirmed results back to local images by filename
        for (const conf of confirmed) {
          const uploaded = uploadedImages.find((u) => u.filename === conf.originalFilename)
          if (uploaded) {
            updateImage(uploaded.localId, {
              uploadStatus: 'complete',
              serverId: conf.id
            })
            console.log(
              `[Pipeline] Image ${uploaded.localId} marked complete with serverId ${conf.id}`
            )
            // Send progress update after each image is marked complete
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
      const result = await compressImage(sourceFilePath, {
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
          localFilePath: result.compressedPath
        })

        // Update in-memory object for next steps
        image.localFilePath = result.compressedPath
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
