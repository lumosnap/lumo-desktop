/**
 * Profile IPC handlers
 */

import { profileApi } from '../api-client'
import { createLogger } from '../logger'
import { handleIpc } from './types'

const logger = createLogger('IPC:Profile')

export function registerProfileHandlers(): void {
  handleIpc('profile:get', logger, async () => {
    const profile = await profileApi.get()
    return { data: profile }
  })

  handleIpc(
    'profile:update',
    logger,
    async (_, data: { businessName?: string; phone?: string }) => {
      const profile = await profileApi.update(data)
      return { data: profile }
    }
  )

  handleIpc('profile:getBookingUrl', logger, async () => {
    const result = await profileApi.getBookingUrl()
    return { bookingUrl: result.bookingUrl }
  })

  handleIpc('profile:getBookings', logger, async () => {
    const bookings = await profileApi.getBookings()
    return { data: bookings }
  })

  handleIpc('profile:getBillingAddresses', logger, async () => {
    const addresses = await profileApi.getBillingAddresses()
    return { data: addresses }
  })

  handleIpc(
    'profile:createBillingAddress',
    logger,
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
      const address = await profileApi.createBillingAddress(data)
      return { data: address }
    }
  )

  handleIpc(
    'profile:updateBillingAddress',
    logger,
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
      const address = await profileApi.updateBillingAddress(addressId, data)
      return { data: address }
    }
  )
}
