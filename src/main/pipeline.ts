import { BrowserWindow } from 'electron'
import { join, basename, extname } from 'path'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import sharp from 'sharp'
import { getAlbum, getAlbumImages, updateImage, updateAlbum, Image } from './database'
import { albumsApi, uploadToPresignedUrl } from './api-client'
import { compressionPool } from './compression-pool'
import { notificationService } from './notifications'
import { createLogger } from './logger'
import { updateMetadataAfterSync, getFolderStats } from './album-metadata'
import { networkService } from './network'
import { AsyncQueue } from './utils/async-queue'
import { hashFile } from './hash'

const log = createLogger('Pipeline')

export interface UploadProgress {
  albumId: string
  total: number
  pending: number
  compressing: number
  uploading: number
  complete: number
  failed: number
  failed_compression: number
  failed_upload: number
}

interface CompressedImage {
  id: number
  albumId: string
  serverId: number | null
  originalFilename: string
  localFilePath: string
  thumbnailPath: string
  fileSize: number
  width: number
  height: number
  sourceFileHash: string
  uploadOrder: number
}

interface UploadedImage {
  localId: number
  serverId: number | null
  filename: string
  sourceImageHash: string | null
  key: string
  fileSize: number
  width: number
  height: number
  uploadOrder: number
  thumbnailKey: string | null
}

class UploadPipeline {
  private compressionConcurrency = 4
  private uploadConcurrency = 5
  private uploadBatchSize = 100 // For presigned URL requests
  private maxQueueSize = 200 // Backpressure control
  private isRunning = false
  private isPaused = false
  private queuedAlbums: Set<string> = new Set()
  private mainWindowRef: BrowserWindow | null = null
  private currentAlbumId: string | null = null
  private compressedQueue: AsyncQueue<CompressedImage> | null = null

  // Track failed images for end-of-queue retry
  private failedImages: Set<number> = new Set()

  async startPipeline(albumId: string, mainWindow: BrowserWindow | null): Promise<void> {
    // Store mainWindow reference for queue processing
    if (mainWindow) {
      this.mainWindowRef = mainWindow
    }

    if (this.isRunning) {
      log.info(`[Pipeline] Pipeline already running, queuing album ${albumId}`)
      this.queuedAlbums.add(albumId)
      return
    }

    this.isRunning = true
    this.currentAlbumId = albumId
    this.failedImages.clear()
    log.info(`[Pipeline] Pipeline started for album ${albumId}`)

    try {
      // Check network before starting
      if (!networkService.isOnline()) {
        log.info('[Pipeline] Waiting for network connection...')
        await this.waitForNetwork()
      }

      // Get all pending images
      const images = getAlbumImages(albumId)
      const pendingImages = images.filter(
        (img) =>
          img.uploadStatus === 'pending' ||
          img.uploadStatus === 'failed' ||
          img.uploadStatus === 'failed_compression' ||
          img.uploadStatus === 'failed_upload'
      )

      log.info(
        `[Pipeline] Found ${images.length} total images, ${pendingImages.length} pending/failed`
      )

      if (pendingImages.length === 0) {
        log.info(`[Pipeline] No pending images for album ${albumId}, exiting`)
        this.isRunning = false
        if (mainWindow) {
          mainWindow.webContents.send('upload:complete', { albumId })
        }
        return
      }

      // Run producer-consumer pipeline
      await this.runProducerConsumer(albumId, pendingImages, mainWindow)

      // End-of-queue retry for failed items
      if (this.failedImages.size > 0) {
        log.info(`[Pipeline] Retrying ${this.failedImages.size} failed images with new URLs...`)
        await this.retryFailedWithNewUrls(albumId, mainWindow)
      }

      log.info(`[Pipeline] Pipeline completed successfully for album ${albumId}`)

      // Show notification for sync complete
      const completedAlbum = getAlbum(albumId)
      if (completedAlbum) {
        notificationService.syncComplete(completedAlbum.title)

        // Update album's lastSyncedAt in database to mark as synced
        const now = new Date().toISOString()
        updateAlbum(albumId, { lastSyncedAt: now, needsSync: 0 })

        // Update .lumosnap metadata file in source folder
        const totalImages = getAlbumImages(albumId).length
        const folderStats = getFolderStats(completedAlbum.sourceFolderPath)
        updateMetadataAfterSync(completedAlbum.sourceFolderPath, totalImages, folderStats.totalSize)
        log.info(`[Pipeline] Updated album metadata for ${albumId}`)
      }

      if (mainWindow) {
        mainWindow.webContents.send('upload:complete', { albumId })
      }
    } catch (error) {
      log.error(`[Pipeline] Pipeline failed for album ${albumId}:`, error)
      if (mainWindow) {
        mainWindow.webContents.send('upload:error', { error: (error as Error).message })
      }
      throw error
    } finally {
      this.isRunning = false
      this.currentAlbumId = null
      this.compressedQueue = null
      log.info(`[Pipeline] Pipeline isRunning flag reset`)

      // Process next queued album
      if (this.queuedAlbums.size > 0) {
        const nextAlbumId = this.queuedAlbums.values().next().value
        if (nextAlbumId) {
          this.queuedAlbums.delete(nextAlbumId)
          log.info(`[Pipeline] Processing next queued album: ${nextAlbumId}`)
          // Use setImmediate to avoid stack overflow with many queued albums
          setImmediate(() => {
            this.startPipeline(nextAlbumId, this.mainWindowRef).catch((error) => {
              log.error(`[Pipeline] Queued pipeline failed for ${nextAlbumId}:`, error)
            })
          })
        }
      }
    }
  }

