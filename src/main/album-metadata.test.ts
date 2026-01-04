/**
 * Unit tests for album-metadata module
 *
 * Tests metadata file creation, reading, writing, and folder stats.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  getMetadataFilePath,
  hasAlbumMetadata,
  readAlbumMetadata,
  writeAlbumMetadata,
  createAlbumMetadata,
  updateMetadataAfterSync,
  getFolderStats,
  needsSync,
  getAlbumIdFromMetadata,
  isHiddenFile,
  getMetadataFilename
} from './album-metadata'

describe('Album Metadata Module', () => {
  const testPath = '/tmp/lumosnap-test-metadata'

  beforeEach(() => {
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true, force: true })
    }
    mkdirSync(testPath, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true, force: true })
    }
  })

  describe('getMetadataFilePath', () => {
    it('should return path with .lumosnap filename', () => {
      const path = getMetadataFilePath(testPath)
      expect(path).toBe(join(testPath, '.lumosnap'))
    })
  })

  describe('hasAlbumMetadata', () => {
    it('should return false for folder without metadata', () => {
      expect(hasAlbumMetadata(testPath)).toBe(false)
    })

    it('should return true for folder with metadata', () => {
      writeFileSync(join(testPath, '.lumosnap'), '{}')
      expect(hasAlbumMetadata(testPath)).toBe(true)
    })
  })

  describe('createAlbumMetadata', () => {
    it('should create metadata with correct structure', () => {
      const metadata = createAlbumMetadata('album-123', 100, 5000000)

      expect(metadata.version).toBe(1)
      expect(metadata.albumId).toBe('album-123')
      expect(metadata.createdAt).toBeDefined()
      expect(metadata.lastSyncedAt).toBeNull()
      expect(metadata.stats.totalImages).toBe(100)
      expect(metadata.stats.lastFileCount).toBe(100)
      expect(metadata.stats.lastTotalSize).toBe(5000000)
    })

    it('should use defaults for optional parameters', () => {
      const metadata = createAlbumMetadata('album-456')

      expect(metadata.stats.totalImages).toBe(0)
      expect(metadata.stats.lastFileCount).toBe(0)
      expect(metadata.stats.lastTotalSize).toBe(0)
    })
  })

  describe('writeAlbumMetadata / readAlbumMetadata', () => {
    it('should write and read metadata correctly', () => {
      const original = createAlbumMetadata('test-album', 50, 1000000)

      const writeResult = writeAlbumMetadata(testPath, original)
      expect(writeResult).toBe(true)

      const read = readAlbumMetadata(testPath)
      expect(read).not.toBeNull()
      expect(read?.albumId).toBe('test-album')
      expect(read?.stats.totalImages).toBe(50)
    })

    it('should return null for non-existent metadata', () => {
      const metadata = readAlbumMetadata(testPath)
      expect(metadata).toBeNull()
    })

    it('should return null for invalid JSON', () => {
      writeFileSync(join(testPath, '.lumosnap'), 'not valid json')
      const metadata = readAlbumMetadata(testPath)
      expect(metadata).toBeNull()
    })

    it('should return null for metadata missing required fields', () => {
      writeFileSync(join(testPath, '.lumosnap'), JSON.stringify({ albumId: 'test' }))
      const metadata = readAlbumMetadata(testPath)
      expect(metadata).toBeNull()
    })
  })

  describe('updateMetadataAfterSync', () => {
    it('should update existing metadata', () => {
      // Create initial metadata
      const initial = createAlbumMetadata('sync-album', 10, 100000)
      writeAlbumMetadata(testPath, initial)

      // Update after sync
      const result = updateMetadataAfterSync(testPath, 20, 200000)
      expect(result).toBe(true)

      // Read updated
      const updated = readAlbumMetadata(testPath)
      expect(updated?.lastSyncedAt).not.toBeNull()
      expect(updated?.stats.totalImages).toBe(20)
      expect(updated?.stats.lastTotalSize).toBe(200000)
    })

    it('should return false if no existing metadata', () => {
      const result = updateMetadataAfterSync(testPath, 10, 100000)
      expect(result).toBe(false)
    })
  })

  describe('getFolderStats', () => {
    it('should return zero for empty folder', () => {
      const stats = getFolderStats(testPath)
      expect(stats.fileCount).toBe(0)
      expect(stats.totalSize).toBe(0)
    })

    it('should count only image files', () => {
      writeFileSync(join(testPath, 'photo1.jpg'), 'fake image 1')
      writeFileSync(join(testPath, 'photo2.png'), 'fake image 2')
      writeFileSync(join(testPath, 'document.pdf'), 'not an image')
      writeFileSync(join(testPath, 'script.js'), 'not an image')

      const stats = getFolderStats(testPath)
      expect(stats.fileCount).toBe(2)
    })

    it('should exclude hidden files', () => {
      writeFileSync(join(testPath, 'photo.jpg'), 'visible image')
      writeFileSync(join(testPath, '.hidden.jpg'), 'hidden image')
      writeFileSync(join(testPath, '.lumosnap'), '{}')

      const stats = getFolderStats(testPath)
      expect(stats.fileCount).toBe(1)
    })

    it('should calculate total size correctly', () => {
      const content1 = 'a'.repeat(1000)
      const content2 = 'b'.repeat(2000)

      writeFileSync(join(testPath, 'photo1.jpg'), content1)
      writeFileSync(join(testPath, 'photo2.jpg'), content2)

      const stats = getFolderStats(testPath)
      expect(stats.fileCount).toBe(2)
      expect(stats.totalSize).toBe(3000)
    })

    it('should return zero for non-existent folder', () => {
      const stats = getFolderStats('/non/existent/path')
      expect(stats.fileCount).toBe(0)
      expect(stats.totalSize).toBe(0)
    })
  })

  describe('needsSync', () => {
    it('should return true if no metadata exists', () => {
      expect(needsSync(testPath)).toBe(true)
    })

    it('should return true if never synced', () => {
      const metadata = createAlbumMetadata('never-synced', 0, 0)
      writeAlbumMetadata(testPath, metadata)

      expect(needsSync(testPath)).toBe(true)
    })

    it('should return false if stats match', () => {
      writeFileSync(join(testPath, 'photo.jpg'), 'image data')

      // Create metadata with matching stats
      const stats = getFolderStats(testPath)
      const metadata = createAlbumMetadata('synced', stats.fileCount, stats.totalSize)
      metadata.lastSyncedAt = new Date().toISOString()
      writeAlbumMetadata(testPath, metadata)

      expect(needsSync(testPath)).toBe(false)
    })

    it('should return true if file count changed', () => {
      writeFileSync(join(testPath, 'photo.jpg'), 'image data')

      // Create metadata with different file count
      const metadata = createAlbumMetadata('synced', 5, 100)
      metadata.lastSyncedAt = new Date().toISOString()
      writeAlbumMetadata(testPath, metadata)

      expect(needsSync(testPath)).toBe(true)
    })

    it('should return true if total size changed', () => {
      writeFileSync(join(testPath, 'photo.jpg'), 'small')

      const metadata = createAlbumMetadata('synced', 1, 1000000) // Different size
      metadata.lastSyncedAt = new Date().toISOString()
      writeAlbumMetadata(testPath, metadata)

      expect(needsSync(testPath)).toBe(true)
    })
  })

  describe('getAlbumIdFromMetadata', () => {
    it('should return album ID if metadata exists', () => {
      const metadata = createAlbumMetadata('my-album-id', 0, 0)
      writeAlbumMetadata(testPath, metadata)

      expect(getAlbumIdFromMetadata(testPath)).toBe('my-album-id')
    })

    it('should return null if no metadata', () => {
      expect(getAlbumIdFromMetadata(testPath)).toBeNull()
    })
  })

  describe('isHiddenFile', () => {
    it('should return true for files starting with dot', () => {
      expect(isHiddenFile('.lumosnap')).toBe(true)
      expect(isHiddenFile('.hidden')).toBe(true)
      expect(isHiddenFile('.DS_Store')).toBe(true)
    })

    it('should return false for regular files', () => {
      expect(isHiddenFile('photo.jpg')).toBe(false)
      expect(isHiddenFile('document.pdf')).toBe(false)
    })
  })

  describe('getMetadataFilename', () => {
    it('should return .lumosnap', () => {
      expect(getMetadataFilename()).toBe('.lumosnap')
    })
  })
})
