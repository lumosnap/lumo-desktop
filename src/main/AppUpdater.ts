import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { app, dialog, BrowserWindow } from 'electron'

export class AppUpdater {
  private mainWindow: BrowserWindow | null = null

  constructor(mainWindow?: BrowserWindow) {
    this.mainWindow = mainWindow || null
    
    // Configure logging
    log.transports.file.level = 'info'
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    // Setup event listeners
    this.setupEventListeners()

    // Only check for updates in production
    if (app.isPackaged) {
      // Check on startup (after 10 seconds)
      setTimeout(() => {
        log.info('Checking for updates on startup...')
        autoUpdater.checkForUpdates()
      }, 10000)

      // Check every 4 hours
      setInterval(() => {
        log.info('Periodic update check...')
        autoUpdater.checkForUpdates()
      }, 4 * 60 * 60 * 1000)
    } else {
      log.info('Development mode - auto-updates disabled')
    }
  }

  private setupEventListeners() {
    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for updates...')
      this.sendStatusToWindow('Checking for updates...')
    })

    autoUpdater.on('update-available', (info) => {
      log.info('Update available:', info.version)
      this.sendStatusToWindow(`Update available: ${info.version}`)
    })

    autoUpdater.on('update-not-available', (info) => {
      log.info('Update not available. Current version:', info.version)
      this.sendStatusToWindow('App is up to date')
    })

    autoUpdater.on('error', (err) => {
      log.error('Error in auto-updater:', err)
      this.sendStatusToWindow('Error checking for updates')
    })

    autoUpdater.on('download-progress', (progressObj) => {
      const message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`
      log.info(message)
      this.sendStatusToWindow(message)
    })

    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info.version)
      this.sendStatusToWindow('Update ready to install')
      
      // Show dialog to user
      this.showUpdateDialog(info)
    })
  }

  private sendStatusToWindow(message: string) {
    // Send status to renderer process if you want to show updates in UI
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', message)
    }
  }

  private showUpdateDialog(info: any) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is ready to install`,
      detail: 'The application will restart to apply the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        setImmediate(() => {
          app.removeAllListeners('window-all-closed')
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.close()
          }
          autoUpdater.quitAndInstall(false)
        })
      }
    })
  }

  public checkForUpdatesManually(): void {
    if (!app.isPackaged) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Development Mode',
        message: 'Auto-updates are only available in production builds.',
        buttons: ['OK']
      })
      return
    }

    autoUpdater.checkForUpdates().catch((error) => {
      log.error('Manual update check failed:', error)
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'Failed to check for updates. Please try again later.',
        buttons: ['OK']
      })
    })
  }

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }
}