  /**
   * Producer-Consumer pattern for parallel compression and upload
   */
  private async runProducerConsumer(
    albumId: string,
    pendingImages: Image[],
    mainWindow: BrowserWindow | null
  ): Promise<void> {
    this.compressedQueue = new AsyncQueue<CompressedImage>(this.maxQueueSize)

    // Start producer (compression) and consumer (upload) in parallel
    const compressionPromise = this.runCompressionProducer(albumId, pendingImages, mainWindow)
    const uploadPromise = this.runUploadConsumer(albumId, mainWindow)

    // Wait for both to complete
    await Promise.all([compressionPromise, uploadPromise])
  }

  /**
   * Compression producer - compresses images and pushes to queue
   */
  private async runCompressionProducer(
    albumId: string,
    pendingImages: Image[],
    mainWindow: BrowserWindow | null
  ): Promise<void> {
    const activeCompressions: Promise<void>[] = []

    for (const image of pendingImages) {
      // Wait if paused (network offline)
      while (this.isPaused) {
        await this.waitForResume()
      }

      // Backpressure: wait if queue is full
      if (this.compressedQueue!.isFull) {
        await this.compressedQueue!.waitForSpace()
      }

      // Limit concurrent compressions
      while (activeCompressions.length >= this.compressionConcurrency) {
        await Promise.race(activeCompressions)
      }

      const task = this.compressImageTask(image, mainWindow)
        .then((result) => {
          if (result) {
            this.compressedQueue!.push(result, String(result.id))
          }
        })
        .finally(() => {
          const idx = activeCompressions.indexOf(task)
          if (idx > -1) activeCompressions.splice(idx, 1)
        })

      activeCompressions.push(task)
    }

    // Wait for all remaining compressions
    await Promise.all(activeCompressions)

    // Signal queue completion
    this.compressedQueue!.complete()
    log.info('[Pipeline] Compression producer completed')
  }

  /**
   * Upload consumer - consumes from queue and uploads in batches
   */
  private async runUploadConsumer(
    albumId: string,
    mainWindow: BrowserWindow | null
  ): Promise<void> {
    const uploadBatch: CompressedImage[] = []

    for await (const item of this.compressedQueue!) {
      // Wait if paused (network offline)
      while (this.isPaused) {
        await this.waitForResume()
      }

      uploadBatch.push(item.data)

      // Upload in batches for presigned URL efficiency
      if (uploadBatch.length >= this.uploadBatchSize) {
        await this.uploadBatch(albumId, uploadBatch.splice(0, this.uploadBatchSize), mainWindow)
      }
    }

    // Upload remaining items
    if (uploadBatch.length > 0) {
      await this.uploadBatch(albumId, uploadBatch, mainWindow)
    }

    log.info('[Pipeline] Upload consumer completed')
  }

