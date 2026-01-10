/**
 * Settings IPC Handlers
 *
 * Handles app settings like auto-start at login and minimize-to-tray preferences.
 */

import { ipcMain, app } from 'electron'
import { getConfig, setConfig } from '../config'
import { createLogger } from '../logger'

const logger = createLogger('IPC:Settings')

export function registerSettingsHandlers(): void {
  /**
   * Get auto-start at login setting
   */
  ipcMain.handle('settings:getAutoStart', () => {
    try {
      const settings = app.getLoginItemSettings()
      return {
        success: true,
        enabled: settings.openAtLogin,
        openAsHidden: settings.openAsHidden || false
      }
    } catch (error) {
      logger.error('Failed to get auto-start settings:', error)
      return {
        success: false,
        enabled: false,
        openAsHidden: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  /**
   * Set auto-start at login
   */
  ipcMain.handle('settings:setAutoStart', (_, enabled: boolean) => {
    try {
      if (enabled) {
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: true, // Start hidden (tray mode) - works on macOS/Windows
          // For Linux, we pass --hidden flag which we check on startup
          args: ['--hidden']
        })
      } else {
        app.setLoginItemSettings({
          openAtLogin: false
        })
      }

      logger.info(`Auto-start at login ${enabled ? 'enabled' : 'disabled'}`)

      return { success: true, enabled }
    } catch (error) {
      logger.error('Failed to set auto-start settings:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  /**
   * Get minimize-to-tray setting
   */
  ipcMain.handle('settings:getMinimizeToTray', () => {
    try {
      const config = getConfig()
      // Default to true if not set
      const enabled = config.minimizeToTray !== false
      return { success: true, enabled }
    } catch (error) {
      logger.error('Failed to get minimize-to-tray setting:', error)
      return {
        success: false,
        enabled: true, // Default
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  /**
   * Set minimize-to-tray setting
   */
  ipcMain.handle('settings:setMinimizeToTray', (_, enabled: boolean) => {
    try {
      setConfig('minimizeToTray', enabled)
      logger.info(`Minimize to tray ${enabled ? 'enabled' : 'disabled'}`)
      return { success: true, enabled }
    } catch (error) {
      logger.error('Failed to set minimize-to-tray setting:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  /**
   * Get all app settings
   */
  ipcMain.handle('settings:getAll', () => {
    try {
      const loginSettings = app.getLoginItemSettings()
      const config = getConfig()

      return {
        success: true,
        settings: {
          autoStart: loginSettings.openAtLogin,
          autoStartHidden: loginSettings.openAsHidden || false,
          minimizeToTray: config.minimizeToTray !== false
        }
      }
    } catch (error) {
      logger.error('Failed to get all settings:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  logger.info('Settings handlers registered')
}
