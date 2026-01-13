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
        getMasterFolder: () => Promise<string | null>
        setMasterFolder: (path: string) => Promise<{ success: boolean; error?: string }>
        scanMasterFolder: () => Promise<{
          success: boolean
          folders: Array<{ name: string; path: string; imageCount: number }>
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
        deleteImage: (
          albumId: string,
          imageId: number
        ) => Promise<{ success: boolean; error?: string }>
        deleteImages: (
          albumId: string,
          imageIds: number[]
        ) => Promise<{ success: boolean; deletedCount?: number; error?: string }>
        scanSourceFolder: (path: string) => Promise<any>
        startUpload: (albumId: string) => Promise<any>
        getProgress: (albumId: string) => Promise<any>
        retryFailed: (albumId: string) => Promise<any>
        forceRefresh: () => Promise<{ success: boolean; error?: string }>
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
        getFavorites: (albumId: string, clientName?: string) => Promise<any>
      }
      plans: {
        list: () => Promise<{
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
        }>
        requestUpgrade: (planId: number) => Promise<{
          success: boolean
          error?: string
        }>
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
        }>
        update: (data: { businessName?: string; phone?: string }) => Promise<{
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
        }>
        getBookingUrl: () => Promise<{
          success: boolean
          bookingUrl?: string
          error?: string
        }>
        getBookings: () => Promise<{
          success: boolean
          data?: Array<{
            id: number
            photographerId: string
            eventType: string
            name: string
            phone: string
            eventDate: string
            location: string
            details: string
            createdAt: string
            updatedAt: string
          }>
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
      onUploadProgress: (callback: (event: any, progress: any) => void) => void
      offUploadProgress: (callback: (event: any, progress: any) => void) => void
      on: (channel: string, callback: (event: any, ...args: any[]) => void) => void
      off: (channel: string, callback: (event: any, ...args: any[]) => void) => void
    }
  }
}
