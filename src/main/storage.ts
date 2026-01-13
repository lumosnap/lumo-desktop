import { statfs } from 'fs'
import { promisify } from 'util'
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const imageSize = require('image-size')

const statfsAsync = promisify(statfs)

export interface FileStats {
  path: string
  filename: string
  size: number
  mtime: string
  width?: number
  height?: number
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp']

export async function getFreeSpace(path: string): Promise<number> {
  try {
    const stats = await statfsAsync(path)
    // bavail = available blocks for unprivileged users
    // bsize = block size
    return stats.bavail * stats.bsize
  } catch (error) {
    console.error('Failed to get free space:', error)
    throw error
  }
}

export function createAlbumFolder(storageLocation: string, albumId: string): string {
  const albumPath = join(storageLocation, 'Lumosnap', 'albums', albumId)

  if (!existsSync(albumPath)) {
    mkdirSync(albumPath, { recursive: true })
  }

  return albumPath
}

export function ensureBaseDirectory(storageLocation: string): void {
  const basePath = join(storageLocation, 'Lumosnap', 'albums')

  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true })
  }
}

// Cache for scan results to avoid redundant folder scans
interface ScanCache {
  result: FileStats[]
  timestamp: number
}
const scanCache = new Map<string, ScanCache>()
const CACHE_TTL_MS = 5000 // 5 seconds

export function clearScanCache(folderPath?: string): void {
  if (folderPath) {
    scanCache.delete(folderPath)
  } else {
    scanCache.clear()
  }
}

// Update function signature to support options
interface ScanOptions {
  useCache?: boolean
  skipDimensions?: boolean
}

export function scanImagesInFolder(
  folderPath: string,
  options: ScanOptions | boolean = true
): FileStats[] {
  // Handle legacy boolean argument
  const useCache = typeof options === 'boolean' ? options : options.useCache !== false
  const skipDimensions = typeof options === 'object' ? options.skipDimensions : false

  // Check cache first
  if (useCache) {
    const cached = scanCache.get(folderPath)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(
        `[Storage] Using cached scan result for: ${folderPath} (${cached.result.length} images)`
      )
      return cached.result
    }
  }

  console.log(`[Storage] scanImagesInFolder started for: ${folderPath}`)

  if (!existsSync(folderPath)) {
    console.warn(`[Storage] Folder does not exist: ${folderPath}`)
    return []
  }

  const images: FileStats[] = []

  try {
    const files = readdirSync(folderPath)
    console.log(`[Storage] Found ${files.length} total files in folder`)

    for (const filename of files) {
      // Skip hidden files (including .lumosnap metadata)
      if (filename.startsWith('.')) {
        continue
      }

      const filePath = join(folderPath, filename)
      const ext = extname(filename).toLowerCase()

      // Check if it's an image file
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        continue
      }

      // Verbose logging only if not skipping dimensions (implying full import)
      if (!skipDimensions) {
        console.log(`[Storage] Processing image file: ${filename}`)
      }

      try {
        const stats = statSync(filePath)

        // Skip directories
        if (stats.isDirectory()) {
          continue
        }

        // Get image dimensions (optional - use defaults if can't read)
        let width: number | undefined = 1920
        let height: number | undefined = 1080

        // Only read dimensions if not skipped
        if (!skipDimensions) {
          try {
            if (typeof imageSize === 'function') {
              const dimensions = imageSize(filePath)
              width = dimensions?.width || 1920
              height = dimensions?.height || 1080
              console.log(`[Storage] Image dimensions for ${filename}: ${width}x${height}`)
            }
          } catch {
            console.warn(`[Storage] Could not read dimensions for ${filename}, using defaults`)
            // Silently use defaults - dimensions are not critical
          }
        }

        const fileStats: FileStats = {
          path: filePath,
          filename,
          size: stats.size,
          mtime: stats.mtime.toISOString(),
          width,
          height
        }

        images.push(fileStats)
        if (!skipDimensions) {
          console.log(`[Storage] Added image: ${filename} (${formatBytes(stats.size)})`)
        }
      } catch {
        console.warn(`[Storage] Failed to read file ${filename}`)
        continue
      }
    }

    console.log(`[Storage] scanImagesInFolder completed: ${images.length} images found`)
  } catch (error) {
    console.error('[Storage] Failed to scan folder:', error)
    throw error
  }

  // Store in cache
  scanCache.set(folderPath, { result: images, timestamp: Date.now() })

  return images
}

export function getImageStats(filePath: string): FileStats | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const stats = statSync(filePath)
    const filename = filePath.split('/').pop() || filePath.split('\\').pop() || ''

    // Get image dimensions (optional - use defaults if can't read)
    let width: number | undefined = 1920
    let height: number | undefined = 1080

    try {
      if (typeof imageSize === 'function') {
        const dimensions = imageSize(filePath)
        width = dimensions?.width || 1920
        height = dimensions?.height || 1080
      }
    } catch (error) {
      // Silently use defaults - dimensions are not critical
    }

    return {
      path: filePath,
      filename,
      size: stats.size,
      mtime: stats.mtime.toISOString(),
      width,
      height
    }
  } catch (error) {
    console.error('Failed to get file stats:', error)
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
