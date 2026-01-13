/**
 * Network IPC handlers
 *
 * Handles network connectivity status requests from the renderer
 */

import { ipcMain } from 'electron'
import { networkService } from '../network'
import { createLogger } from '../logger'

const logger = createLogger('IPC:Network')

/**
 * Register network-related IPC handlers
 */
export function registerNetworkHandlers(): void {
  logger.debug('Registering network handlers...')

  ipcMain.handle('network:getStatus', () => {
    return { online: networkService.isOnline() }
  })

  ipcMain.handle('network:checkConnectivity', async () => {
    const online = await networkService.checkConnectivity()
    return { online }
  })

  logger.debug('✓ Network handlers registered')
}
