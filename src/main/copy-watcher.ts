/**
 * Copy Watcher
 *
 * Temporary watcher for detecting files during copy operations.
 * Auto-disposes after timeout or when copy is detected as complete.
 *
 * Features:
 * - 2-minute max lifetime (configurable)
 * - 5-second silence detection (no new files = copy complete)
 * - File stability check (ensures files are fully copied)
 * - Registry to prevent memory leaks
 */

import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { stat } from 'fs/promises'
import { basename, extname } from 'path'
import { createLogger } from './logger'

const logger = createLogger('CopyWatcher')

// Supported image extensions
const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.tif',
  '.heic',
  '.heif',
  '.avif',
  '.raw',
  '.cr2',
  '.nef',
  '.arw',
  '.dng'
])

export interface CopyWatcherOptions {
  albumId: string
  folderPath: string
  timeoutMs?: number // Max lifetime (default: 120000ms = 2 minutes)
  debounceMs?: number // Silence threshold (default: 5000ms = 5 seconds)
  stabilityCheckMs?: number // Time to wait for file stability (default: 1000ms)
  onNewFiles: (files: string[]) => void
  onComplete: () => void
}

interface FileState {
  path: string
  size: number
  mtime: number
  stable: boolean
}

class CopyWatcher {
  private watcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private timeoutTimer: NodeJS.Timeout | null = null
  private stabilityChecks: Map<string, NodeJS.Timeout> = new Map()
  private detectedFiles: Map<string, FileState> = new Map()
  private pendingStableFiles: Set<string> = new Set()
  private isDisposed = false
  private options: CopyWatcherOptions | null = null

  private readonly defaultTimeoutMs = 120000 // 2 minutes
  private readonly defaultDebounceMs = 5000 // 5 seconds
  private readonly defaultStabilityCheckMs = 1000 // 1 second

  /**
   * Start watching a folder for copy operations
   */
  start(options: CopyWatcherOptions): void {
    if (this.isDisposed) {
      logger.warn('CopyWatcher already disposed, cannot start')
      return
    }

    this.options = options
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const debounceMs = options.debounceMs ?? this.defaultDebounceMs

    logger.info(
      `Starting copy watcher for album ${options.albumId} at ${options.folderPath} ` +
        `(timeout: ${timeoutMs}ms, debounce: ${debounceMs}ms)`
    )

    // Create watcher
    this.watcher = chokidar.watch(options.folderPath, {
      ignored: [/(^|[/\\])\../, /\.lumosnap$/], // Ignore dotfiles and metadata
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      // Use polling for better copy detection on some systems
      usePolling: false,
      awaitWriteFinish: false // We handle stability ourselves
    })

    this.watcher
      .on('add', (filePath) => this.handleFileAdd(filePath))
      .on('change', (filePath) => this.handleFileChange(filePath))
      .on('error', (error) => {
        logger.error(`CopyWatcher error for album ${options.albumId}:`, error)
      })

    // Set max timeout
    this.timeoutTimer = setTimeout(() => {
      logger.info(`CopyWatcher timeout reached for album ${options.albumId}`)
      this.complete()
    }, timeoutMs)

    // Start initial debounce timer
    this.resetDebounce()
  }

  /**
   * Handle new file detected
   */
  private handleFileAdd(filePath: string): void {
    if (this.isDisposed) return

    // Check if it's an image file
    const ext = extname(filePath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return
    }

    logger.debug(`CopyWatcher detected new file: ${basename(filePath)}`)

    // Reset debounce timer (copy is still in progress)
    this.resetDebounce()

    // Start stability check for this file
    this.startStabilityCheck(filePath)
  }

  /**
   * Handle file change (size may have changed during copy)
   */
  private handleFileChange(filePath: string): void {
    if (this.isDisposed) return

    const ext = extname(filePath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return
    }

    // Reset debounce and restart stability check
    this.resetDebounce()
    this.startStabilityCheck(filePath)
  }

