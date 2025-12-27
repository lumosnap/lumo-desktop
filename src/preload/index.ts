import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  auth: {
    setSessionCookie: (cookie: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('auth:setSessionCookie', cookie),
    clearSession: (): Promise<{ success: boolean }> => ipcRenderer.invoke('auth:clearSession'),
    googleOAuth: (): Promise<any> => ipcRenderer.invoke('auth:googleOAuth')
  },
  config: {
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('config:isConfigured'),
    getStorageLocation: (): Promise<string | null> =>
      ipcRenderer.invoke('config:getStorageLocation'),
    setStorageLocation: (path: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('config:setStorageLocation', path),
    getFreeSpace: (path: string): Promise<{ bytes: number; formatted: string; error?: string }> =>
      ipcRenderer.invoke('config:getFreeSpace', path),
    getConfig: (): Promise<any> => ipcRenderer.invoke('config:getConfig')
  },
  albums: {
    create: (data: {
      title: string
      eventDate: string | null
      sourceFolderPath: string
    }): Promise<any> => ipcRenderer.invoke('album:create', data),
    list: (): Promise<any> => ipcRenderer.invoke('album:list'),
    get: (albumId: string): Promise<any> => ipcRenderer.invoke('album:get', albumId),
    delete: (albumId: string): Promise<any> => ipcRenderer.invoke('album:delete', albumId),
    getImages: (albumId: string): Promise<any> => ipcRenderer.invoke('album:getImages', albumId),
    scanSourceFolder: (path: string): Promise<any> =>
      ipcRenderer.invoke('album:scanSourceFolder', path),
    startUpload: (albumId: string): Promise<any> =>
      ipcRenderer.invoke('album:startUpload', albumId),
    getProgress: (albumId: string): Promise<any> =>
      ipcRenderer.invoke('album:getProgress', albumId),
    retryFailed: (albumId: string): Promise<any> => ipcRenderer.invoke('album:retryFailed', albumId)
  },
  sync: {
    detectChanges: (albumId: string): Promise<any> =>
      ipcRenderer.invoke('sync:detectChanges', albumId),
    execute: (albumId: string, changes: any): Promise<any> =>
      ipcRenderer.invoke('sync:execute', albumId, changes)
  },
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory')
  },
  api: {
    generateShareLink: (albumId: string): Promise<any> =>
      ipcRenderer.invoke('api:generateShareLink', albumId),
    getFavorites: (albumId: string): Promise<any> => ipcRenderer.invoke('api:getFavorites', albumId)
  },

  // Progress events listener
  // Event listeners
  on: (channel: string, callback: (event: any, ...args: any[]) => void) => {
    const validChannels = [
      'upload:progress',
      'upload:batch-start',
      'upload:complete',
      'upload:error'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, callback)
    }
  },
  off: (channel: string, callback: (event: any, ...args: any[]) => void) => {
    const validChannels = [
      'upload:progress',
      'upload:batch-start',
      'upload:complete',
      'upload:error'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
