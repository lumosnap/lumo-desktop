/**
 * Authentication IPC handlers
 */

import { ipcMain } from 'electron'
import { startAuth, requestDeviceCode, pollDeviceToken } from '../oauth-handler'
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

  ipcMain.handle('auth:requestDeviceCode', async () => {
    logger.info('Requesting device authorization code')
    const result = await requestDeviceCode()
    if (!result.success) logger.warn(`Device code request failed: ${result.error}`)
    return result
  })

  ipcMain.handle('auth:pollDeviceToken', async (_event, deviceCode: string) => {
    const result = await pollDeviceToken(deviceCode)
    if (!result.success && !result.pending) logger.warn(`Device token poll failed: ${result.error}`)
    return result
  })

  ipcMain.handle('auth:logout', () => {
    logger.info('Logging out')
    clearAuth()
    return { success: true }
  })
}