  /**
   * Compress a single image, with caching support
   */
  private async compressImageTask(
    image: Image,
    mainWindow: BrowserWindow | null
  ): Promise<CompressedImage | null> {
    try {
      updateImage(image.id, { uploadStatus: 'compressing' })
      if (mainWindow) {
        mainWindow.webContents.send('upload:progress', this.getProgress(image.albumId))
      }

      const album = getAlbum(image.albumId)
      if (!album) throw new Error(`Album ${image.albumId} not found`)

      const sourceFilePath = join(album.sourceFolderPath, image.originalFilename)
      const baseName = basename(image.originalFilename, extname(image.originalFilename))
      const expectedOutputPath = join(album.localFolderPath, `${baseName}.webp`)
      const expectedThumbnailPath = join(album.localFolderPath, '.thumbnail', `${baseName}.webp`)

      // Check if already compressed (resume support)
      if (existsSync(expectedOutputPath) && image.sourceFileHash) {
        try {
          const currentHash = await hashFile(sourceFilePath)
          if (currentHash === image.sourceFileHash && existsSync(expectedThumbnailPath)) {
            log.info(`[Image ${image.id}] Using cached compressed file`)

            // Get metadata from existing file
            const stats = await stat(expectedOutputPath)
            const metadata = await sharp(expectedOutputPath).metadata()

            return {
              id: image.id,
              albumId: image.albumId,
              serverId: image.serverId,
              originalFilename: image.originalFilename,
              localFilePath: expectedOutputPath,
              thumbnailPath: expectedThumbnailPath,
              fileSize: stats.size,
              width: metadata.width || 0,
              height: metadata.height || 0,
              sourceFileHash: image.sourceFileHash,
              uploadOrder: image.uploadOrder
            }
          }
        } catch (err) {
          log.warn(`[Image ${image.id}] Cache check failed, re-compressing:`, err)
        }
      }

      // Compress the image
      const result = await compressionPool.compress(sourceFilePath, {
        outputDir: album.localFolderPath
      })

      if (result.success) {
        // Update database with compression results
        updateImage(image.id, {
          fileSize: result.fileSize,
          width: result.width,
          height: result.height,
          localFilePath: result.compressedPath,
          sourceFileHash: result.hash
        })

        return {
          id: image.id,
          albumId: image.albumId,
          serverId: image.serverId,
          originalFilename: image.originalFilename,
          localFilePath: result.compressedPath,
          thumbnailPath: result.thumbnailPath,
          fileSize: result.fileSize,
          width: result.width,
          height: result.height,
          sourceFileHash: result.hash,
          uploadOrder: image.uploadOrder
        }
      } else {
        log.error(`[Image ${image.id}] Compression failed: ${result.error}`)
        updateImage(image.id, { uploadStatus: 'failed_compression' })
        this.failedImages.add(image.id)
        return null
      }
    } catch (error) {
      log.error(`[Image ${image.id}] Compression failed:`, error)
      updateImage(image.id, { uploadStatus: 'failed_compression' })
      this.failedImages.add(image.id)
      return null
    }
  }

  /**
   * Upload a batch of compressed images
   */
  private async uploadBatch(
    albumId: string,
    batch: CompressedImage[],
    mainWindow: BrowserWindow | null
  ): Promise<void> {
    log.info(`[Pipeline] Uploading batch of ${batch.length} images...`)

    try {
      // Request signed URLs for the batch
      const signedUrls = await albumsApi.getUploadUrls(
        albumId,
        batch.map((img) => ({
          filename: basename(img.localFilePath)
        }))
      )

      // Upload concurrently with limit
      const uploadedImages: UploadedImage[] = []
      const activeUploads: Promise<void>[] = []

      for (let i = 0; i < batch.length; i++) {
        const img = batch[i]
        const signedUrl = signedUrls[i]

        // Wait if paused
        while (this.isPaused) {
          await this.waitForResume()
        }

        // Limit concurrent uploads
        while (activeUploads.length >= this.uploadConcurrency) {
          await Promise.race(activeUploads)
        }

        const task = this.uploadSingleImage(img, signedUrl, uploadedImages, mainWindow).finally(
          () => {
            const idx = activeUploads.indexOf(task)
            if (idx > -1) activeUploads.splice(idx, 1)
          }
        )

        activeUploads.push(task)
      }

      // Wait for all uploads
      await Promise.all(activeUploads)

      // Confirm uploads
      if (uploadedImages.length > 0) {
        await this.confirmUploads(albumId, uploadedImages, mainWindow)
      }
    } catch (error) {
      log.error('[Pipeline] Batch upload failed:', error)
      // Mark all as failed
      for (const img of batch) {
        updateImage(img.id, { uploadStatus: 'failed_upload' })
        this.failedImages.add(img.id)
      }
    }
  }

