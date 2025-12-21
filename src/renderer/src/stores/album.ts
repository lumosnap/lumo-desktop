import { defineStore } from 'pinia'
import api from '../utils/api'
import { ref } from 'vue'

interface AlbumImage {
  id: string
  albumId: string
  filename: string
  originalFilename: string
  mimeType: string
  size: number
  width?: number
  height?: number
  url: string
  thumbnailUrl?: string
  uploadedAt: string
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
  // For backward compatibility with frontend
  photoCount?: number
  coverPhoto?: string
  photos?: AlbumImage[]
}

export const useAlbumStore = defineStore('album', () => {
  const albums = ref<Album[]>([])
  const currentAlbum = ref<Album | null>(null)
  const currentImages = ref<AlbumImage[]>([])
  const loading = ref(false)

  async function fetchAlbums() {
    const response = await api.get('/v1/albums')
    albums.value = response.data.data || []
  }

  async function fetchAlbum(albumId: string) {
    const response = await api.get(`/v1/albums/${albumId}`)
    currentAlbum.value = response.data
  }

  async function createAlbum(data: any) {
    const response = await api.post('/v1/albums', data)
    return response.data
  }

  async function getUploadUrls(albumId: string, files: any[]) {
    const response = await api.post(`/v1/albums/${albumId}/upload`, { files })
    return response.data
  }

  async function confirmUpload(albumId: string, images: any[]) {
    await api.post(`/v1/albums/${albumId}/confirm-upload`, { images })
  }

  async function fetchAlbumImages(albumId: string) {
    loading.value = true
    try {
      const response = await api.get(`/v1/albums/${albumId}/images`)
      const data = response.data.data

      // Set currentAlbum with album metadata from the response
      currentAlbum.value = data
      if (currentAlbum.value) {
        currentAlbum.value.photos = data.images || []
      }

      // Set currentImages
      currentImages.value = data.images || []
    } catch (error) {
      console.error('Failed to fetch album images:', error)
      currentImages.value = []
    } finally {
      loading.value = false
    }
  }

  async function deleteImage(albumId: string, imageId: string) {
    const response = await api.delete(`/v1/albums/${albumId}/images/${imageId}`)
    // Remove from currentImages
    currentImages.value = currentImages.value.filter((img) => img.id !== imageId)
    // Update album photo count
    if (currentAlbum.value) {
      currentAlbum.value.totalImages = Math.max(0, currentAlbum.value.totalImages - 1)
      if (currentAlbum.value.photos) {
        currentAlbum.value.photos = currentAlbum.value.photos.filter((img) => img.id !== imageId)
      }
    }
    return response.data
  }

  async function deleteImages(albumId: string, imageIds: string[]) {
    const response = await api.delete(`/v1/albums/${albumId}/images`, { data: { imageIds } })
    // Remove from currentImages
    currentImages.value = currentImages.value.filter((img) => !imageIds.includes(img.id))
    // Update album photo count
    if (currentAlbum.value) {
      currentAlbum.value.totalImages = Math.max(0, currentAlbum.value.totalImages - imageIds.length)
      if (currentAlbum.value.photos) {
        currentAlbum.value.photos = currentAlbum.value.photos.filter(
          (img) => !imageIds.includes(img.id)
        )
      }
    }
    return response.data
  }

  return {
    albums,
    currentAlbum,
    currentImages,
    loading,
    fetchAlbums,
    fetchAlbum,
    fetchAlbumImages,
    createAlbum,
    getUploadUrls,
    confirmUpload,
    deleteImage,
    deleteImages
  }
})
