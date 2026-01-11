/**
 * Plans IPC Handlers
 *
 * Handles fetching subscription plans and requesting upgrades.
 */

import { ipcMain } from 'electron'
import { plansApi } from '../api-client'
import { createLogger } from '../logger'

const logger = createLogger('IPC:Plans')

export function registerPlansHandlers(): void {
  logger.info('Registering plans handlers...')

  ipcMain.handle('plans:list', async () => {
    try {
      logger.info('Fetching available plans')
      const plans = await plansApi.list()
      return { success: true, data: plans }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get plans'
      logger.error('Failed to get plans:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plans:requestUpgrade', async (_, planId: number) => {
    try {
      logger.info(`Requesting upgrade to plan ${planId}`)
      await plansApi.requestUpgrade(planId)
      return { success: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to request upgrade'
      logger.error('Failed to request upgrade:', message)
      return { success: false, error: message }
    }
  })

  logger.info('Plans handlers registered')
}
