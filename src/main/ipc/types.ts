/**
 * Shared types for IPC handlers
 *
 * Provides type-safe result pattern for all IPC communication
 */

import { createLogger, getErrorMessage } from '../logger'

/**
 * Standardized IPC result type
 */
export type IpcResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string }

/**
 * Wrap an async handler with error handling and logging
 */
export function wrapHandler<T>(
  handlerName: string,
  fn: () => Promise<T>,
  logger = createLogger('IPC')
): Promise<IpcResult<T>> {
  return fn()
    .then((data) => ({ success: true as const, data }))
    .catch((error: unknown) => {
      logger.error(`${handlerName} failed:`, getErrorMessage(error))
      return { success: false as const, error: getErrorMessage(error) }
    })
}

/**
 * Wrap a sync handler with error handling and logging
 */
export function wrapSyncHandler<T>(
  handlerName: string,
  fn: () => T,
  logger = createLogger('IPC')
): IpcResult<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (error: unknown) {
    logger.error(`${handlerName} failed:`, getErrorMessage(error))
    return { success: false, error: getErrorMessage(error) }
  }
}
