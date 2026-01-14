/**
 * System Tray Manager
 *
 * Handles system tray icon, context menu, and minimize-to-tray behavior.
 * Supports Windows, macOS, and Linux with platform-specific handling.
 */

import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { createLogger } from './logger'

const logger = createLogger('Tray')

export type TrayStatus = 'idle' | 'syncing' | 'paused' | 'error'

interface TrayManagerOptions {
  onShowWindow: () => void
  onQuit: () => void
  onPauseResume: (isPaused: boolean) => void
}

export class TrayManager {
  private tray: Tray | null = null
  private status: TrayStatus = 'idle'
  private isPaused = false
  private options: TrayManagerOptions | null = null
  private syncingAlbumCount = 0

  /**
   * Create the system tray icon
   */
  create(options: TrayManagerOptions): void {
    if (this.tray) {
      logger.warn('Tray already exists, skipping creation')
      return
    }

    this.options = options

    try {
      // Get icon path based on platform
      const iconPath = this.getIconPath()
      const icon = nativeImage.createFromPath(iconPath)

      // Resize for different platforms
      // Windows: 16x16, macOS: 22x22 (template), Linux: 24x24
      let resizedIcon: Electron.NativeImage
      if (process.platform === 'darwin') {
        resizedIcon = icon.resize({ width: 22, height: 22 })
        resizedIcon.setTemplateImage(true) // Makes it work with dark/light mode
      } else if (process.platform === 'win32') {
        resizedIcon = icon.resize({ width: 16, height: 16 })
      } else {
        resizedIcon = icon.resize({ width: 24, height: 24 })
      }

      this.tray = new Tray(resizedIcon)
      this.tray.setToolTip('LumoSnap')

      // Update context menu
      this.updateContextMenu()

      // Click behavior
      this.tray.on('click', () => {
        this.options?.onShowWindow()
      })

      // Double-click on Windows
      this.tray.on('double-click', () => {
        this.options?.onShowWindow()
      })

      logger.info('System tray created successfully')
    } catch (error) {
      logger.error('Failed to create system tray:', error)
    }
  }

  /**
   * Get the appropriate icon path
   * Windows: Use .ico for best tray icon visibility
   * macOS/Linux: Use .png
   */
  private getIconPath(): string {
    const isDev = !app.isPackaged

    if (isDev) {
      // Development: Use build folder icons (same icons used by electron-builder)
      if (process.platform === 'win32') {
        return join(__dirname, '../../build/icon.ico')
      }
      return join(__dirname, '../../resources/icon.png')
    }

    // Production: Icons are bundled in the resources folder
    const resourcesPath = process.resourcesPath
    if (process.platform === 'win32') {
      // Windows: Use .ico for proper tray visibility
      return join(resourcesPath, 'icon.ico')
    }
    return join(resourcesPath, 'icon.png')
  }

  /**
   * Update the context menu based on current state
   */
  private updateContextMenu(): void {
    if (!this.tray) return

    const statusText = this.getStatusText()

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'LumoSnap',
        enabled: false,
        icon: this.getSmallIcon()
      },
      { type: 'separator' },
      {
        label: statusText,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Show Window',
        click: () => this.options?.onShowWindow()
      },
      {
        label: this.isPaused ? 'Resume Sync' : 'Pause Sync',
        click: () => {
          this.isPaused = !this.isPaused
          this.options?.onPauseResume(this.isPaused)
          this.updateContextMenu()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit LumoSnap',
        click: () => this.options?.onQuit()
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  /**
   * Get a small icon for the menu header
   */
  private getSmallIcon(): Electron.NativeImage | undefined {
    try {
      const iconPath = this.getIconPath()
      const icon = nativeImage.createFromPath(iconPath)
      return icon.resize({ width: 16, height: 16 })
    } catch {
      return undefined
    }
  }

  /**
   * Get human-readable status text
   */
  private getStatusText(): string {
    if (this.isPaused) {
      return '⏸ Sync Paused'
    }

    switch (this.status) {
      case 'idle':
        return '✓ Ready'
      case 'syncing':
        return this.syncingAlbumCount > 0
          ? `⟳ Syncing ${this.syncingAlbumCount} album${this.syncingAlbumCount > 1 ? 's' : ''}...`
          : '⟳ Syncing...'
      case 'error':
        return '⚠ Error occurred'
      default:
        return '✓ Ready'
    }
  }

  /**
   * Update the sync status
   */
  updateStatus(status: TrayStatus, albumCount?: number): void {
    this.status = status
    if (albumCount !== undefined) {
      this.syncingAlbumCount = albumCount
    }

    // Update tooltip
    if (this.tray) {
      this.tray.setToolTip(`LumoSnap - ${this.getStatusText()}`)
    }

    // Rebuild context menu with new status
    this.updateContextMenu()
  }

  /**
   * Check if sync is paused
   */
  getIsPaused(): boolean {
    return this.isPaused
  }

  /**
   * Set pause state externally
   */
  setPaused(paused: boolean): void {
    this.isPaused = paused
    this.updateContextMenu()
  }

  /**
   * Destroy the tray
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
      logger.info('System tray destroyed')
    }
  }

  /**
   * Check if tray exists
   */
  isCreated(): boolean {
    return this.tray !== null
  }
}

// Singleton instance
export const trayManager = new TrayManager()
