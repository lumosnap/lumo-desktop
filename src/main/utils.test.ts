/**
 * Unit tests for utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce, debounceByKey, throttle } from './utils'

describe('Utility Functions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('debounce', () => {
    it('should delay execution until after wait period', () => {
      const fn = vi.fn()
      const debouncedFn = debounce(fn, 100)

      debouncedFn()
      expect(fn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(50)
      expect(fn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(50)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should reset timer on subsequent calls', () => {
      const fn = vi.fn()
      const debouncedFn = debounce(fn, 100)

      debouncedFn()
      vi.advanceTimersByTime(50)

      debouncedFn() // Reset the timer
      vi.advanceTimersByTime(50)
      expect(fn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(50)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should pass arguments to the debounced function', () => {
      const fn = vi.fn()
      const debouncedFn = debounce(fn, 100)

      debouncedFn('arg1', 'arg2')
      vi.advanceTimersByTime(100)

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
    })
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

  describe('throttle', () => {
    it('should execute immediately on first call', () => {
      const fn = vi.fn()
      const throttledFn = throttle(fn, 100)

      throttledFn()
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should not execute during throttle period', () => {
      const fn = vi.fn()
      const throttledFn = throttle(fn, 100)

      throttledFn() // First call - executes immediately
      throttledFn() // Second call - should be throttled

      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should execute after throttle period', () => {
      const fn = vi.fn()
      const throttledFn = throttle(fn, 100)

      throttledFn()
      vi.advanceTimersByTime(100)
      throttledFn()

      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should queue trailing call during throttle', () => {
      const fn = vi.fn()
      const throttledFn = throttle(fn, 100)

      throttledFn() // Executes immediately
      throttledFn() // Queued

      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })
})
