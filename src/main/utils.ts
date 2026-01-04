/**
 * Utility functions for debouncing and throttling
 */

/**
 * Debounce function - delays execution until after wait milliseconds
 * have elapsed since the last time this function was invoked.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return function (this: unknown, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      fn.apply(this, args)
      timeoutId = null
    }, waitMs)
  }
}

/**
 * Debounce with grouping by key - useful for batching updates by id
 */
export function debounceByKey<K, T extends (key: K, ...args: unknown[]) => void>(
  fn: T,
  waitMs: number
): (key: K, ...args: Parameters<T> extends [K, ...infer R] ? R : never) => void {
  const timeouts = new Map<K, ReturnType<typeof setTimeout>>()

  return function (
    this: unknown,
    key: K,
    ...args: Parameters<T> extends [K, ...infer R] ? R : never
  ) {
    const existingTimeout = timeouts.get(key)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const timeoutId = setTimeout(() => {
      fn.call(this, key, ...args)
      timeouts.delete(key)
    }, waitMs)

    timeouts.set(key, timeoutId)
  }
}

/**
 * Throttle function - ensures function is called at most once per wait period
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now()
    const remaining = waitMs - (now - lastCall)

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      lastCall = now
      fn.apply(this, args)
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now()
        timeoutId = null
        fn.apply(this, args)
      }, remaining)
    }
  }
}
