import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDatabase, closeDatabase, getAllAlbums, getImagesByStatus } from './database'
import { initConfig, getMasterFolder } from './config'
import { registerIpcHandlers } from './ipc'
import { protocol } from 'electron'
import { watcherService } from './watcher'
import { uploadPipeline } from './pipeline'
import log, { createLogger, getErrorMessage } from './logger'

// Scoped logger for main process
const logger = createLogger('Main')

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

let mainWindow: BrowserWindow | null = null

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
      mainWindow.show()
      if (is.dev) {
        logger.debug('Opening DevTools in dev mode')
        mainWindow.webContents.openDevTools()
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  logger.info('Electron app ready, initializing...')
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.lumosnap')

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
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  logger.info('All windows closed, cleaning up...')
  closeDatabase()
  try {
    watcherService.closeAll()
  } catch {
    // Ignore
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  logger.info('App quitting, closing database...')
  closeDatabase()
})

