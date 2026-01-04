/**
 * Album Metadata Module
 *
 * Manages hidden .lumosnap metadata files in album source folders.
 * Used for:
 * - Quick sync detection (folder-level stats)
 * - Duplicate album detection (albumId matching)
 * - Resume interrupted syncs
 * - Orphan detection
 */

import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'fs'
import { join, extname } from 'path'

const METADATA_FILENAME = '.lumosnap'
const METADATA_VERSION = 1

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp']

export interface AlbumMetadata {
  version: number // Schema version for future migrations
  albumId: string // Server album ID for linking
  createdAt: string // When album was first synced (ISO 8601)
  lastSyncedAt: string | null // Last successful sync timestamp
  stats: {
    totalImages: number // Total images at last sync
    lastFileCount: number // For quick dirty-check
    lastTotalSize: number // Total size in bytes for change detection
  }
}

/**
 * Get the path to the .lumosnap metadata file in a folder
 */
export function getMetadataFilePath(folderPath: string): string {
  return join(folderPath, METADATA_FILENAME)
}

/**
 * Check if a folder has an existing .lumosnap metadata file
 */
export function hasAlbumMetadata(folderPath: string): boolean {
  return existsSync(getMetadataFilePath(folderPath))
}

/**
 * Read and parse album metadata from a folder
 * Returns null if file doesn't exist or is invalid
 */
export function readAlbumMetadata(folderPath: string): AlbumMetadata | null {
  const metadataPath = getMetadataFilePath(folderPath)

  if (!existsSync(metadataPath)) {
    return null
  }

  try {
    const content = readFileSync(metadataPath, 'utf-8')
    const metadata = JSON.parse(content) as AlbumMetadata

    // Validate required fields
    if (!metadata.version || !metadata.albumId || !metadata.createdAt) {
      console.warn(`[AlbumMetadata] Invalid metadata file in ${folderPath}`)
      return null
    }

    return metadata
  } catch (error) {
    console.error(`[AlbumMetadata] Failed to read metadata from ${folderPath}:`, error)
    return null
  }
}

/**
 * Write album metadata to a folder
 */
export function writeAlbumMetadata(folderPath: string, metadata: AlbumMetadata): boolean {
  const metadataPath = getMetadataFilePath(folderPath)

  try {
    const content = JSON.stringify(metadata, null, 2)
    writeFileSync(metadataPath, content, 'utf-8')
    console.log(`[AlbumMetadata] Wrote metadata for album ${metadata.albumId} to ${folderPath}`)
    return true
  } catch (error) {
    console.error(`[AlbumMetadata] Failed to write metadata to ${folderPath}:`, error)
    return false
  }
}

/**
 * Create initial metadata for a new album
 */
export function createAlbumMetadata(
  albumId: string,
  totalImages: number = 0,
  totalSize: number = 0
): AlbumMetadata {
  return {
    version: METADATA_VERSION,
    albumId,
    createdAt: new Date().toISOString(),
    lastSyncedAt: null,
    stats: {
      totalImages,
      lastFileCount: totalImages,
      lastTotalSize: totalSize
    }
  }
}

/**
 * Update metadata after a successful sync
 */
export function updateMetadataAfterSync(
  folderPath: string,
  totalImages: number,
  totalSize: number
): boolean {
  const existing = readAlbumMetadata(folderPath)

  if (!existing) {
    console.warn(`[AlbumMetadata] No existing metadata to update in ${folderPath}`)
    return false
  }

  const updated: AlbumMetadata = {
    ...existing,
    lastSyncedAt: new Date().toISOString(),
    stats: {
      totalImages,
      lastFileCount: totalImages,
      lastTotalSize: totalSize
    }
  }

  return writeAlbumMetadata(folderPath, updated)
}

/**
 * Get current folder stats (file count and total size) for comparison
 * This is a quick operation that only reads filesystem metadata
 */
export function getFolderStats(folderPath: string): { fileCount: number; totalSize: number } {
  if (!existsSync(folderPath)) {
    return { fileCount: 0, totalSize: 0 }
  }

  let fileCount = 0
  let totalSize = 0

  try {
    const files = readdirSync(folderPath)

    for (const filename of files) {
      // Skip hidden files (including .lumosnap)
      if (filename.startsWith('.')) {
        continue
      }

      const ext = extname(filename).toLowerCase()
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        continue
      }

      const filePath = join(folderPath, filename)
      try {
        const stats = statSync(filePath)
        if (stats.isFile()) {
          fileCount++
          totalSize += stats.size
        }
      } catch {
        // Skip files we can't stat
        continue
      }
    }
  } catch (error) {
    console.error(`[AlbumMetadata] Failed to get folder stats for ${folderPath}:`, error)
  }

  return { fileCount, totalSize }
}

/**
 * Quick check if folder needs sync based on cached stats
 * Returns true if folder content appears to have changed
 */
export function needsSync(folderPath: string): boolean {
  const metadata = readAlbumMetadata(folderPath)

  if (!metadata) {
    // No metadata means we need a full sync
    return true
  }

  // Never synced before
  if (!metadata.lastSyncedAt) {
    return true
  }

  // Compare current folder stats with cached stats
  const currentStats = getFolderStats(folderPath)

  // If file count or total size changed, we need to sync
  if (
    currentStats.fileCount !== metadata.stats.lastFileCount ||
    currentStats.totalSize !== metadata.stats.lastTotalSize
  ) {
    console.log(
      `[AlbumMetadata] Folder ${folderPath} needs sync: ` +
        `files ${metadata.stats.lastFileCount} -> ${currentStats.fileCount}, ` +
        `size ${metadata.stats.lastTotalSize} -> ${currentStats.totalSize}`
    )
    return true
  }

  return false
}

/**
 * Get album ID from metadata file if it exists
 * Useful for detecting duplicate/moved folders
 */
export function getAlbumIdFromMetadata(folderPath: string): string | null {
  const metadata = readAlbumMetadata(folderPath)
  return metadata?.albumId ?? null
}

/**
 * Check if a file is a hidden/metadata file that should be excluded from scans
 */
export function isHiddenFile(filename: string): boolean {
  return filename.startsWith('.')
}

/**
 * Get the metadata filename constant (for external use)
 */
export function getMetadataFilename(): string {
  return METADATA_FILENAME
}
