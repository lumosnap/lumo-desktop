/**
 * Unit tests for storage module
 * 
 * Tests file scanning, folder operations, and utilities.
 * These don't require Electron mocking.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// Import directly since storage.ts doesn't use electron
import {
  scanImagesInFolder,
  createAlbumFolder,
  ensureBaseDirectory,
  formatBytes,
  clearScanCache,
  getImageStats
} from './storage'

describe('Storage Module', () => {
  const testPath = '/tmp/lumosnap-test-storage'

  beforeEach(() => {
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true, force: true })
    }
    mkdirSync(testPath, { recursive: true })
    clearScanCache()
  })

  afterEach(() => {
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true, force: true })
    }
  })

  describe('scanImagesInFolder', () => {
    it('should return empty array for empty folder', () => {
      const images = scanImagesInFolder(testPath)
      expect(images).toHaveLength(0)
    })

    it('should find image files', () => {
      // Create test image files (just files with image extensions)
      writeFileSync(join(testPath, 'photo1.jpg'), 'fake image data')
      writeFileSync(join(testPath, 'photo2.png'), 'fake image data')
      writeFileSync(join(testPath, 'photo3.webp'), 'fake image data')

      const images = scanImagesInFolder(testPath, false) // Disable cache for test
      expect(images).toHaveLength(3)
      expect(images.map((i) => i.filename)).toContain('photo1.jpg')
    })

    it('should ignore non-image files', () => {
      writeFileSync(join(testPath, 'document.pdf'), 'fake pdf')
      writeFileSync(join(testPath, 'script.js'), 'fake js')
      writeFileSync(join(testPath, 'image.jpg'), 'fake image')

      const images = scanImagesInFolder(testPath, false)
      expect(images).toHaveLength(1)
      expect(images[0].filename).toBe('image.jpg')
    })

    it('should return empty for non-existent folder', () => {
      const images = scanImagesInFolder('/non/existent/path')
      expect(images).toHaveLength(0)
    })

    it('should use cache on second call', () => {
      writeFileSync(join(testPath, 'cached.jpg'), 'fake image')

      const first = scanImagesInFolder(testPath, true)
      expect(first).toHaveLength(1)

      // Add another file
      writeFileSync(join(testPath, 'new.jpg'), 'fake image')

      // Should still return 1 from cache
      const cached = scanImagesInFolder(testPath, true)
      expect(cached).toHaveLength(1)

      // Clear cache and rescan
      clearScanCache(testPath)
      const fresh = scanImagesInFolder(testPath, true)
      expect(fresh).toHaveLength(2)
    })
  })

  describe('createAlbumFolder', () => {
    it('should create album folder structure', () => {
      const albumPath = createAlbumFolder(testPath, 'test-album-id')
      expect(existsSync(albumPath)).toBe(true)
      expect(albumPath).toContain('test-album-id')
    })

    it('should not throw if folder exists', () => {
      createAlbumFolder(testPath, 'existing')
      expect(() => createAlbumFolder(testPath, 'existing')).not.toThrow()
    })
  })

  describe('ensureBaseDirectory', () => {
    it('should create base directory structure', () => {
      ensureBaseDirectory(testPath)
      expect(existsSync(join(testPath, 'Lumosnap', 'albums'))).toBe(true)
    })
  })

  describe('formatBytes', () => {
    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 Bytes')
    })

    it('should format KB', () => {
      expect(formatBytes(1024)).toBe('1 KB')
    })

    it('should format MB', () => {
      expect(formatBytes(1024 * 1024)).toBe('1 MB')
    })

    it('should format GB', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
    })

    it('should handle decimals', () => {
      expect(formatBytes(1536)).toBe('1.5 KB')
    })
  })

  describe('getImageStats', () => {
    it('should return null for non-existent file', () => {
      const stats = getImageStats('/non/existent/file.jpg')
      expect(stats).toBeNull()
    })

    it('should return stats for existing file', () => {
      const filePath = join(testPath, 'stats-test.jpg')
      writeFileSync(filePath, 'test image data')

      const stats = getImageStats(filePath)
      expect(stats).toBeDefined()
      expect(stats?.filename).toBe('stats-test.jpg')
      expect(stats?.size).toBeGreaterThan(0)
    })
  })
})
