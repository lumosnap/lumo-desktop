import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppConfig } from '../main/config'
import type { Album, AlbumSet, Image } from '../main/database'
import type { SyncResult, ExecuteSyncResult, SyncChanges } from '../main/ipc/sync'
import type { FileStats } from '../main/storage'
import type { UploadProgress } from '../main/pipeline'
import type { Booking, ApiFavoriteImage } from '../main/api-client'
import type { TagConfig } from '../main/ipc/albums'
import type { PeopleConfig, PersonSummary } from '../main/people'

type SetsResult = { success: true; sets: AlbumSet[] } | { success: false; error: string }
type Result = { success: boolean; error?: string }
type FaceInImage = {
  faceId: number
  box: [number, number, number, number]
  personId: string | null
  name: string | null
}
type FaceTarget = { personId: string } | { newName: string } | { none: true }

type AuthUser = { id: string; email: string; name: string; image?: string }

type AlbumImageWithFavorites = Image & {
  isFavorite: boolean
  favoriteCount: number
  notesCount: number
  comments: Array<{ clientName: string; notes: string | null; createdAt: string }>
}

const api = {
  auth: {
    getStoredAuth: (): Promise<{ success: boolean; token: string | null; user: AuthUser | null }> =>
      ipcRenderer.invoke('auth:getStoredAuth'),
    startAuth: (): Promise<{ success: boolean; user?: AuthUser; error?: string }> =>
      ipcRenderer.invoke('auth:startAuth'),
    requestDeviceCode: (): Promise<{
      success: boolean
      device_code?: string
      user_code?: string
      verification_uri?: string
      verification_uri_complete?: string
      expires_in?: number
      interval?: number
      error?: string
    }> => ipcRenderer.invoke('auth:requestDeviceCode'),
    pollDeviceToken: (
      deviceCode: string
    ): Promise<{
      success: boolean
      pending?: boolean
      error?: string
      error_description?: string
      interval?: number
      user?: AuthUser
    }> => ipcRenderer.invoke('auth:pollDeviceToken', deviceCode),
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
    getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:getConfig'),
    getAppVersion: (): Promise<string> => ipcRenderer.invoke('config:getAppVersion'),
    getCurrentStorageInfo: (): Promise<{
      success: boolean
      path: string | null
      freeSpace: number
      freeSpaceFormatted: string
      isLowStorage: boolean
      error?: string
    }> => ipcRenderer.invoke('config:getCurrentStorageInfo'),
    resetAllData: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('config:resetAllData')
  },
  albums: {
    create: (data: {
      title: string
      eventDate: string | null
      sourceFolderPath: string
      albumType?: 'watch_folder' | 'standalone'
      eventType?: string // an EventType id; default 'wedding'
    }): Promise<{ success: true; album: Album } | { success: false; error: string }> =>
      ipcRenderer.invoke('album:create', data),
    list: (): Promise<any> => ipcRenderer.invoke('album:list'),
    get: (
      albumId: string
    ): Promise<{ success: true; album: Album } | { success: false; error: string }> =>
      ipcRenderer.invoke('album:get', albumId),
    delete: (albumId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('album:delete', albumId),
    getImages: (
      albumId: string
    ): Promise<{ success: boolean; images: AlbumImageWithFavorites[]; error?: string }> =>
      ipcRenderer.invoke('album:getImages', albumId),
    // Grouping/analysis results changed for an album; returns the unsubscribe
    onAnalyzed: (callback: (albumId: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { albumId: string }): void =>
        callback(data.albumId)
      ipcRenderer.on('album:analyzed', handler)
      return () => ipcRenderer.removeListener('album:analyzed', handler)
    },
    deleteImage: (
      albumId: string,
      imageId: number
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('album:deleteImage', albumId, imageId),
    deleteImages: (
      albumId: string,
      imageIds: number[]
    ): Promise<{ success: boolean; deletedCount?: number; error?: string }> =>
      ipcRenderer.invoke('album:deleteImages', albumId, imageIds),
    copyImages: (
      albumId: string,
      imageIds: number[]
    ): Promise<{ success: boolean; count?: number; errorCount?: number; error?: string }> =>
      ipcRenderer.invoke('album:copyImages', albumId, imageIds),
    scanSourceFolder: (
      path: string
    ): Promise<{ success: boolean; count: number; images: FileStats[]; error?: string }> =>
      ipcRenderer.invoke('album:scanSourceFolder', path),
    startUpload: (albumId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('album:startUpload', albumId),
    getProgress: (
      albumId: string
    ): Promise<{ success: boolean; progress?: UploadProgress; error?: string }> =>
      ipcRenderer.invoke('album:getProgress', albumId),
    retryFailed: (albumId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('album:retryFailed', albumId),
    forceRefresh: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('albums:forceRefresh')
  },
  sets: {
    list: (albumId: string): Promise<SetsResult> => ipcRenderer.invoke('sets:list', albumId),
    create: (albumId: string, name: string, imageIds?: number[]): Promise<SetsResult> =>
      ipcRenderer.invoke('sets:create', albumId, name, imageIds),
    rename: (setId: string, name: string): Promise<SetsResult> =>
      ipcRenderer.invoke('sets:rename', setId, name),
    delete: (setId: string): Promise<SetsResult> => ipcRenderer.invoke('sets:delete', setId),
    reorder: (albumId: string, orderedIds: string[]): Promise<SetsResult> =>
      ipcRenderer.invoke('sets:reorder', albumId, orderedIds),
    addImages: (setId: string, imageIds: number[]): Promise<SetsResult> =>
      ipcRenderer.invoke('sets:addImages', setId, imageIds),
    removeImages: (setId: string, imageIds: number[]): Promise<SetsResult> =>
      ipcRenderer.invoke('sets:removeImages', setId, imageIds),
    setCover: (setId: string, imageId: number | null): Promise<SetsResult> =>
      ipcRenderer.invoke('sets:setCover', setId, imageId),
    fromMoment: (albumId: string, momentId: string, name: string): Promise<SetsResult> =>
      ipcRenderer.invoke('sets:fromMoment', albumId, momentId, name),
    // An album's sets changed in main; returns the unsubscribe
    onSetsChanged: (callback: (albumId: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { albumId: string }): void =>
        callback(data.albumId)
      ipcRenderer.on('album:setsChanged', handler)
      return () => ipcRenderer.removeListener('album:setsChanged', handler)
    }
  },
  tags: {
    getAlbumConfig: (albumId: string): Promise<TagConfig> =>
      ipcRenderer.invoke('tags:getAlbumConfig', albumId),
    // Re-scores the album's AI tags from stored embeddings
    setAlbumConfig: (albumId: string, enabled: string[] | null): Promise<TagConfig> =>
      ipcRenderer.invoke('tags:setAlbumConfig', albumId, enabled),
    // Clears the tag set back to the new event type's pack and re-scores
    setEventType: (albumId: string, eventType: string): Promise<TagConfig> =>
      ipcRenderer.invoke('tags:setEventType', albumId, eventType),
    add: (
      albumId: string,
      imageIds: number[],
      tag: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tags:add', albumId, imageIds, tag),
    remove: (
      albumId: string,
      imageIds: number[],
      tag: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tags:remove', albumId, imageIds, tag)
  },
  people: {
    getConfig: (albumId: string): Promise<PeopleConfig> =>
      ipcRenderer.invoke('people:getConfig', albumId),
    setEnabled: (albumId: string, enabled: boolean): Promise<PeopleConfig> =>
      ipcRenderer.invoke('people:setEnabled', albumId, enabled),
    list: (albumId: string): Promise<PersonSummary[]> => ipcRenderer.invoke('people:list', albumId),
    rename: (albumId: string, personId: string, name: string | null): Promise<Result> =>
      ipcRenderer.invoke('people:rename', albumId, personId, name),
    merge: (albumId: string, intoId: string, fromIds: string[]): Promise<Result> =>
      ipcRenderer.invoke('people:merge', albumId, intoId, fromIds),
    setHidden: (albumId: string, personId: string, hidden: boolean): Promise<Result> =>
      ipcRenderer.invoke('people:setHidden', albumId, personId, hidden),
    setCover: (albumId: string, personId: string, faceId: number): Promise<Result> =>
      ipcRenderer.invoke('people:setCover', albumId, personId, faceId),
    facesInImage: (albumId: string, imageId: number): Promise<FaceInImage[]> =>
      ipcRenderer.invoke('people:facesInImage', albumId, imageId),
    assignFace: (
      albumId: string,
      faceId: number,
      target: FaceTarget
    ): Promise<Result & { personId?: string | null }> =>
      ipcRenderer.invoke('people:assignFace', albumId, faceId, target),
    linkClient: (albumId: string, clientName: string, personId: string | null): Promise<Result> =>
      ipcRenderer.invoke('people:linkClient', albumId, clientName, personId),
    clientLinks: (albumId: string): Promise<Record<string, string>> =>
      ipcRenderer.invoke('people:clientLinks', albumId),
    // An album's faces/people or People progress changed in main; returns the unsubscribe
    onPeopleChanged: (callback: (albumId: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { albumId: string }): void =>
        callback(data.albumId)
      ipcRenderer.on('album:peopleChanged', handler)
      return () => ipcRenderer.removeListener('album:peopleChanged', handler)
    }
  },
  sync: {
    detectChanges: (albumId: string): Promise<SyncResult> =>
      ipcRenderer.invoke('sync:detectChanges', albumId),
    execute: (albumId: string, changes: Partial<SyncChanges>): Promise<ExecuteSyncResult> =>
      ipcRenderer.invoke('sync:execute', albumId, changes)
  },
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory')
  },
  api: {
    generateShareLink: (
      albumId: string
    ): Promise<{
      success: boolean
      shareLink?: { shareLinkToken: string | null; shareUrl: string; expiresAt: null }
      error?: string
    }> => ipcRenderer.invoke('api:generateShareLink', albumId),
    getFavorites: (
      albumId: string,
      clientName?: string
    ): Promise<{
      success: boolean
      favorites: ApiFavoriteImage[]
      clientNames: string[]
      error?: string
    }> => ipcRenderer.invoke('api:getFavorites', albumId, clientName)
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
      data?: Booking[]
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
  network: {
    getStatus: (): Promise<{ online: boolean }> => ipcRenderer.invoke('network:getStatus'),
    checkConnectivity: (): Promise<{ online: boolean }> =>
      ipcRenderer.invoke('network:checkConnectivity'),
    onStatusChange: (callback: (online: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { online: boolean }): void =>
        callback(data.online)
      ipcRenderer.on('network:status-changed', handler)
      return () => ipcRenderer.removeListener('network:status-changed', handler)
    }
  },

  // Progress events listener
  // Event listeners
  on: <A extends unknown[]>(
    channel: string,
    callback: (event: IpcRendererEvent, ...args: A) => void
  ) => {
    const validChannels = [
      'upload:progress',
      'upload:batch-start',
      'upload:complete',
      'upload:error',
      'album:status-changed',
      'albums:refresh',
      'network:status-changed',
      'update-status'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, callback)
    }
  },
  off: <A extends unknown[]>(
    channel: string,
    callback: (event: IpcRendererEvent, ...args: A) => void
  ) => {
    const validChannels = [
      'upload:progress',
      'upload:batch-start',
      'upload:complete',
      'upload:error',
      'album:status-changed',
      'albums:refresh',
      'network:status-changed',
      'update-status'
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
