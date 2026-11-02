import { autoUpdater, type UpdateInfo } from 'electron-updater'
import log from 'electron-log'
import { app, dialog, shell, BrowserWindow } from 'electron'

// The macOS builds aren't code-signed, and Squirrel.Mac won't install into an unsigned app
// ("Could not get code signature for running application"). On a Mac the app only says a new
// version is out and links its .dmg; the user installs it by hand.
const manualMac = process.platform === 'darwin'

// The .dmg for this Mac's chip; an Intel build running under Rosetta gets the Apple Silicon one
function macDownloadUrl(version: string): string {
  const arch = process.arch === 'arm64' || app.runningUnderARM64Translation ? 'arm64' : 'x64'
  return `https://github.com/lumosnap/lumo-desktop/releases/download/v${version}/lumosnap-${version}-${arch}.dmg`
}

export class AppUpdater {
  private mainWindow: BrowserWindow | null = null
  private announced = '' // the version whose download dialog was shown this session

  constructor(mainWindow?: BrowserWindow) {
    this.mainWindow = mainWindow || null

    // Configure logging
    log.transports.file.level = 'info'
    autoUpdater.logger = log
    autoUpdater.autoDownload = !manualMac
    autoUpdater.autoInstallOnAppQuit = !manualMac

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
      if (!manualMac) {
        this.sendStatusToWindow(`Update available: ${info.version}`)
        return
      }
      const url = macDownloadUrl(info.version)
      this.sendStatusToWindow(`Version ${info.version} is available`, url)
      if (this.announced === info.version) return // the 4-hourly check doesn't nag again
      this.announced = info.version
      dialog
        .showMessageBox({
          type: 'info',
          title: 'Update Available',
          message: `Version ${info.version} is available`,
          detail:
            "Updates can't install themselves on macOS yet. Download the new version, quit LumoSnap, then drag it into Applications.",
          buttons: ['Download', 'Later'],
          defaultId: 0,
          cancelId: 1
        })
        .then(({ response }) => {
          if (response === 0) void shell.openExternal(url)
        })
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
      const mb = (bytes: number): string => (bytes / 1048576).toFixed(1)
      const { percent, transferred, total, bytesPerSecond } = progressObj
      const message = `Downloading ${Math.floor(percent)}% (${mb(transferred)} of ${mb(total)} MB, ${mb(bytesPerSecond)} MB/s)`
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

  private sendStatusToWindow(message: string, downloadUrl?: string) {
    // Send status to renderer process if you want to show updates in UI
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', message, downloadUrl)
    }
  }

  private showUpdateDialog(info: UpdateInfo) {
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
