import { basename, relative } from 'path'
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

/**
 * Dotfiles in the album folder: .lumosnap, .DS_Store, and AppleDouble ._IMG_1.jpg files that
 * macOS writes on exFAT (each would fire a change). Only the name is checked, never the
 * folder's own path, which may itself sit under a dot-folder.
 */
export function isIgnoredPath(root: string, path: string): boolean {
  // relative(): chokidar hands paths over with / even on Windows, and with no trailing slash
  return relative(root, path) !== '' && basename(path).startsWith('.')
}
