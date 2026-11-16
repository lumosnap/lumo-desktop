import { statfs } from 'fs'
import { promisify } from 'util'
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const statfsAsync = promisify(statfs)

export interface FileStats {
  path: string
  filename: string
  size: number
  mtime: string
}

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp']

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

interface ScanOptions {
  useCache?: boolean
}

export function scanImagesInFolder(
  folderPath: string,
  options: ScanOptions | boolean = true
): FileStats[] {
  // Handle legacy boolean argument
  const useCache = typeof options === 'boolean' ? options : options.useCache !== false

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

      // Dimensions come from compression (sharp), which reads every photo anyway
      try {
        const stats = statSync(filePath)
        if (stats.isDirectory()) continue
        images.push({
          path: filePath,
          filename,
          size: stats.size,
          mtime: stats.mtime.toISOString()
        })
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

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