  /**
   * Upload a single image with its thumbnail
   */
  private async uploadSingleImage(
    img: CompressedImage,
    signedUrl: { uploadUrl: string; thumbnailUploadUrl: string; key: string; thumbnailKey: string; filename: string },
    uploadedImages: UploadedImage[],
    mainWindow: BrowserWindow | null
  ): Promise<void> {
    try {
      updateImage(img.id, { uploadStatus: 'uploading' })
      if (mainWindow) {
        mainWindow.webContents.send('upload:progress', this.getProgress(img.albumId))
      }

      // Upload main image
      const result = await uploadToPresignedUrl(signedUrl.uploadUrl, img.localFilePath)

      // Upload thumbnail if available
      let thumbnailResult = { success: true }
      if (result.success && img.thumbnailPath && signedUrl.thumbnailUploadUrl) {
        thumbnailResult = await uploadToPresignedUrl(signedUrl.thumbnailUploadUrl, img.thumbnailPath)
      }

      if (result.success && thumbnailResult.success) {
        uploadedImages.push({
          localId: img.id,
          serverId: img.serverId,
          filename: signedUrl.filename,
          sourceImageHash: img.sourceFileHash,
          key: signedUrl.key,
          thumbnailKey: signedUrl.thumbnailKey || null,
          fileSize: img.fileSize,
          width: img.width,
          height: img.height,
          uploadOrder: img.uploadOrder
        })
      } else {
        const errorMsg = !result.success ? 'Upload failed' : 'Thumbnail upload failed'
        log.error(`[Image ${img.id}] ${errorMsg}`)
        updateImage(img.id, { uploadStatus: 'failed_upload' })
        this.failedImages.add(img.id)
      }
    } catch (error) {
      log.error(`[Image ${img.id}] Upload failed:`, error)
      updateImage(img.id, { uploadStatus: 'failed_upload' })
      this.failedImages.add(img.id)
    }
  }

  /**
   * Confirm uploads with the server
   */
  private async confirmUploads(
    albumId: string,
    uploadedImages: UploadedImage[],
    mainWindow: BrowserWindow | null
  ): Promise<void> {
    // Split into new images (no serverId) and modified images (has serverId)
    const newImages = uploadedImages.filter((u) => u.serverId === null)
    const modifiedImages = uploadedImages.filter((u) => u.serverId !== null)

    // Confirm new uploads
    if (newImages.length > 0) {
      log.info(`[Pipeline] Confirming ${newImages.length} new uploads...`)

      try {
        const confirmPayload = newImages.map((u) => ({
          filename: u.filename,
          sourceImageHash: u.sourceImageHash,
          key: u.key,
          thumbnailKey: u.thumbnailKey,
          fileSize: u.fileSize,
          width: u.width,
          height: u.height,
          uploadOrder: u.uploadOrder
        }))

        const confirmed = await albumsApi.confirmUpload(albumId, confirmPayload)

        // Match confirmed results back to local images
        for (const conf of confirmed) {
          const uploaded = newImages.find((u) => u.filename === conf.originalFilename)
          if (uploaded) {
            updateImage(uploaded.localId, {
              uploadStatus: 'complete',
              serverId: conf.id
            })
            this.failedImages.delete(uploaded.localId)
            if (mainWindow) {
              mainWindow.webContents.send('upload:progress', this.getProgress(albumId))
            }
          }
        }
      } catch (error) {
        log.error('[Pipeline] Confirm upload failed:', error)
        // Mark as failed for retry
        for (const img of newImages) {
          updateImage(img.localId, { uploadStatus: 'failed_upload' })
          this.failedImages.add(img.localId)
        }
      }
    }

    // Update modified images via PATCH
    if (modifiedImages.length > 0) {
      log.info(`[Pipeline] Updating ${modifiedImages.length} modified images...`)

      try {
        const updatePayload = modifiedImages.map((u) => ({
          imageId: u.serverId!,
          sourceImageHash: u.sourceImageHash,
          b2FileName: u.key,
          fileSize: u.fileSize,
          width: u.width,
          height: u.height
        }))

        await albumsApi.updateImages(albumId, updatePayload)

        for (const uploaded of modifiedImages) {
          updateImage(uploaded.localId, { uploadStatus: 'complete' })
          this.failedImages.delete(uploaded.localId)
          if (mainWindow) {
            mainWindow.webContents.send('upload:progress', this.getProgress(albumId))
          }
        }
      } catch (error) {
        log.error('[Pipeline] Update images failed:', error)
        for (const img of modifiedImages) {
          updateImage(img.localId, { uploadStatus: 'failed_upload' })
          this.failedImages.add(img.localId)
        }
      }
    }
  }

