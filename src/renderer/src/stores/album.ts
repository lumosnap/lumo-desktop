interface AlbumImage {
  id: number
  albumId: string
  originalFilename: string
  localFilePath: string
  fileSize: number
  width?: number
  height?: number
  uploadStatus: string
  serverId?: number
  isFavorite?: boolean
  favoriteData?: unknown
}

export interface Album {
  id: string
  userId: number
  title: string
  eventDate: string | null
  startTime: string | null
  endTime: string | null
  totalImages: number
  totalSize: number
  shareLinkToken: string | null
  expiresAt: string | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
  needsSync?: number // 0 or 1 (SQLite boolean) - indicates if album needs sync with source folder
  isOrphaned?: number // 0 or 1 (SQLite boolean) - indicates if source folder was deleted
  server_missing?: number // 1 = the server answered "Album not found" (e.g. its database was reset)
  albumType?: 'watch_folder' | 'standalone' // watch_folder = in master folder, standalone = custom path
  // For backward compatibility with frontend
  photoCount?: number
  coverPhoto?: string
  photos?: AlbumImage[]
  thumbnail?: string
  localFolderPath?: string
  sourceFolderPath?: string
}

import { defineStore } from 'pinia'
import { ref } from 'vue'

// Shared so the sidebar (counts, print stack) and the Albums view read one list.
export const useAlbumStore = defineStore('album', () => {
  const albums = ref<Album[]>([])
  const status = ref<'loading' | 'ready' | 'error'>('loading')

  async function load(): Promise<void> {
    try {
      const result = await window.api.albums.list()
      if (!result.success) throw new Error(result.error || 'album:list failed')
      albums.value = result.albums || []
      status.value = 'ready'
    } catch (e) {
      console.error('Failed to load albums:', e)
      status.value = 'error'
    }
  }

  return { albums, status, load }
})
