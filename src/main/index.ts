import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDatabase, closeDatabase, getAllAlbums, getImagesByStatus } from './database'
import { initConfig, getMasterFolder } from './config'
import { registerIpcHandlers } from './ipc-handlers'
import { protocol } from 'electron'
import { watcherService } from './watcher'
import { uploadPipeline } from './pipeline'

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
  console.log('[Main] Creating browser window...')
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
  console.log('[Main] Browser window created')

  mainWindow.on('ready-to-show', () => {
    console.log('[Main] Browser window ready to show')
    if (mainWindow) {
      mainWindow.show()
      if (is.dev) {
        console.log('[Main] Opening DevTools in dev mode')
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
  console.log('[Main] Electron app ready, initializing...')
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Initialize database
  console.log('[Main] Initializing database...')
  try {
    initDatabase()
    console.log('[Main] ✓ Database initialized successfully')
  } catch (error) {
    console.error('[Main] ✗ Failed to initialize database:', error)
  }

  // Initialize config
  console.log('[Main] Initializing config...')
  try {
    initConfig()
    console.log('[Main] ✓ Config initialized successfully')
  } catch (error) {
    console.error('[Main] ✗ Failed to initialize config:', error)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

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

  // Register IPC handlers after window is created
  console.log('[Main] Registering IPC handlers...')
  if (mainWindow) {
    registerIpcHandlers(mainWindow)
    console.log('[Main] ✓ IPC handlers registered successfully')
    
    // Initialize Watcher Service
    try {
      watcherService.initialize(mainWindow)
      console.log('[Main] ✓ Watcher service initialized')
      
      // Start master folder watcher if configured
      const masterFolder = getMasterFolder()
      if (masterFolder) {
        watcherService.watchMasterFolder(masterFolder)
        watcherService.scanMasterFolderOnStartup(masterFolder)
        console.log('[Main] ✓ Master folder watcher started')
      }
    } catch (error) {
      console.error('[Main] ✗ Failed to initialize watcher service:', error)
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
        console.log(`[Main] Found ${totalFailed} failed images in ${albumsWithFailed.length} albums, auto-retrying...`)
        // Queue all albums with failed images - the pipeline queue system will handle them sequentially
        for (const albumId of albumsWithFailed) {
          uploadPipeline.startPipeline(albumId, mainWindow).catch((error) => {
            console.error(`[Main] Auto-retry failed for album ${albumId}:`, error)
          })
        }
        console.log('[Main] ✓ Auto-retry queued for failed uploads')
      } else {
        console.log('[Main] No failed uploads to retry')
      }
    } catch (error) {
      console.error('[Main] ✗ Failed to check for failed uploads:', error)
    }
  } else {
    console.error('[Main] ✗ Cannot register IPC handlers: mainWindow is null')
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
  closeDatabase()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