  /**
   * Start stability check for a file
   * Waits for file size to stabilize before marking as ready
   */
  private startStabilityCheck(filePath: string): void {
    // Cancel any existing check for this file
    const existingCheck = this.stabilityChecks.get(filePath)
    if (existingCheck) {
      clearTimeout(existingCheck)
    }

    const stabilityMs = this.options?.stabilityCheckMs ?? this.defaultStabilityCheckMs

    const checkStability = async (): Promise<void> => {
      try {
        const stats = await stat(filePath)
        const existingState = this.detectedFiles.get(filePath)

        if (existingState) {
          // Compare with previous state
          if (stats.size === existingState.size && stats.mtimeMs === existingState.mtime) {
            // File is stable
            existingState.stable = true
            this.pendingStableFiles.add(filePath)
            this.stabilityChecks.delete(filePath)
            logger.debug(`File stable: ${basename(filePath)} (${stats.size} bytes)`)
            return
          }
        }

        // Update state and schedule another check
        this.detectedFiles.set(filePath, {
          path: filePath,
          size: stats.size,
          mtime: stats.mtimeMs,
          stable: false
        })

        // Schedule another check
        const timer = setTimeout(() => checkStability(), stabilityMs)
        this.stabilityChecks.set(filePath, timer)
      } catch {
        // File might have been deleted, remove from tracking
        this.detectedFiles.delete(filePath)
        this.pendingStableFiles.delete(filePath)
        this.stabilityChecks.delete(filePath)
      }
    }

    // Start first check after stabilityMs
    const timer = setTimeout(() => checkStability(), stabilityMs)
    this.stabilityChecks.set(filePath, timer)

    // Initialize state
    stat(filePath)
      .then((stats) => {
        if (!this.detectedFiles.has(filePath)) {
          this.detectedFiles.set(filePath, {
            path: filePath,
            size: stats.size,
            mtime: stats.mtimeMs,
            stable: false
          })
        }
      })
      .catch(() => {
        // Ignore - file might not exist yet
      })
  }

  /**
   * Reset the debounce timer
   */
  private resetDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    const debounceMs = this.options?.debounceMs ?? this.defaultDebounceMs

    this.debounceTimer = setTimeout(() => {
      logger.info(
        `CopyWatcher silence detected for album ${this.options?.albumId} - copy likely complete`
      )
      this.complete()
    }, debounceMs)
  }

  /**
   * Complete the copy detection - notify and dispose
   */
  private complete(): void {
    if (this.isDisposed) return

    // Wait a bit for any final stability checks
    setTimeout(() => {
      // Collect all stable files
      const stableFiles = Array.from(this.pendingStableFiles)

      if (stableFiles.length > 0) {
        logger.info(
          `CopyWatcher completed for album ${this.options?.albumId}: ${stableFiles.length} new files`
        )
        this.options?.onNewFiles(stableFiles)
      } else {
        logger.debug(`CopyWatcher completed for album ${this.options?.albumId}: no new files`)
      }

      this.options?.onComplete()
      this.dispose()
    }, 500)
  }

  /**
   * Force cleanup
   */
  dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true

    logger.debug(`Disposing CopyWatcher for album ${this.options?.albumId}`)

    // Clear timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }

    // Clear stability check timers
    for (const timer of this.stabilityChecks.values()) {
      clearTimeout(timer)
    }
    this.stabilityChecks.clear()

    // Close watcher
    if (this.watcher) {
      this.watcher.close().catch(() => {})
      this.watcher = null
    }

    // Clear state
    this.detectedFiles.clear()
    this.pendingStableFiles.clear()
    this.options = null
  }

  /**
   * Check if disposed
   */
  isActive(): boolean {
    return !this.isDisposed
  }
}

/**
 * Registry to track active copy watchers
 * Prevents duplicates and memory leaks
 */
class CopyWatcherRegistry {
  private watchers: Map<string, CopyWatcher> = new Map()

  /**
   * Create a new copy watcher for an album
   * Disposes any existing watcher for the same album
   */
  create(options: CopyWatcherOptions): CopyWatcher {
    // Dispose existing watcher if any
    this.dispose(options.albumId)

    const watcher = new CopyWatcher()
    this.watchers.set(options.albumId, watcher)

    // Auto-remove from registry when complete
    const originalOnComplete = options.onComplete
    options.onComplete = () => {
      this.watchers.delete(options.albumId)
      originalOnComplete()
    }

    watcher.start(options)
    return watcher
  }

  /**
   * Get an active watcher by album ID
   */
  get(albumId: string): CopyWatcher | undefined {
    const watcher = this.watchers.get(albumId)
    if (watcher && watcher.isActive()) {
      return watcher
    }
    return undefined
  }

  /**
   * Dispose a watcher by album ID
   */
  dispose(albumId: string): void {
    const watcher = this.watchers.get(albumId)
    if (watcher) {
      watcher.dispose()
      this.watchers.delete(albumId)
    }
  }

  /**
   * Dispose all watchers
   */
  disposeAll(): void {
    logger.info(`Disposing all copy watchers (${this.watchers.size} active)`)
    for (const watcher of this.watchers.values()) {
      watcher.dispose()
    }
    this.watchers.clear()
  }

  /**
   * Get count of active watchers
   */
  getActiveCount(): number {
    return this.watchers.size
  }
}

// Singleton registry
export const copyWatcherRegistry = new CopyWatcherRegistry()
