/**
 * Utility functions for debouncing
 */

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
