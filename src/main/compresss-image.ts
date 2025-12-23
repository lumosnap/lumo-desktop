import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

export interface CompressionResult {
  success: boolean
  compressedPath: string
  width: number
  height: number
  fileSize: number
  error?: string
}

export interface CompressionOptions {
  outputDir?: string
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

const DEFAULT_OPTIONS: Required<Omit<CompressionOptions, 'outputDir' | 'preset'>> &
  Pick<CompressionOptions, 'preset'> = {
  maxBytes: 800 * 1024, // 800KB
  tolerance: 50 * 1024, // 50KB tolerance
  maxEdge: 2048,
  qualityStart: 86,
  qualityMin: 80,
  effort: 3,
  sharpConcurrency: 1, // Based on benchmark findings
  smartSubsample: true,
  preset: 'photo'
}

/**
 * Compresses an image to WebP format with adaptive quality
 * Based on benchmark results: Sharp concurrency=1 with Smart Subsampling + Photo preset
 */
export async function compressImage(
  inputPath: string,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  console.log(`[Compress] Starting compression for: ${inputPath}`)
  const opts = { ...DEFAULT_OPTIONS, ...options }
  console.log(`[Compress] Options:`, opts)

  try {
    // Validate input file exists
    console.log(`[Compress] Validating input file...`)
    const inputStat = await fs.stat(inputPath)
    if (!inputStat.isFile()) {
      console.error(`[Compress] Input is not a file: ${inputPath}`)
      return {
        success: false,
        compressedPath: '',
        width: 0,
        height: 0,
        fileSize: 0,
        error: 'Input path is not a file'
      }
    }
    console.log(`[Compress] Input file validated, size: ${inputStat.size} bytes`)

    // Set Sharp concurrency (optimal: 1 based on benchmarks)
    sharp.concurrency(opts.sharpConcurrency)
    console.log(`[Compress] Sharp concurrency set to: ${opts.sharpConcurrency}`)

    // Parse input path
    const parsedPath = path.parse(inputPath)
    const outputDir = options.outputDir || parsedPath.dir
    const outputFileName = `${parsedPath.name}.webp`
    const outputPath = path.join(outputDir, outputFileName)
    console.log(`[Compress] Output path: ${outputPath}`)

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true })
    console.log(`[Compress] Output directory ensured: ${outputDir}`)

    // Load image and get metadata
    console.log(`[Compress] Loading image with Sharp...`)
    const image = sharp(inputPath, { failOnError: false })
    const metadata = await image.metadata()
    console.log(`[Compress] Image metadata loaded:`, { width: metadata.width, height: metadata.height, format: metadata.format })

    if (!metadata.width || !metadata.height) {
      console.error(`[Compress] Could not read image dimensions`)
      return {
        success: false,
        compressedPath: '',
        width: 0,
        height: 0,
        fileSize: 0,
        error: 'Could not read image dimensions'
      }
    }

    const longEdge = Math.max(metadata.width, metadata.height)
    console.log(`[Compress] Longest edge: ${longEdge}px (max allowed: ${opts.maxEdge}px)`)

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

    if (resizeOpts) {
      console.log(`[Compress] Image will be resized to fit within ${opts.maxEdge}px`)
    } else {
      console.log(`[Compress] No resize needed`)
    }

    // Create processing pipeline
    let pipeline = image.clone()
    if (resizeOpts) {
      pipeline = pipeline.resize(resizeOpts)
    }

    // WebP encoding options (optimized based on benchmark)
    const webpBaseOpts = {
      effort: opts.effort,
      smartSubsample: opts.smartSubsample,
      ...(opts.preset && { preset: opts.preset })
    }

    // Adaptive quality compression
    console.log(`[Compress] Starting adaptive quality compression (${opts.qualityStart} -> ${opts.qualityMin})...`)
    let finalBuffer: Buffer | null = null
    let finalQuality = opts.qualityStart

    for (let q = opts.qualityStart; q >= opts.qualityMin; q -= 2) {
      const buffer = await pipeline
        .clone()
        .webp({ ...webpBaseOpts, quality: q })
        .toBuffer()

      console.log(`[Compress] Quality ${q}: ${buffer.length} bytes (target: ${opts.maxBytes} + ${opts.tolerance})`)

      if (buffer.length <= opts.maxBytes + opts.tolerance) {
        finalBuffer = buffer
        finalQuality = q
        console.log(`[Compress] Target size achieved at quality ${q}`)
        break
      }
    }

    // If no suitable quality found, use minimum quality
    if (!finalBuffer) {
      console.log(`[Compress] Target size not achieved, using minimum quality ${opts.qualityMin}`)
      finalBuffer = await pipeline.webp({ ...webpBaseOpts, quality: opts.qualityMin }).toBuffer()
      finalQuality = opts.qualityMin
      console.log(`[Compress] Final size at quality ${opts.qualityMin}: ${finalBuffer.length} bytes`)
    }

    // Write output file
    console.log(`[Compress] Writing compressed file to: ${outputPath}`)
    await fs.writeFile(outputPath, finalBuffer)

    // Get final dimensions
    const outputMetadata = await sharp(finalBuffer).metadata()
    console.log(`[Compress] Compression complete!`)
    console.log(`[Compress] Final dimensions: ${outputMetadata.width}x${outputMetadata.height}`)
    console.log(`[Compress] Final size: ${finalBuffer.length} bytes (quality: ${finalQuality})`)
    console.log(`[Compress] Saved to: ${outputPath}`)

    return {
      success: true,
      compressedPath: outputPath,
      width: outputMetadata.width || 0,
      height: outputMetadata.height || 0,
      fileSize: finalBuffer.length
    }
  } catch (error) {
    console.error(`[Compress] Compression failed:`, error)
    return {
      success: false,
      compressedPath: '',
      width: 0,
      height: 0,
      fileSize: 0,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

/**
 * Batch compress multiple images with concurrency control
 */
export async function compressImages(
  inputPaths: string[],
  options: CompressionOptions = {},
  concurrency: number = 4
): Promise<CompressionResult[]> {
  const results: CompressionResult[] = []

  // Process in batches
  for (let i = 0; i < inputPaths.length; i += concurrency) {
    const batch = inputPaths.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((filePath) => compressImage(filePath, options))
    )
    results.push(...batchResults)
  }

  return results
}
