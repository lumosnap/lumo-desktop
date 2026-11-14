/**
 * Unit tests for utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounceByKey, isIgnoredPath } from './utils'

describe('Utility Functions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('debounceByKey', () => {
    it('should debounce separately by key', () => {
      const fn = vi.fn()
      const debouncedFn = debounceByKey(fn, 100)

      debouncedFn('key1')
      debouncedFn('key2')

      vi.advanceTimersByTime(100)

      expect(fn).toHaveBeenCalledTimes(2)
      expect(fn).toHaveBeenCalledWith('key1')
      expect(fn).toHaveBeenCalledWith('key2')
    })

    it('should only call once per key when rapidly invoked', () => {
      const fn = vi.fn()
      const debouncedFn = debounceByKey(fn, 100)

      debouncedFn('key1')
      debouncedFn('key1')
      debouncedFn('key1')

      vi.advanceTimersByTime(100)

      expect(fn).toHaveBeenCalledTimes(1)
    })
  })
})

describe('isIgnoredPath (watcher)', () => {
  const root = '/Users/me/.hidden/Wedding'
  it('ignores dotfiles, AppleDouble files and .lumosnap, not photos or the folder itself', () => {
    expect(isIgnoredPath(root, `${root}/._IMG_1.jpg`)).toBe(true)
    expect(isIgnoredPath(root, `${root}/.lumosnap`)).toBe(true)
    expect(isIgnoredPath(root, `${root}/.DS_Store`)).toBe(true)
    expect(isIgnoredPath(root, `${root}/IMG_1.jpg`)).toBe(false)
    expect(isIgnoredPath(root, root)).toBe(false)
    expect(isIgnoredPath(root, `${root}/`)).toBe(false)
  })
})
