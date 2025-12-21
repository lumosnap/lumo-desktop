import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      config: {
        isConfigured: () => Promise<boolean>
        getStorageLocation: () => Promise<string | null>
        setStorageLocation: (path: string) => Promise<{ success: boolean; error?: string }>
        getFreeSpace: (
          path: string
        ) => Promise<{ bytes: number; formatted: string; error?: string }>
        getConfig: () => Promise<any>
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
      onUploadProgress: (callback: (event: any, progress: any) => void) => void
      offUploadProgress: (callback: (event: any, progress: any) => void) => void
      on: (channel: string, callback: (event: any, ...args: any[]) => void) => void
      off: (channel: string, callback: (event: any, ...args: any[]) => void) => void
    }
  }
}
