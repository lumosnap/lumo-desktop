import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  auth: {
    getStoredAuth: (): Promise<{ success: boolean; token: string | null; user: any }> =>
      ipcRenderer.invoke('auth:getStoredAuth'),
    startAuth: (): Promise<{ success: boolean; user?: any; error?: string }> =>
      ipcRenderer.invoke('auth:startAuth'),
    logout: (): Promise<{ success: boolean }> => ipcRenderer.invoke('auth:logout')
  },
  config: {
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('config:isConfigured'),
    getStorageLocation: (): Promise<string | null> =>
      ipcRenderer.invoke('config:getStorageLocation'),
    setStorageLocation: (path: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('config:setStorageLocation', path),
    getFreeSpace: (path: string): Promise<{ bytes: number; formatted: string; error?: string }> =>
      ipcRenderer.invoke('config:getFreeSpace', path),
    getConfig: (): Promise<any> => ipcRenderer.invoke('config:getConfig'),
    getCurrentStorageInfo: (): Promise<{
      success: boolean
      path: string | null
      freeSpace: number
      freeSpaceFormatted: string
      isLowStorage: boolean
      error?: string
    }> => ipcRenderer.invoke('config:getCurrentStorageInfo'),
    getMasterFolder: (): Promise<string | null> => ipcRenderer.invoke('config:getMasterFolder'),
    setMasterFolder: (path: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('config:setMasterFolder', path),
    scanMasterFolder: (): Promise<{
      success: boolean
      folders: Array<{ name: string; path: string; imageCount: number }>
      error?: string
    }> => ipcRenderer.invoke('config:scanMasterFolder')
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
    deleteImage: (albumId: string, imageId: number): Promise<any> =>
      ipcRenderer.invoke('album:deleteImage', albumId, imageId),
    deleteImages: (albumId: string, imageIds: number[]): Promise<any> =>
      ipcRenderer.invoke('album:deleteImages', albumId, imageIds),
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
    getFavorites: (albumId: string, clientName?: string): Promise<any> =>
      ipcRenderer.invoke('api:getFavorites', albumId, clientName)
  },
  plans: {
    list: (): Promise<{
      success: boolean
      data?: Array<{
        id: number
        name: string
        displayName: string
        imageLimit: number
        priceMonthly: string
        description: string
      }>
      error?: string
    }> => ipcRenderer.invoke('plans:list'),
    requestUpgrade: (
      planId: number
    ): Promise<{
      success: boolean
      error?: string
    }> => ipcRenderer.invoke('plans:requestUpgrade', planId)
  },
  profile: {
    get: (): Promise<{
      success: boolean
      data?: {
        id: number
        userId: string | null
        businessName: string | null
        phone: string | null
        storageUsed: number | null
        totalImages: number
        globalMaxImages: number
        imageLimit: number
        planName: string
        planExpiry: string | null
        profileCompleted: boolean
        createdAt: string
        updatedAt: string
      }
      error?: string
    }> => ipcRenderer.invoke('profile:get'),
    update: (data: {
      businessName?: string
      phone?: string
    }): Promise<{
      success: boolean
      data?: {
        id: number
        userId: string | null
        businessName: string | null
        phone: string | null
        storageUsed: number | null
        createdAt: string
        updatedAt: string
      }
      error?: string
    }> => ipcRenderer.invoke('profile:update', data),
    getBookingUrl: (): Promise<{
      success: boolean
      bookingUrl?: string
      error?: string
    }> => ipcRenderer.invoke('profile:getBookingUrl'),
    getBookings: (): Promise<{
      success: boolean
      data?: Array<any>
      error?: string
    }> => ipcRenderer.invoke('profile:getBookings'),
    getBillingAddresses: (): Promise<{
      success: boolean
      data?: Array<{
        id: number
        userId: number | null
        street: string
        city: string
        state: string
        zip: string
        country: string
        isDefault: boolean | null
        createdAt: string
      }>
      error?: string
    }> => ipcRenderer.invoke('profile:getBillingAddresses'),
    createBillingAddress: (data: {
      street: string
      city: string
      state: string
      zip: string
      country: string
      isDefault?: boolean
    }): Promise<{
      success: boolean
      data?: {
        id: number
        userId: number | null
        street: string
        city: string
        state: string
        zip: string
        country: string
        isDefault: boolean | null
        createdAt: string
      }
      error?: string
    }> => ipcRenderer.invoke('profile:createBillingAddress', data),
    updateBillingAddress: (
      addressId: number,
      data: {
        street?: string
        city?: string
        state?: string
        zip?: string
        country?: string
        isDefault?: boolean
      }
    ): Promise<{
      success: boolean
      data?: {
        id: number
        userId: number | null
        street: string
        city: string
        state: string
        zip: string
        country: string
        isDefault: boolean | null
        createdAt: string
      }
      error?: string
    }> => ipcRenderer.invoke('profile:updateBillingAddress', addressId, data)
  },
  shell: {
    showItemInFolder: (
      albumId: string,
      imageId: number
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('shell:showItemInFolder', albumId, imageId),
    openFolder: (folderPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('shell:openFolder', folderPath)
  },
  settings: {
    getAutoStart: (): Promise<{
      success: boolean
      enabled: boolean
      openAsHidden: boolean
      error?: string
    }> => ipcRenderer.invoke('settings:getAutoStart'),
    setAutoStart: (
      enabled: boolean
    ): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:setAutoStart', enabled),
    getMinimizeToTray: (): Promise<{ success: boolean; enabled: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:getMinimizeToTray'),
    setMinimizeToTray: (
      enabled: boolean
    ): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:setMinimizeToTray', enabled),
    getAll: (): Promise<{
      success: boolean
      settings?: {
        autoStart: boolean
        autoStartHidden: boolean
        minimizeToTray: boolean
      }
      error?: string
    }> => ipcRenderer.invoke('settings:getAll')
  },

  // Progress events listener
  // Event listeners
  on: (channel: string, callback: (event: any, ...args: any[]) => void) => {
    const validChannels = [
      'upload:progress',
      'upload:batch-start',
      'upload:complete',
      'upload:error',
      'album:status-changed',
      'albums:refresh',
      'master-folder:change'
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
      'upload:error',
      'album:status-changed',
      'albums:refresh',
      'master-folder:change'
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
