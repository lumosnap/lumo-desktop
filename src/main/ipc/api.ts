/**
 * API IPC handlers
 *
 * Handles external API operations like share links and favorites
 */

import { ipcMain } from 'electron'
import { albumsApi } from '../api-client'
import { createLogger, getErrorMessage } from '../logger'

const logger = createLogger('IPC:API')

export function registerApiHandlers(): void {
  ipcMain.handle('api:generateShareLink', async (_event, albumId: string) => {
    try {
      logger.info(`Generating share link for album ${albumId}`)
      const result = await albumsApi.createShareLink(albumId)
      return {
        success: true,
        shareLink: {
          shareLinkToken: result.shareLinkToken,
          shareUrl: result.shareLink,
          expiresAt: null
        }
      }
    } catch (error: unknown) {
      logger.error('Failed to generate share link:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('api:getFavorites', async (_event, albumId: string, clientName?: string) => {
    try {
      const result = await albumsApi.getFavorites(albumId, clientName)
      return { success: true, favorites: result.data, clientNames: result.clientNames }
    } catch (error: unknown) {
      logger.error('Failed to get favorites:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error), favorites: [], clientNames: [] }
    }
  })
}
