import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDatabase, closeDatabase, getAllAlbums, getImagesByStatus } from './database'
import { initConfig, getMasterFolder, getConfig } from './config'
import { registerIpcHandlers } from './ipc'
import { protocol } from 'electron'
import { watcherService } from './watcher'
import { uploadPipeline } from './pipeline'
import log, { createLogger, getErrorMessage } from './logger'
import { trayManager } from './tray'
import { compressionPool } from './compression-pool'
import { copyWatcherRegistry } from './copy-watcher'
import { networkService } from './network'

// Scoped logger for main process
const logger = createLogger('Main')

// ==================== App State ====================
let mainWindow: BrowserWindow | null = null
let isQuitting = false // Track if app is actually quitting vs minimize-to-tray

// Check if launched with --hidden flag (for Linux hidden start)
const isHiddenLaunch = process.argv.includes('--hidden')

// ==================== Deep Link Protocol ====================
const PROTOCOL = 'lumosnap'

// Handle deep link URL - just opens the app for now
function handleDeepLink(url: string): void {
  logger.info('Deep link received:', url)
  // Show the main window when app is opened via deep link
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
  }
}

// Request single instance lock to prevent multiple app instances
// This is required for deep links on Windows and Linux
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  logger.warn('Another instance is already running, quitting...')
  app.quit()
} else {
  // Handle second-instance event (Windows/Linux deep link handling)
  app.on('second-instance', (_event, commandLine) => {
    logger.info('Second instance detected, command line:', commandLine)
    // Find the deep link URL in command line arguments
    const deepLinkUrl = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl)
    } else {
      // Just show the window if no deep link
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore()
        }
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })

  // Handle open-url event (macOS deep link handling)
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })
}

// ==================== Global Error Handlers ====================
// Catch unhandled exceptions to prevent silent crashes
process.on('uncaughtException', (error: Error) => {
  log.error('Uncaught Exception:', error)
  // Log stack trace for debugging
  if (error.stack) {
    log.error('Stack trace:', error.stack)
  }
  // Don't exit - try to keep app running if possible
})

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

// Register file protocol as privileged
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'file',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

