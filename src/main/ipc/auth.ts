/**
 * Authentication IPC handlers
 */

import { ipcMain } from 'electron'
import { startAuth } from '../oauth-handler'
import { getAuth, clearAuth } from '../auth-storage'
import { createLogger } from '../logger'

const logger = createLogger('IPC:Auth')

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:getStoredAuth', () => {
    logger.info('Getting stored auth')
    const auth = getAuth()
    if (auth) {
      return { success: true, token: auth.token, user: auth.user }
    }
    return { success: false, token: null, user: null }
  })

  ipcMain.handle('auth:startAuth', async () => {
    logger.info('Starting auth flow')
    const result = await startAuth()
    return result
  })

  ipcMain.handle('auth:logout', () => {
    logger.info('Logging out')
    clearAuth()
    return { success: true }
  })
}
