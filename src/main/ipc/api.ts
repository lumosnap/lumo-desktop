/**
 * API IPC handlers
 *
 * Handles external API operations like share links and favorites
 */

import { ipcMain } from 'electron'
import { albumsApi } from '../api-client'
import { createLogger, getErrorMessage } from '../logger'
import { handleIpc } from './types'
import { networkService } from '../network'
import { getAlbumImages } from '../database'
import { cleanLists, toLocalLists, type LocalList } from '../lists'

const logger = createLogger('IPC:API')

export function registerApiHandlers(): void {
  handleIpc('api:generateShareLink', logger, async (_event, albumId: string) => {
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
      const result = await albumsApi.getFavorites(albumId, clientName)
      return { success: true, favorites: result.data, clientNames: result.clientNames }
    } catch (error: unknown) {
      logger.error('Failed to get favorites:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error), favorites: [], clientNames: [] }
    }
  })

  // Client selection lists live on the server: offline there is nothing to show or save
  const online = (): void => {
    if (!networkService.isOnline())
      throw new Error("You're offline. Client selections load when you're back online.")
  }
  const fetchLists = async (albumId: string): Promise<{ lists: LocalList[] }> => ({
    lists: toLocalLists(await albumsApi.getLists(albumId), getAlbumImages(albumId))
  })
  handleIpc('lists:get', logger, async (_event, albumId: string) => {
    online()
    return fetchLists(albumId)
  })
  handleIpc('lists:save', logger, async (_event, albumId: string, lists: unknown) => {
    online()
    await albumsApi.putLists(albumId, cleanLists(lists))
    return fetchLists(albumId)
  })
  handleIpc(
    'lists:reopen',
    logger,
    async (_event, albumId: string, listId: string, clientName: string) => {
      online()
      await albumsApi.reopenSubmission(albumId, String(listId), String(clientName))
      return fetchLists(albumId)
    }
  )
}
