/**
 * Configuration and Storage IPC handlers
 */

import { ipcMain, shell, app } from 'electron'
import { existsSync, readdirSync, rmSync, unlinkSync } from 'fs'
import { join } from 'path'
import {
  isConfigured,
  getStorageLocation,
  setStorageLocation,
  getConfig,
  getMasterFolder,
  setMasterFolder,
  getConfigPath,
  resetConfig
} from '../config'
import { deleteDatabase, getAllAlbums } from '../database'
import { clearAuth } from '../auth-storage'
import { getFreeSpace, ensureBaseDirectory, scanImagesInFolder, formatBytes } from '../storage'
import { watcherService } from '../watcher'
import { albumsApi } from '../api-client'
import { createLogger, getErrorMessage } from '../logger'

const logger = createLogger('IPC:Config')

// 10GB threshold for low storage warning
const LOW_STORAGE_THRESHOLD = 10 * 1024 * 1024 * 1024

export function registerConfigHandlers(): void {
  ipcMain.handle('config:isConfigured', () => {
    return isConfigured()
  })

  ipcMain.handle('config:getStorageLocation', () => {
    return getStorageLocation()
  })

  ipcMain.handle('config:setStorageLocation', async (_event, path: string) => {
    try {
      if (!existsSync(path)) {
        throw new Error('Selected path does not exist')
      }
      setStorageLocation(path)
      ensureBaseDirectory(path)
      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to set storage location:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('config:getFreeSpace', async (_event, path: string) => {
    try {
      const bytes = await getFreeSpace(path)
      return { bytes, formatted: formatBytes(bytes) }
    } catch (error: unknown) {
      logger.error('Failed to get free space:', getErrorMessage(error))
      return { bytes: 0, formatted: '0 Bytes', error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('config:getConfig', () => {
    return getConfig()
  })

  ipcMain.handle('config:getAppVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('config:getCurrentStorageInfo', async () => {
    try {
      const storageLocation = getStorageLocation()
      if (!storageLocation) {
        return {
          success: false,
          error: 'Storage location not configured',
          path: null,
          freeSpace: 0,
          freeSpaceFormatted: '0 Bytes',
          isLowStorage: false
        }
      }

      const freeSpace = await getFreeSpace(storageLocation)
      const isLowStorage = freeSpace < LOW_STORAGE_THRESHOLD

      return {
        success: true,
        path: storageLocation,
        freeSpace,
        freeSpaceFormatted: formatBytes(freeSpace),
        isLowStorage
      }
    } catch (error: unknown) {
      logger.error('Failed to get storage info:', getErrorMessage(error))
      return {
        success: false,
        error: getErrorMessage(error),
        path: null,
        freeSpace: 0,
        freeSpaceFormatted: '0 Bytes',
        isLowStorage: false
      }
    }
  })

  // Master folder handlers
  ipcMain.handle('config:getMasterFolder', () => {
    return getMasterFolder()
  })

  ipcMain.handle('config:setMasterFolder', async (_event, path: string) => {
    try {
      if (!existsSync(path)) {
        throw new Error('Selected path does not exist')
      }
      setMasterFolder(path)
      watcherService.watchMasterFolder(path)
      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to set master folder:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('config:scanMasterFolder', () => {
    try {
      const masterFolder = getMasterFolder()
      if (!masterFolder || !existsSync(masterFolder)) {
        return { success: false, error: 'Master folder not configured', folders: [] }
      }

      const entries = readdirSync(masterFolder, { withFileTypes: true })
      const folders = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => {
          const folderPath = join(masterFolder, entry.name)
          const images = scanImagesInFolder(folderPath)
          return {
            name: entry.name,
            path: folderPath,
            imageCount: images.length
          }
        })

      return { success: true, folders }
    } catch (error: unknown) {
      logger.error('Failed to scan master folder:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error), folders: [] }
    }
  })

  // Shell handlers
  ipcMain.handle('shell:openFolder', async (_event, folderPath: string) => {
    try {
      if (!existsSync(folderPath)) {
        return { success: false, error: 'Folder does not exist' }
      }
      await shell.openPath(folderPath)
      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to open folder:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Reset all data handler
  ipcMain.handle('config:resetAllData', async () => {
    try {
      logger.info('Starting reset all data...')

      // 1. Stop the watcher service
      watcherService.closeAll()
      logger.info('Watchers closed')

      // 2. Get all albums and delete from cloud first
      const albums = getAllAlbums()
      logger.info(`Found ${albums.length} albums to delete from cloud`)

      const failedCloudDeletes: string[] = []
      for (const album of albums) {
        try {
          logger.info(`Deleting album ${album.id} (${album.title}) from cloud...`)
          await albumsApi.delete(album.id)
          logger.info(`Album ${album.id} deleted from cloud successfully`)
        } catch (e) {
          const errorMsg = getErrorMessage(e)
          logger.error(`Failed to delete album ${album.id} from cloud:`, errorMsg)
          failedCloudDeletes.push(`${album.title}: ${errorMsg}`)
        }
      }

      // If any cloud deletion failed, abort to prevent inconsistency
      if (failedCloudDeletes.length > 0) {
        const errorMessage = `Failed to delete ${failedCloudDeletes.length} album(s) from cloud. Local data was preserved to prevent inconsistency.`
        logger.error(errorMessage)
        return {
          success: false,
          error: errorMessage,
          details: failedCloudDeletes
        }
      }

      logger.info('All albums deleted from cloud')

      // 3. Clear authentication data
      clearAuth()
      logger.info('Auth cleared')

      // 4. Delete the database
      deleteDatabase()
      logger.info('Database deleted')

      // 5. Delete compressed images in storage location
      const storageLocation = getStorageLocation()
      if (storageLocation && existsSync(storageLocation)) {
        try {
          rmSync(storageLocation, { recursive: true, force: true })
          logger.info('Storage folder deleted:', storageLocation)
        } catch (e) {
          logger.warn('Failed to delete storage folder:', getErrorMessage(e))
        }
      }

      // 6. Delete config file
      const configPath = getConfigPath()
      if (existsSync(configPath)) {
        try {
          unlinkSync(configPath)
          logger.info('Config file deleted:', configPath)
        } catch (e) {
          logger.warn('Failed to delete config file:', getErrorMessage(e))
        }
      }

      // 7. Reset in-memory config
      resetConfig()
      logger.info('Config reset')

      logger.info('Reset all data completed successfully')
      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to reset all data:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
