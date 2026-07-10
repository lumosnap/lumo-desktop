/**
 * Shared types for IPC handlers
 *
 * Provides type-safe result pattern for all IPC communication
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { createLogger, getErrorMessage } from '../logger'

/**
 * Standardized IPC result type
 */
export type IpcResult<T = void> = { success: true; data?: T } | { success: false; error: string }

/**
 * Register an ipcMain.handle wrapped with the standard success/error envelope.
 *
 * The handler returns just its payload object (e.g. `{ data }`, `{ bookingUrl }`);
 * the returned object is spread onto `{ success: true, ... }` so handlers can
 * expose extra keys. On throw it logs and returns `{ success: false, error }`.
 */
export function handleIpc<Args extends unknown[], T extends object | void>(
  channel: string,
  logger: ReturnType<typeof createLogger>,
  fn: (event: IpcMainInvokeEvent, ...args: Args) => Promise<T> | T
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await fn(event, ...(args as Args))
      return { success: true, ...(result ?? {}) }
    } catch (error: unknown) {
      logger.error(`${channel} failed:`, getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })
}

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
