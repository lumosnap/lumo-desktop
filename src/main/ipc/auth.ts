/**
 * Authentication IPC handlers
 */

import { ipcMain } from 'electron'
import { startAuth, requestDeviceCode, pollDeviceToken } from '../oauth-handler'
import { getAuth, clearAuth } from '../auth-storage'
import { createLogger } from '../logger'
import { uploadPipeline, resumeUploads } from '../pipeline'
import { BrowserWindow } from 'electron'

const logger = createLogger('IPC:Auth')

// A paused run continues; albums that waited while signed out (e.g. since launch) are queued
function signedIn(): void {
  uploadPipeline.resumePipeline()
  resumeUploads(BrowserWindow.getAllWindows()[0] ?? null)
}

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
    if (result.success) signedIn()
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
    if (result.success) signedIn()
    if (!result.success && !result.pending) logger.warn(`Device token poll failed: ${result.error}`)
    return result
  })

  ipcMain.handle('auth:logout', () => {
    logger.info('Logging out')
    clearAuth()
    uploadPipeline.pausePipeline() // unsigned uploads would only fail; sign-in resumes
    return { success: true }
  })
}