// ==================== Window Management ====================
function createWindow(): void {
  logger.info('Creating browser window...')
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false
    }
  })
  logger.info('Browser window created')

  mainWindow.on('ready-to-show', () => {
    logger.info('Browser window ready to show')
    if (mainWindow) {
      // Only show window if not launched hidden
      if (!isHiddenLaunch) {
        mainWindow.show()
      } else {
        logger.info('App launched in hidden mode, staying in tray')
      }

      if (is.dev) {
        logger.debug('Opening DevTools in dev mode')
        mainWindow.webContents.openDevTools()
      }
    }
  })

  // Close to tray instead of quitting (if enabled)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      const config = getConfig()
      if (config.minimizeToTray) {
        event.preventDefault()
        mainWindow?.hide()
        logger.debug('Window hidden to tray')
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Show main window - used by tray
 */
function showMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

/**
 * Actually quit the app
 */
function quitApp(): void {
  isQuitting = true
  app.quit()
}

// ==================== App Initialization ====================
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  logger.info('Electron app ready, initializing...')
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.lumosnap')

  // Register deep link protocol handler
  // In development mode, we need to pass the path to the electron executable and script
  if (process.defaultApp) {
    // Development mode: running via 'electron .' or 'electron-vite dev'
    if (process.argv.length >= 2) {
      const success = app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        process.argv[1]
      ])
      if (success) {
        logger.info(`✓ Registered as default protocol client for ${PROTOCOL}:// (dev mode)`)
      } else {
        logger.warn(`✗ Failed to register as default protocol client for ${PROTOCOL}:// (dev mode)`)
      }
    }
  } else {
    // Production mode: packaged app
    if (!app.isDefaultProtocolClient(PROTOCOL)) {
      const success = app.setAsDefaultProtocolClient(PROTOCOL)
      if (success) {
        logger.info(`✓ Registered as default protocol client for ${PROTOCOL}://`)
      } else {
        logger.warn(`✗ Failed to register as default protocol client for ${PROTOCOL}://`)
      }
    } else {
      logger.info(`Already registered as default protocol client for ${PROTOCOL}://`)
    }
  }

  // Initialize database
  logger.info('Initializing database...')
  try {
    initDatabase()
    logger.info('✓ Database initialized successfully')
  } catch (error) {
    logger.error('✗ Failed to initialize database:', getErrorMessage(error))
  }

  // Initialize config
  logger.info('Initializing config...')
  try {
    initConfig()
    logger.info('✓ Config initialized successfully')
  } catch (error) {
    logger.error('✗ Failed to initialize config:', getErrorMessage(error))
  }

  // ==================== System Tray ====================
  logger.info('Creating system tray...')
  trayManager.create({
    onShowWindow: showMainWindow,
    onQuit: quitApp,
    onPauseResume: (isPaused) => {
      // TODO: Implement pause/resume sync functionality
      logger.info(`Sync ${isPaused ? 'paused' : 'resumed'}`)
    }
  })
  logger.info('✓ System tray created')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => logger.debug('pong'))

  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (canceled) {
      return null
    } else {
      return filePaths[0]
    }
  })

  createWindow()

  // Handle cold start deep links (Windows/Linux)
  // Check if app was launched via deep link URL in command line arguments
  if (process.platform === 'win32' || process.platform === 'linux') {
    const deepLinkUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (deepLinkUrl) {
      logger.info('Cold start deep link detected:', deepLinkUrl)
      // Delay handling to ensure window is ready
      setTimeout(() => handleDeepLink(deepLinkUrl), 100)
    }
  }

  // ==================== Renderer Crash Recovery ====================
  // Handle renderer process crashes - attempt to recreate window
  app.on('render-process-gone', (_event, _webContents, details) => {
    logger.error('Renderer process gone:', details.reason, 'exitCode:', details.exitCode)

    if (details.reason === 'crashed' || details.reason === 'killed') {
      logger.warn('Attempting to recover by recreating window...')
      // Close existing window if not already destroyed
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close()
      }
      mainWindow = null

      // Recreate window after short delay
      setTimeout(() => {
        createWindow()
        if (mainWindow) {
          registerIpcHandlers(mainWindow)
          watcherService.initialize(mainWindow)
          logger.info('✓ Window recreated after crash recovery')
        }
      }, 1000)
    }
  })

  // Handle child process crashes
  app.on('child-process-gone', (_event, details) => {
    logger.error('Child process gone:', details.type, 'reason:', details.reason)
  })

  // Register IPC handlers after window is created
  logger.info('Registering IPC handlers...')
  if (mainWindow) {
    registerIpcHandlers(mainWindow)
    logger.info('✓ IPC handlers registered successfully')

    // Initialize Network Service
    try {
      networkService.initialize(mainWindow)
      logger.info('✓ Network service initialized')
    } catch (error) {
      logger.error('✗ Failed to initialize network service:', getErrorMessage(error))
    }

    // Initialize Watcher Service
    try {
      watcherService.initialize(mainWindow)
      logger.info('✓ Watcher service initialized')

      // Start master folder watcher if configured
      const masterFolder = getMasterFolder()
      if (masterFolder) {
        watcherService.watchMasterFolder(masterFolder)
        watcherService.scanMasterFolderOnStartup(masterFolder)
        logger.info('✓ Master folder watcher started')
      }
    } catch (error) {
      logger.error('✗ Failed to initialize watcher service:', getErrorMessage(error))
    }

    // Auto-retry failed uploads on startup
    try {
      const albums = getAllAlbums()
      let totalFailed = 0
      const albumsWithFailed: string[] = []

      for (const album of albums) {
        const failedImages = getImagesByStatus(album.id, 'failed')
        if (failedImages.length > 0) {
          totalFailed += failedImages.length
          albumsWithFailed.push(album.id)
        }
      }

      if (albumsWithFailed.length > 0) {
        logger.info(
          `Found ${totalFailed} failed images in ${albumsWithFailed.length} albums, auto-retrying...`
        )
        // Queue all albums with failed images - the pipeline queue system will handle them sequentially
        for (const albumId of albumsWithFailed) {
          uploadPipeline.startPipeline(albumId, mainWindow).catch((error) => {
            logger.error(`Auto-retry failed for album ${albumId}:`, getErrorMessage(error))
          })
        }
        logger.info('✓ Auto-retry queued for failed uploads')
      } else {
        logger.debug('No failed uploads to retry')
      }
    } catch (error) {
      logger.error('✗ Failed to check for failed uploads:', getErrorMessage(error))
    }
  } else {
    logger.error('✗ Cannot register IPC handlers: mainWindow is null')
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      if (mainWindow) {
        registerIpcHandlers(mainWindow)
        // Re-initialize watcher if needed
        watcherService.initialize(mainWindow)
      }
    } else {
      // Show existing window
      showMainWindow()
    }
  })
})

// ==================== App Lifecycle ====================
// Don't quit when all windows are closed - keep running in tray
app.on('window-all-closed', () => {
  // On macOS, apps typically stay in dock. On other platforms, we stay in tray.
  // Only quit if isQuitting is true (user explicitly quit)
  if (isQuitting) {
    logger.info('All windows closed and quitting, cleaning up...')
    closeDatabase()
    try {
      watcherService.closeAll()
    } catch {
      // Ignore
    }
    if (process.platform !== 'darwin') {
      app.quit()
    }
  } else {
    logger.debug('All windows closed, but staying in tray')
  }
})

app.on('before-quit', () => {
  logger.info('App quitting, cleaning up...')
  isQuitting = true
  trayManager.destroy()
  copyWatcherRegistry.disposeAll()
  compressionPool.shutdown().catch(() => {})
  closeDatabase()
  try {
    watcherService.closeAll()
  } catch {
    // Ignore
  }
})
