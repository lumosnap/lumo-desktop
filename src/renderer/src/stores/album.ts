import { defineStore } from 'pinia'
import { ref } from 'vue'

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
  albumType?: 'watch_folder' | 'standalone' // watch_folder = in master folder, standalone = custom path
  // For backward compatibility with frontend
  photoCount?: number
  coverPhoto?: string
  photos?: AlbumImage[]
  thumbnail?: string
  localFolderPath?: string
  sourceFolderPath?: string
}

export const useAlbumStore = defineStore('album', () => {
  const albums = ref<Album[]>([])
  const currentAlbum = ref<Album | null>(null)
  const currentImages = ref<AlbumImage[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Clear error state
   */
  function clearError() {
    error.value = null
  }

  /**
   * Fetch all albums from local database via IPC
   */
  async function fetchAlbums() {
    loading.value = true
    error.value = null
    try {
      const result = await window.api.albums.list()
      if (result.success) {
        albums.value = result.albums || []
      } else {
        error.value = result.error || 'Failed to load albums'
        albums.value = []
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to load albums'
      console.error('[AlbumStore] fetchAlbums error:', message)
      error.value = message
      albums.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch a single album by ID from local database via IPC
   */
  async function fetchAlbum(albumId: string) {
    loading.value = true
    error.value = null
    try {
      const result = await window.api.albums.get(albumId)
      if (result.success) {
        currentAlbum.value = result.album
      } else {
        error.value = result.error || 'Album not found'
        currentAlbum.value = null
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to load album'
      console.error('[AlbumStore] fetchAlbum error:', message)
      error.value = message
      currentAlbum.value = null
    } finally {
      loading.value = false
    }
  }

  /**
   * Create a new album via IPC (handles both local DB and cloud API)
   */
  async function createAlbum(data: {
    title: string
    eventDate: string | null
    startTime: string | null
    endTime: string | null
    sourceFolderPath: string
  }) {
    loading.value = true
    error.value = null
    try {
      const result = await window.api.albums.create(data)
      if (result.success) {
        return result.album
      } else {
        error.value = result.error || 'Failed to create album'
        throw new Error(result.error || 'Failed to create album')
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to create album'
      console.error('[AlbumStore] createAlbum error:', message)
      error.value = message
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch images for an album via IPC (includes favorite status)
   */
  async function fetchAlbumImages(albumId: string) {
    loading.value = true
    error.value = null
    try {
      const result = await window.api.albums.getImages(albumId)
      if (result.success) {
        currentImages.value = result.images || []
        // Also update currentAlbum with photos if it exists
        if (currentAlbum.value && currentAlbum.value.id === albumId) {
          currentAlbum.value.photos = result.images || []
        }
      } else {
        error.value = result.error || 'Failed to load images'
        currentImages.value = []
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to load images'
      console.error('[AlbumStore] fetchAlbumImages error:', message)
      error.value = message
      currentImages.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Delete a single image via IPC (handles both cloud API and local DB)
   */
  async function deleteImage(albumId: string, imageId: number) {
    try {
      const result = await window.api.albums.deleteImage(albumId, imageId)
      if (result.success) {
        // Remove from currentImages
        currentImages.value = currentImages.value.filter((img) => img.id !== imageId)
        // Update album photo count
        if (currentAlbum.value) {
          currentAlbum.value.totalImages = Math.max(0, currentAlbum.value.totalImages - 1)
          if (currentAlbum.value.photos) {
            currentAlbum.value.photos = currentAlbum.value.photos.filter(
              (img) => img.id !== imageId
            )
          }
        }
        return { success: true }
      } else {
        error.value = result.error || 'Failed to delete image'
        return { success: false, error: result.error }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to delete image'
      console.error('[AlbumStore] deleteImage error:', message)
      error.value = message
      return { success: false, error: message }
    }
  }

  /**
   * Delete multiple images via IPC (handles both cloud API and local DB)
   */
  async function deleteImages(albumId: string, imageIds: number[]) {
    try {
      const result = await window.api.albums.deleteImages(albumId, imageIds)
      if (result.success) {
        // Remove from currentImages
        currentImages.value = currentImages.value.filter((img) => !imageIds.includes(img.id))
        // Update album photo count
        if (currentAlbum.value) {
          currentAlbum.value.totalImages = Math.max(
            0,
            currentAlbum.value.totalImages - imageIds.length
          )
          if (currentAlbum.value.photos) {
            currentAlbum.value.photos = currentAlbum.value.photos.filter(
              (img) => !imageIds.includes(img.id)
            )
          }
        }
        return { success: true, deletedCount: result.deletedCount }
      } else {
        error.value = result.error || 'Failed to delete images'
        return { success: false, error: result.error }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to delete images'
      console.error('[AlbumStore] deleteImages error:', message)
      error.value = message
      return { success: false, error: message }
    }
  }

  return {
    albums,
    currentAlbum,
    currentImages,
    loading,
    error,
    clearError,
    fetchAlbums,
    fetchAlbum,
    fetchAlbumImages,
    createAlbum,
    deleteImage,
    deleteImages
  }
})
