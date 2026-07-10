/**
 * Plans IPC Handlers
 *
 * Handles fetching subscription plans and requesting upgrades.
 */

import { plansApi } from '../api-client'
import { createLogger } from '../logger'
import { handleIpc } from './types'

const logger = createLogger('IPC:Plans')

export function registerPlansHandlers(): void {
  logger.info('Registering plans handlers...')

  handleIpc('plans:list', logger, async () => {
    logger.info('Fetching available plans')
    const plans = await plansApi.list()
    return { data: plans }
  })

  handleIpc('plans:requestUpgrade', logger, async (_, planId: number) => {
    logger.info(`Requesting upgrade to plan ${planId}`)
    await plansApi.requestUpgrade(planId)
  })

  logger.info('Plans handlers registered')
}