  /**
   * Retry failed images with fresh presigned URLs
   */
  private async retryFailedWithNewUrls(
    albumId: string,
    mainWindow: BrowserWindow | null
  ): Promise<void> {
    const images = getAlbumImages(albumId)
    const failedUploadImages = images.filter(
      (img) => this.failedImages.has(img.id) && img.uploadStatus === 'failed_upload'
    )

    if (failedUploadImages.length === 0) {
      log.info('[Pipeline] No upload failures to retry')
      return
    }

    log.info(`[Pipeline] Retrying ${failedUploadImages.length} failed uploads with new URLs...`)

    // Build compressed image objects from database
    const album = getAlbum(albumId)
    if (!album) return

    const compressedImages: CompressedImage[] = []

    for (const img of failedUploadImages) {
      // Check if compressed file exists
      if (existsSync(img.localFilePath) && img.sourceFileHash) {
        const baseName = basename(img.originalFilename, extname(img.originalFilename))
        const thumbnailPath = join(album.localFolderPath, '.thumbnail', `${baseName}.webp`)

        compressedImages.push({
          id: img.id,
          albumId: img.albumId,
          serverId: img.serverId,
          originalFilename: img.originalFilename,
          localFilePath: img.localFilePath,
          thumbnailPath: existsSync(thumbnailPath) ? thumbnailPath : '',
          fileSize: img.fileSize,
          width: img.width,
          height: img.height,
          sourceFileHash: img.sourceFileHash,
          uploadOrder: img.uploadOrder
        })
      }
    }

    if (compressedImages.length > 0) {
      // Clear from failed set before retry
      for (const img of compressedImages) {
        this.failedImages.delete(img.id)
      }

      await this.uploadBatch(albumId, compressedImages, mainWindow)
    }
  }

  /**
   * Wait for network to come online
   */
  private waitForNetwork(): Promise<void> {
    return new Promise((resolve) => {
      if (networkService.isOnline()) return resolve()

      const check = setInterval(() => {
        if (networkService.isOnline()) {
          clearInterval(check)
          resolve()
        }
      }, 1000)
    })
  }

  /**
   * Wait for pipeline to resume
   */
  private waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isPaused) return resolve()

      const check = setInterval(() => {
        if (!this.isPaused) {
          clearInterval(check)
          resolve()
        }
      }, 500)
    })
  }

  /**
   * Pause the pipeline (called when network goes offline)
   */
  pausePipeline(): void {
    if (this.isRunning && !this.isPaused) {
      log.info('[Pipeline] Pausing pipeline due to network offline')
      this.isPaused = true
      this.compressedQueue?.pause()

      if (this.mainWindowRef && this.currentAlbumId) {
        this.mainWindowRef.webContents.send('upload:paused', {
          albumId: this.currentAlbumId,
          reason: 'network_offline'
        })
      }
    }
  }

  /**
   * Resume the pipeline (called when network comes back online)
   */
  resumePipeline(): void {
    if (this.isRunning && this.isPaused) {
      log.info('[Pipeline] Resuming pipeline, network is back online')
      this.isPaused = false
      this.compressedQueue?.resume()

      if (this.mainWindowRef && this.currentAlbumId) {
        this.mainWindowRef.webContents.send('upload:resumed', {
          albumId: this.currentAlbumId
        })
      }
    }
  }

  /**
   * Check if pipeline is currently paused
   */
  isPipelinePaused(): boolean {
    return this.isPaused
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
      failed: 0,
      failed_compression: 0,
      failed_upload: 0
    }

    images.forEach((img) => {
      progress[img.uploadStatus]++
    })

    return progress
  }

  async retryFailed(albumId: string, mainWindow: BrowserWindow | null): Promise<void> {
    const images = getAlbumImages(albumId)
    const failedImages = images.filter(
      (img) =>
        img.uploadStatus === 'failed' ||
        img.uploadStatus === 'failed_compression' ||
        img.uploadStatus === 'failed_upload'
    )

    log.info(`Retrying ${failedImages.length} failed images`)

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
