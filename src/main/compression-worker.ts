/**
 * Compression Worker
 *
 * Worker thread script for Sharp image compression.
 * Runs in a separate thread to avoid blocking the main process.
 */

import { parentPort } from 'worker_threads'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { hashBuffer } from './hash'

interface CompressionTask {
  taskId: string
  inputPath: string
  outputDir: string
  precomputedHash?: string // If provided, skip hashing
  sourceBuffer?: Buffer // If provided, skip file read
  options: {
    maxBytes?: number
    tolerance?: number
    maxEdge?: number
    qualityStart?: number
    qualityMin?: number
    effort?: number
    sharpConcurrency?: number
    smartSubsample?: boolean
    preset?: 'photo' | 'picture' | 'drawing' | 'icon' | 'text'
  }
}

interface CompressionResult {
  taskId: string
  success: boolean
  compressedPath: string
  thumbnailPath: string
  width: number
  height: number
  fileSize: number
  hash: string
  error?: string
}

const DEFAULT_OPTIONS = {
  maxBytes: 800 * 1024, // 800KB
  tolerance: 50 * 1024, // 50KB tolerance
  maxEdge: 2048,
  qualityStart: 86,
  qualityMin: 80,
  effort: 4,
  sharpConcurrency: 1,
  smartSubsample: true,
  preset: 'photo' as const
}

async function compressImage(task: CompressionTask): Promise<CompressionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...task.options }

  try {
    // Validate input file exists
    const inputStat = await fs.stat(task.inputPath)
    if (!inputStat.isFile()) {
      throw new Error('Input path is not a file')
    }

    // Use provided buffer or read file
    let sourceBuffer: Buffer
    if (task.sourceBuffer) {
      sourceBuffer = task.sourceBuffer
    } else {
      sourceBuffer = await fs.readFile(task.inputPath)
    }

    // Use provided hash or compute it
    const hash = task.precomputedHash || (await hashBuffer(sourceBuffer))

    // Set Sharp concurrency
    sharp.concurrency(opts.sharpConcurrency)

    // Parse input path
    const parsedPath = path.parse(task.inputPath)
    const outputFileName = `${parsedPath.name}.webp`
    const outputPath = path.join(task.outputDir, outputFileName)

    // Ensure output directory exists
    await fs.mkdir(task.outputDir, { recursive: true })

    // Load image from buffer (we already have it in memory)
    const image = sharp(sourceBuffer, { failOnError: false })
    const metadata = await image.metadata()

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read image dimensions')
    }

    const longEdge = Math.max(metadata.width, metadata.height)

    // Setup resize options (only if image exceeds max edge)
    const resizeOpts =
      longEdge > opts.maxEdge
        ? {
            width: metadata.width >= metadata.height ? opts.maxEdge : undefined,
            height: metadata.height > metadata.width ? opts.maxEdge : undefined,
            fit: 'inside' as const,
            withoutEnlargement: true
          }
        : undefined

    // Create processing pipeline
    let pipeline = image.clone().rotate()
    if (resizeOpts) {
      pipeline = pipeline.resize(resizeOpts)
    }

    // WebP encoding options
    const webpBaseOpts = {
      effort: opts.effort,
      smartSubsample: opts.smartSubsample,
      progressive: false,
      ...(opts.preset && { preset: opts.preset })
    }

    // Adaptive quality compression
    let finalBuffer: Buffer | null = null

    for (let q = opts.qualityStart; q >= opts.qualityMin; q -= 2) {
      const buffer = await pipeline
        .clone()
        .webp({ ...webpBaseOpts, quality: q })
        .toBuffer()

      if (buffer.length <= opts.maxBytes + opts.tolerance) {
        finalBuffer = buffer
        break
      }
    }

    // If no suitable quality found, use minimum quality
    if (!finalBuffer) {
      finalBuffer = await pipeline.webp({ ...webpBaseOpts, quality: opts.qualityMin }).toBuffer()
    }

    // Write output file
    await fs.writeFile(outputPath, finalBuffer)

    // Get final dimensions
    const outputMetadata = await sharp(finalBuffer).metadata()

    // Generate thumbnail
    const thumbnailDir = path.join(task.outputDir, '.thumbnail')
    await fs.mkdir(thumbnailDir, { recursive: true })
    
    const thumbnailPath = path.join(thumbnailDir, outputFileName)
    
    // Create 400px thumbnail
    await image
      .clone()
      .rotate() // Auto-rotate based on EXIF
      .resize({
        width: 400,
        height: 400, // max dimensions
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 80, effort: 0 }) // fast compression for thumbnails
      .toFile(thumbnailPath)

    return {
      taskId: task.taskId,
      success: true,
      compressedPath: outputPath,
      thumbnailPath: thumbnailPath,
      width: outputMetadata.width || 0,
      height: outputMetadata.height || 0,
      fileSize: finalBuffer.length,
      hash
    }
  } catch (error) {
    return {
      taskId: task.taskId,
      success: false,
      compressedPath: '',
      thumbnailPath: '',
      width: 0,
      height: 0,
      fileSize: 0,
      hash: '',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

// Listen for messages from main thread
parentPort?.on('message', async (task: CompressionTask) => {
  const result = await compressImage(task)
  parentPort?.postMessage(result)
})

// Signal ready
parentPort?.postMessage({ type: 'ready' })
