import { ElectronAPI } from '@electron-toolkit/preload'

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
        logout: () => Promise<{ success: boolean }>
      }
      config: {
        isConfigured: () => Promise<boolean>
        getStorageLocation: () => Promise<string | null>
        setStorageLocation: (path: string) => Promise<{ success: boolean; error?: string }>
        getFreeSpace: (
          path: string
        ) => Promise<{ bytes: number; formatted: string; error?: string }>
        getConfig: () => Promise<any>
        getCurrentStorageInfo: () => Promise<{
          success: boolean
          path: string | null
          freeSpace: number
          freeSpaceFormatted: string
          isLowStorage: boolean
          error?: string
        }>
      }
      albums: {
        create: (data: {
          title: string
          eventDate: string | null
          sourceFolderPath: string
        }) => Promise<any>
        list: () => Promise<any>
        get: (albumId: string) => Promise<any>
        delete: (albumId: string) => Promise<any>
        getImages: (albumId: string) => Promise<any>
        deleteImage: (albumId: string, imageId: number) => Promise<{ success: boolean; error?: string }>
        deleteImages: (albumId: string, imageIds: number[]) => Promise<{ success: boolean; deletedCount?: number; error?: string }>
        scanSourceFolder: (path: string) => Promise<any>
        startUpload: (albumId: string) => Promise<any>
        getProgress: (albumId: string) => Promise<any>
        retryFailed: (albumId: string) => Promise<any>
      }
      sync: {
        detectChanges: (albumId: string) => Promise<any>
        execute: (albumId: string, changes: any) => Promise<any>
      }
      dialog: {
        openDirectory: () => Promise<string | null>
      }
      api: {
        generateShareLink: (albumId: string) => Promise<any>
        getFavorites: (albumId: string) => Promise<any>
      }
      profile: {
        get: () => Promise<{
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
        }>
        update: (data: { businessName?: string; phone?: string }) => Promise<{
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
        }>
        getBillingAddresses: () => Promise<{
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
        }>
      }
      shell: {
        showItemInFolder: (
          albumId: string,
          imageId: number
        ) => Promise<{ success: boolean; error?: string }>
      }
      onUploadProgress: (callback: (event: any, progress: any) => void) => void
      offUploadProgress: (callback: (event: any, progress: any) => void) => void
      on: (channel: string, callback: (event: any, ...args: any[]) => void) => void
      off: (channel: string, callback: (event: any, ...args: any[]) => void) => void
    }
  }
}
