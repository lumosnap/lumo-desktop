/**
 * IPC Handlers Entry Point
 *
 * Re-exports all IPC handler registration functions from domain modules.
 * This provides a clean API while keeping handlers organized by domain.
 */

import { BrowserWindow } from 'electron'
import { registerAuthHandlers } from './auth'
import { registerConfigHandlers } from './config'
import { registerProfileHandlers } from './profile'
import { registerAlbumHandlers } from './albums'
import { registerSyncHandlers } from './sync'
import { registerApiHandlers } from './api'
import { registerSettingsHandlers } from './settings'
import { registerPlansHandlers } from './plans'
import { registerNetworkHandlers } from './network'
import { createLogger } from '../logger'

const logger = createLogger('IPC')

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  logger.info('Registering IPC handlers...')

  // Auth handlers (no mainWindow needed)
  registerAuthHandlers()

  // Config handlers (no mainWindow needed)
  registerConfigHandlers()

  // Profile handlers (no mainWindow needed)
  registerProfileHandlers()

  // Album handlers (need mainWindow for pipeline progress)
  registerAlbumHandlers(mainWindow)

  // Sync handlers (need mainWindow for pipeline)
  registerSyncHandlers(mainWindow)

  // API handlers (no mainWindow needed)
  registerApiHandlers()

  // Settings handlers (auto-start, minimize-to-tray)
  registerSettingsHandlers()

  // Plans handlers (subscription plans)
  registerPlansHandlers()

  // Network handlers (connectivity status)
  registerNetworkHandlers()

  logger.info('✓ All IPC handlers registered')
}

// Re-export types
export type { IpcResult } from './types'
