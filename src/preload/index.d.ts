import { ElectronAPI } from '@electron-toolkit/preload'
import type { ApiProfile, ApiBillingAddress, ApiPlan } from '../main/api-client'

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
        getConfig: () => Promise<any>
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
        copyImages: (
          albumId: string,
          imageIds: number[]
        ) => Promise<{ success: boolean; count?: number; error?: string }>
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
      onUploadProgress: (callback: (event: any, progress: any) => void) => void
      offUploadProgress: (callback: (event: any, progress: any) => void) => void
      on: (channel: string, callback: (event: any, ...args: any[]) => void) => void
      off: (channel: string, callback: (event: any, ...args: any[]) => void) => void
    }
  }
}
