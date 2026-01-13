import { Notification } from 'electron'
import { createLogger } from './logger'

const logger = createLogger('Notifications')

export interface NotificationOptions {
  title: string
  body: string
  silent?: boolean
}

class NotificationService {
  private isSupported: boolean

  constructor() {
    this.isSupported = Notification.isSupported()
    if (!this.isSupported) {
      logger.warn('Desktop notifications are not supported on this platform')
    }
  }

  show(options: NotificationOptions): void {
    if (!this.isSupported) return

    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: options.silent ?? false
    })

    notification.show()
    logger.info(`Notification shown: ${options.title}`)
  }

  // Pre-defined notification types
  albumCreated(albumTitle: string): void {
    this.show({
      title: 'Album Created',
      body: `"${albumTitle}" has been created and upload started.`
    })
  }

  syncComplete(albumTitle: string): void {
    this.show({
      title: 'Sync Complete',
      body: `"${albumTitle}" has been fully uploaded to the cloud.`
    })
  }

  authConnected(userName: string): void {
    this.show({
      title: 'Account Connected',
      body: `Welcome, ${userName}! Your LumoSnap account is now linked.`
    })
  }

  uploadFailed(albumTitle: string, failedCount: number): void {
    this.show({
      title: 'Upload Failed',
      body: `${failedCount} image(s) failed to upload for "${albumTitle}".`
    })
  }
}

export const notificationService = new NotificationService()
