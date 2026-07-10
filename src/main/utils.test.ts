/**
 * Unit tests for utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounceByKey } from './utils'

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
