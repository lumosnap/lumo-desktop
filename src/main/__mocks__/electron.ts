/**
 * Mock Electron module for unit testing
 *
 * This provides stub implementations of Electron APIs
 * so we can test main process code without launching Electron.
 */

// Mock app
export const app = {
  getPath: (name: string) => {
    const paths: Record<string, string> = {
      userData: '/tmp/lumosnap-test',
      documents: '/tmp/lumosnap-test/documents',
      temp: '/tmp'
    }
    return paths[name] || '/tmp'
  },
  whenReady: () => Promise.resolve(),
  on: () => {},
  quit: () => {},
  getName: () => 'Lumosnap',
  getVersion: () => '0.1.0-test'
}

// Mock BrowserWindow
export class BrowserWindow {
  webContents = {
    send: () => {},
    openDevTools: () => {},
    on: () => {}
  }
  loadURL = () => Promise.resolve()
  loadFile = () => Promise.resolve()
  on = () => this
  show = () => {}
  hide = () => {}
  close = () => {}
  isDestroyed = () => false

  static getAllWindows = () => []
}

// Mock ipcMain
export const ipcMain = {
  handle: () => {},
  on: () => {},
  removeHandler: () => {}
}

// Mock dialog
export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: () => Promise.resolve({ canceled: true, filePath: undefined }),
  showMessageBox: () => Promise.resolve({ response: 0 })
}

// Mock shell
export const shell = {
  openExternal: () => Promise.resolve(),
  openPath: () => Promise.resolve('')
}

// Mock net
export const net = {
  request: () => ({
    setHeader: () => {},
    on: () => {},
    write: () => {},
    end: () => {}
  })
}

// Mock safeStorage
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (str: string) => Buffer.from(str),
  decryptString: (buf: Buffer) => buf.toString()
}

// Mock protocol
export const protocol = {
  registerSchemesAsPrivileged: () => {}
}

// Default export matching Electron's module structure
export default {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  net,
  safeStorage,
  protocol
}
