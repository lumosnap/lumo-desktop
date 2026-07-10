import { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcRendererEvent } from 'electron'
import type {
  ApiProfile,
  ApiBillingAddress,
  ApiPlan,
  ApiFavoriteImage,
  Booking
} from '../main/api-client'
import type { Album, Image } from '../main/database'
import type { AppConfig } from '../main/config'
import type { SyncResult, ExecuteSyncResult, SyncChanges } from '../main/ipc/sync'
import type { FileStats } from '../main/storage'
import type { UploadProgress } from '../main/pipeline'

type AuthUser = { id: string; email: string; name: string; image?: string }

type AlbumImageWithFavorites = Image & {
  isFavorite: boolean
  favoriteCount: number
  notesCount: number
  comments: Array<{ clientName: string; notes: string | null; createdAt: string }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      auth: {
        getStoredAuth: () => Promise<{
          success: boolean
          token: string | null
          user: { id: string; email: string; name: string; image?: string } | null
        }>
        startAuth: () => Promise<{
          success: boolean
          user?: { id: string; email: string; name: string; image?: string }
          error?: string
        }>
        requestDeviceCode: () => Promise<{
          success: boolean
          device_code?: string
          user_code?: string
          verification_uri?: string
          verification_uri_complete?: string
          expires_in?: number
          interval?: number
          error?: string
        }>
        pollDeviceToken: (deviceCode: string) => Promise<{
          success: boolean
          pending?: boolean
          error?: string
          error_description?: string
          interval?: number
          user?: { id: string; email: string; name: string; image?: string }
        }>
        logout: () => Promise<{ success: boolean }>
      }
      config: {
        isConfigured: () => Promise<boolean>
        getStorageLocation: () => Promise<string | null>
        setStorageLocation: (path: string) => Promise<{ success: boolean; error?: string }>
        getFreeSpace: (
          path: string
        ) => Promise<{ bytes: number; formatted: string; error?: string }>
        getConfig: () => Promise<AppConfig>
        getAppVersion: () => Promise<string>
        getCurrentStorageInfo: () => Promise<{
          success: boolean
          path: string | null
          freeSpace: number
          freeSpaceFormatted: string
          isLowStorage: boolean
          error?: string
        }>
        resetAllData: () => Promise<{ success: boolean; error?: string }>
      }
      albums: {
        create: (data: {
          title: string
          eventDate: string | null
          sourceFolderPath: string
          albumType?: 'watch_folder' | 'standalone'
        }) => Promise<{ success: true; album: Album } | { success: false; error: string }>
        list: () => Promise<any>
        get: (
          albumId: string
        ) => Promise<{ success: true; album: Album } | { success: false; error: string }>
        delete: (albumId: string) => Promise<{ success: boolean; error?: string }>
        getImages: (
          albumId: string
        ) => Promise<{ success: boolean; images: AlbumImageWithFavorites[]; error?: string }>
        deleteImage: (
          albumId: string,
          imageId: number
        ) => Promise<{ success: boolean; error?: string }>
        deleteImages: (
          albumId: string,
          imageIds: number[]
        ) => Promise<{ success: boolean; deletedCount?: number; error?: string }>
        copyImages: (
          albumId: string,
          imageIds: number[]
        ) => Promise<{ success: boolean; count?: number; errorCount?: number; error?: string }>
        scanSourceFolder: (
          path: string
        ) => Promise<{ success: boolean; count: number; images: FileStats[]; error?: string }>
        startUpload: (albumId: string) => Promise<{ success: boolean; error?: string }>
        getProgress: (
          albumId: string
        ) => Promise<{ success: boolean; progress?: UploadProgress; error?: string }>
        retryFailed: (albumId: string) => Promise<{ success: boolean; error?: string }>
        forceRefresh: () => Promise<{ success: boolean; error?: string }>
      }
      sync: {
        detectChanges: (albumId: string) => Promise<SyncResult>
        execute: (albumId: string, changes: Partial<SyncChanges>) => Promise<ExecuteSyncResult>
      }
      dialog: {
        openDirectory: () => Promise<string | null>
      }
      api: {
        generateShareLink: (albumId: string) => Promise<{
          success: boolean
          shareLink?: { shareLinkToken: string | null; shareUrl: string; expiresAt: null }
          error?: string
        }>
        getFavorites: (
          albumId: string,
          clientName?: string
        ) => Promise<{
          success: boolean
          favorites: ApiFavoriteImage[]
          clientNames: string[]
          error?: string
        }>
      }
      plans: {
        list: () => Promise<{
          success: boolean
          data?: Array<ApiPlan>
          error?: string
        }>
        requestUpgrade: (planId: number) => Promise<{
          success: boolean
          error?: string
        }>
      }
      profile: {
        get: () => Promise<{
          success: boolean
          data?: ApiProfile
          error?: string
        }>
        update: (data: { businessName?: string; phone?: string }) => Promise<{
          success: boolean
          data?: ApiProfile
          error?: string
        }>
        getBookingUrl: () => Promise<{
          success: boolean
          bookingUrl?: string
          error?: string
        }>
        getBookings: () => Promise<{
          success: boolean
          data?: Booking[]
          error?: string
        }>
        getBillingAddresses: () => Promise<{
          success: boolean
          data?: Array<ApiBillingAddress>
          error?: string
        }>
        createBillingAddress: (data: {
          street: string
          city: string
          state: string
          zip: string
          country: string
          isDefault?: boolean
        }) => Promise<{
          success: boolean
          data?: ApiBillingAddress
          error?: string
        }>
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
        ) => Promise<{
          success: boolean
          data?: ApiBillingAddress
          error?: string
        }>
      }
      shell: {
        showItemInFolder: (
          albumId: string,
          imageId: number
        ) => Promise<{ success: boolean; error?: string }>
        openFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>
      }
      settings: {
        getAutoStart: () => Promise<{
          success: boolean
          enabled: boolean
          openAsHidden: boolean
          error?: string
        }>
        setAutoStart: (enabled: boolean) => Promise<{
          success: boolean
          enabled?: boolean
          error?: string
        }>
        getMinimizeToTray: () => Promise<{
          success: boolean
          enabled: boolean
          error?: string
        }>
        setMinimizeToTray: (enabled: boolean) => Promise<{
          success: boolean
          enabled?: boolean
          error?: string
        }>
        getAll: () => Promise<{
          success: boolean
          settings?: {
            autoStart: boolean
            autoStartHidden: boolean
            minimizeToTray: boolean
          }
          error?: string
        }>
      }
      network: {
        getStatus: () => Promise<{ online: boolean }>
        checkConnectivity: () => Promise<{ online: boolean }>
        onStatusChange: (callback: (online: boolean) => void) => () => void
      }
      onUploadProgress: (
        callback: (event: IpcRendererEvent, progress: UploadProgress) => void
      ) => void
      offUploadProgress: (
        callback: (event: IpcRendererEvent, progress: UploadProgress) => void
      ) => void
      on: <A extends unknown[]>(
        channel: string,
        callback: (event: IpcRendererEvent, ...args: A) => void
      ) => void
      off: <A extends unknown[]>(
        channel: string,
        callback: (event: IpcRendererEvent, ...args: A) => void
      ) => void
    }
  }
}
