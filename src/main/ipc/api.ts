/**
 * API IPC handlers
 *
 * Handles external API operations like share links and favorites
 */

import { ipcMain } from 'electron'
import { albumsApi } from '../api-client'
import { isServerMissing } from '../database'
import { createLogger, getErrorMessage } from '../logger'
import { handleIpc } from './types'

const logger = createLogger('IPC:API')

export function registerApiHandlers(): void {
  handleIpc('api:generateShareLink', logger, async (_event, albumId: string) => {
    if (isServerMissing(albumId)) throw new Error('Upload this album again to share it')
    logger.info(`Generating share link for album ${albumId}`)
    const result = await albumsApi.createShareLink(albumId)
    return {
      shareLink: {
        shareLinkToken: result.shareLinkToken,
        shareUrl: result.shareLink,
        expiresAt: null
      }
    }
  })

  ipcMain.handle('api:getFavorites', async (_event, albumId: string, clientName?: string) => {
    try {
      // No server album, no picks: answer empty instead of asking again on every open
      if (isServerMissing(albumId)) return { success: true, favorites: [], clientNames: [] }
      const result = await albumsApi.getFavorites(albumId, clientName)
      return { success: true, favorites: result.data, clientNames: result.clientNames }
    } catch (error: unknown) {
      logger.error('Failed to get favorites:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error), favorites: [], clientNames: [] }
    }
  })
}
