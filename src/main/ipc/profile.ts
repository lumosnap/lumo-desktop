/**
 * Profile IPC handlers
 */

import { ipcMain } from 'electron'
import { profileApi } from '../api-client'
import { createLogger, getErrorMessage } from '../logger'

const logger = createLogger('IPC:Profile')

export function registerProfileHandlers(): void {
  ipcMain.handle('profile:get', async () => {
    try {
      const profile = await profileApi.get()
      return { success: true, data: profile }
    } catch (error: unknown) {
      logger.error('Failed to get profile:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'profile:update',
    async (_, data: { businessName?: string; phone?: string }) => {
      try {
        const profile = await profileApi.update(data)
        return { success: true, data: profile }
      } catch (error: unknown) {
        logger.error('Failed to update profile:', getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle('profile:getBookingUrl', async () => {
    try {
      const result = await profileApi.getBookingUrl()
      return { success: true, bookingUrl: result.bookingUrl }
    } catch (error: unknown) {
      logger.error('Failed to get booking URL:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('profile:getBookings', async () => {
    try {
      const bookings = await profileApi.getBookings()
      return { success: true, data: bookings }
    } catch (error: unknown) {
      logger.error('Failed to get bookings:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('profile:getBillingAddresses', async () => {
    try {
      const addresses = await profileApi.getBillingAddresses()
      return { success: true, data: addresses }
    } catch (error: unknown) {
      logger.error('Failed to get billing addresses:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'profile:createBillingAddress',
    async (
      _,
      data: {
        street: string
        city: string
        state: string
        zip: string
        country: string
        isDefault?: boolean
      }
    ) => {
      try {
        const address = await profileApi.createBillingAddress(data)
        return { success: true, data: address }
      } catch (error: unknown) {
        logger.error('Failed to create billing address:', getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'profile:updateBillingAddress',
    async (
      _,
      addressId: number,
      data: {
        street?: string
        city?: string
        state?: string
        zip?: string
        country?: string
        isDefault?: boolean
      }
    ) => {
      try {
        const address = await profileApi.updateBillingAddress(addressId, data)
        return { success: true, data: address }
      } catch (error: unknown) {
        logger.error('Failed to update billing address:', getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )
}
