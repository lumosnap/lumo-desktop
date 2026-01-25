/**
 * Network Service for LumoSnap Desktop
 *
 * Monitors network connectivity and provides status to the renderer process.
 * Uses Electron's net.isOnline() API for reliable connectivity detection.
 */

import { BrowserWindow, net } from 'electron'
import { createLogger } from './logger'

const logger = createLogger('Network')

// Check interval in milliseconds (5 seconds)
const CHECK_INTERVAL_MS = 5000

type StatusChangeCallback = (online: boolean) => void

class NetworkService {
  private online: boolean = true
  private mainWindow: BrowserWindow | null = null
  private checkInterval: NodeJS.Timeout | null = null
  private statusCallbacks: StatusChangeCallback[] = []

  /**
   * Subscribe to network status changes
   * Returns unsubscribe function
   */
  onStatusChange(callback: StatusChangeCallback): () => void {
    this.statusCallbacks.push(callback)
    return () => {
      const idx = this.statusCallbacks.indexOf(callback)
      if (idx > -1) this.statusCallbacks.splice(idx, 1)
    }
  }

  /**
   * Initialize the network service with a reference to the main window
   */
  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.online = net.isOnline()
    logger.info(
      `Network service initialized. Initial status: ${this.online ? 'online' : 'offline'}`
    )

    // Start monitoring
    this.startMonitoring()
  }

  /**
   * Get current online status
   */
  isOnline(): boolean {
    return this.online
  }

  /**
   * Check connectivity using Electron's net.isOnline()
   */
  async checkConnectivity(): Promise<boolean> {
    const isOnline = net.isOnline()
    this.setOnlineStatus(isOnline)
    return isOnline
  }

  /**
   * Start periodic connectivity monitoring
   */
  startMonitoring(): void {
    if (this.checkInterval) {
      return // Already monitoring
    }

    logger.debug('Starting network monitoring')

    this.checkInterval = setInterval(() => {
      const wasOnline = this.online
      const isNowOnline = net.isOnline()

      if (wasOnline !== isNowOnline) {
        this.setOnlineStatus(isNowOnline)
      }
    }, CHECK_INTERVAL_MS)
  }

  /**
   * Stop connectivity monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
      logger.debug('Network monitoring stopped')
    }
  }

  /**
   * Update online status and notify renderer if changed
   */
  private setOnlineStatus(status: boolean): void {
    if (this.online !== status) {
      this.online = status
      logger.info(`Network status changed: ${status ? 'online' : 'offline'}`)
      this.notifyRenderer()
      this.notifyCallbacks()
    }
  }

  /**
   * Notify all registered callbacks
   */
  private notifyCallbacks(): void {
    for (const callback of this.statusCallbacks) {
      try {
        callback(this.online)
      } catch (err) {
        logger.error('Status callback error:', err)
      }
    }
  }

  /**
   * Send current network status to renderer
   */
  private notifyRenderer(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('network:status-changed', {
        online: this.online
      })
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopMonitoring()
    this.mainWindow = null
    logger.debug('Network service destroyed')
  }
}

// Export singleton instance
export const networkService = new NetworkService()
