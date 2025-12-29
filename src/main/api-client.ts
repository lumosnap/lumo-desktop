/**
 * API Client for LumoSnap Desktop
 *
 * Handles all communication with the LumoSnap API server.
 * Uses Bearer token authentication stored in auth-storage.
 */

import { net } from 'electron'
import { readFileSync } from 'fs'
import { getToken } from './auth-storage'

// Get API URL from environment (set in electron.vite.config.ts)
const API_URL = process.env.API_URL || 'http://localhost:8787/api/v1'
const APP_DOMAIN = process.env.APP_DOMAIN || 'https://lumosnap.app'

console.log('[API] Initialized with URL:', API_URL)
console.log('[API] App domain:', APP_DOMAIN)

// Generic fetch wrapper
async function apiFetch<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: object
    headers?: Record<string, string>
  } = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`
  console.log(`[API] ${options.method || 'GET'} ${url}`)

  return new Promise((resolve, reject) => {
    const request = net.request({
      method: options.method || 'GET',
      url
    })

    // Set headers
    request.setHeader('Content-Type', 'application/json')

    // Use Bearer token authentication
    const token = getToken()
    if (token) {
      request.setHeader('Authorization', `Bearer ${token}`)
    }

    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        request.setHeader(key, value)
      })
    }

    let responseData = ''

    request.on('response', (response) => {
      console.log(`[API] Response status: ${response.statusCode}`)

      response.on('data', (chunk) => {
        responseData += chunk.toString()
      })

      response.on('end', () => {
        try {
          const parsed = JSON.parse(responseData)
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(parsed as T)
          } else {
            console.error('[API] Error response:', parsed)
            reject(new Error(parsed.message || 'API request failed'))
          }
        } catch (error) {
          console.error('[API] Failed to parse response:', responseData)
          reject(new Error('Failed to parse API response'))
        }
      })
    })

    request.on('error', (error) => {
      console.error('[API] Request error:', error)
      reject(error)
    })

    // Send body if present
    if (options.body) {
      request.write(JSON.stringify(options.body))
    }

    request.end()
  })
}

// ==================== Types ====================

export interface ApiAlbum {
  id: string
  userId: number | null
  title: string
  eventDate: string | null
  totalImages: number
  totalSize: number | null
  shareLinkToken: string | null
  expiresAt: string | null
  isPublic: boolean | null
  createdAt: string
  updatedAt: string
  preview_link: string | null
}

export interface ApiUploadUrl {
  filename: string
  uploadUrl: string
  key: string
}

export interface ApiImage {
  id: number
  albumId: string
  b2FileId: string
  b2FileName: string
  originalFilename: string
  fileSize: number
  width: number
  height: number
  uploadOrder: number
  uploadStatus: 'pending' | 'uploading' | 'complete' | 'failed'
  thumbnailB2FileId?: string
  thumbnailB2FileName?: string
  createdAt: string
  url: string | null
  thumbnailUrl: string | null
}

export interface ApiFavorite {
  id: number
  albumId: string
  imageId: number
  clientName: string
  notes: string | null
  createdAt: string
  image?: ApiImage
}

// New favorites response format (for admin view)
export interface ApiFavoriteImage {
  id: number
  originalFilename: string
  width: number
  height: number
  createdAt: string
  url: string
  thumbnailUrl: string
  favoriteCount: number
  notesCount: number
  comments: Array<{
    clientName: string
    notes: string | null
    createdAt: string
  }>
}

export interface ApiResponse<T> {
  success: boolean
  message: string
  data?: T
}

// ==================== Profile Types ====================

export interface ApiProfile {
  id: number
  userId: string | null
  businessName: string | null
  phone: string | null
  storageUsed: number | null
  createdAt: string
  updatedAt: string
}

export interface ApiBillingAddress {
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

// ==================== Profile API ====================

export const profileApi = {
  /**
   * Get user profile
   */
  async get(): Promise<ApiProfile> {
    console.log('[API] Getting user profile')
    const response = await apiFetch<ApiResponse<ApiProfile>>('/profile')
    if (!response.data) {
      throw new Error('No data in response')
    }
    return response.data
  },

  /**
   * Update user profile
   */
  async update(data: { businessName?: string; phone?: string }): Promise<ApiProfile> {
    console.log('[API] Updating user profile:', data)
    const response = await apiFetch<ApiResponse<ApiProfile>>('/profile', {
      method: 'PUT',
      body: data
    })
    if (!response.data) {
      throw new Error('No data in response')
    }
    return response.data
  },

  /**
   * Get billing addresses
   */
  async getBillingAddresses(): Promise<ApiBillingAddress[]> {
    console.log('[API] Getting billing addresses')
    const response = await apiFetch<ApiResponse<ApiBillingAddress[]>>('/profile/billing-addresses')
    return response.data || []
  },

  /**
   * Create billing address
   */
  async createBillingAddress(data: {
    street: string
    city: string
    state: string
    zip: string
    country: string
    isDefault?: boolean
  }): Promise<ApiBillingAddress> {
    console.log('[API] Creating billing address:', data)
    const response = await apiFetch<ApiResponse<ApiBillingAddress>>('/profile/billing-addresses', {
      method: 'POST',
      body: data
    })
    if (!response.data) {
      throw new Error('No data in response')
    }
    return response.data
  },

  /**
   * Update billing address
   */
  async updateBillingAddress(
    addressId: number,
    data: {
      street?: string
      city?: string
      state?: string
      zip?: string
      country?: string
      isDefault?: boolean
    }
  ): Promise<ApiBillingAddress> {
    console.log(`[API] Updating billing address ${addressId}:`, data)
    const response = await apiFetch<ApiResponse<ApiBillingAddress>>(
      `/profile/billing-addresses/${addressId}`,
      {
        method: 'PUT',
        body: data
      }
    )
    if (!response.data) {
      throw new Error('No data in response')
    }
    return response.data
  }
}

// ==================== Album API ====================

export const albumsApi = {
  /**
   * Create a new album on the server
   */
  async create(data: { title: string; eventDate?: string | null }): Promise<ApiAlbum> {
    console.log('[API] Creating album:', data)
    const response = await apiFetch<ApiResponse<ApiAlbum>>('/albums', {
      method: 'POST',
      body: data
    })
    if (!response.data) {
      throw new Error('No data in response')
    }
    console.log('[API] Album created:', response.data.id)
    return response.data
  },

  /**
   * Delete an album
   */
  async delete(albumId: string): Promise<void> {
    console.log(`[API] Deleting album ${albumId}`)
    await apiFetch<ApiResponse<void>>(`/albums/${albumId}`, {
      method: 'DELETE'
    })
    console.log('[API] Album deleted')
  },

  /**
   * Get presigned upload URLs for a batch of files
   */
  async getUploadUrls(
    albumId: string,
    files: Array<{ filename: string }>
  ): Promise<ApiUploadUrl[]> {
    console.log(`[API] Getting upload URLs for ${files.length} files in album ${albumId}`)
    const response = await apiFetch<ApiResponse<ApiUploadUrl[]>>(`/albums/${albumId}/upload`, {
      method: 'POST',
      body: { files }
    })
    console.log(`[API] Received ${response.data?.length || 0} upload URLs`)
    return response.data || []
  },

  /**
   * Confirm upload completion for a batch of images
   */
  async confirmUpload(
    albumId: string,
    images: Array<{
      filename: string
      b2FileId: string
      fileSize: number
      width: number
      height: number
      uploadOrder: number
      thumbnailB2FileId?: string
      thumbnailB2FileName?: string
    }>
  ): Promise<Array<{ id: number; originalFilename: string; b2FileName: string }>> {
    console.log(`[API] Confirming upload of ${images.length} images in album ${albumId}`)
    const response = await apiFetch<
      ApiResponse<Array<{ id: number; originalFilename: string; b2FileName: string }>>
    >(`/albums/${albumId}/confirm-upload`, {
      method: 'POST',
      body: { images }
    })
    console.log('[API] Upload confirmed')
    return response.data || []
  },

  /**
   * Delete images from an album
   */
  async deleteImages(
    albumId: string,
    imageIds: number[]
  ): Promise<{ deletedCount: number; failedCount: number }> {
    console.log(`[API] Deleting ${imageIds.length} images from album ${albumId}`)
    const response = await apiFetch<ApiResponse<{ deletedCount: number; failedCount: number }>>(
      `/albums/${albumId}/images`,
      {
        method: 'DELETE',
        body: { imageIds }
      }
    )
    console.log('[API] Deletion result:', response.data)
    return response.data || { deletedCount: 0, failedCount: 0 }
  },

  /**
   * Get favorites for an album (new format with enriched image data)
   */
  async getFavorites(albumId: string, clientName?: string): Promise<ApiFavoriteImage[]> {
    console.log(`[API] Getting favorites for album ${albumId}`)
    const endpoint = clientName
      ? `/albums/${albumId}/favorites?clientName=${encodeURIComponent(clientName)}`
      : `/albums/${albumId}/favorites`
    const response = await apiFetch<ApiResponse<ApiFavoriteImage[]>>(endpoint)
    console.log(`[API] Received ${response.data?.length || 0} favorites`)
    return response.data || []
  },

  /**
   * Create or get share link for an album
   */
  async createShareLink(albumId: string): Promise<{ shareLink: string; shareLinkToken: string }> {
    console.log(`[API] Creating share link for album ${albumId}`)
    const response = await apiFetch<ApiResponse<{ shareLink: string; shareLinkToken: string }>>(
      `/albums/${albumId}/share-link`,
      {
        method: 'POST'
      }
    )
    console.log('[API] Share link response:', response)
    if (!response.data) {
      throw new Error('No data in response')
    }
    return response.data
  }
}

// ==================== Upload Helpers ====================

/**
 * Upload a file to a presigned URL (B2 storage)
 * Uses Node's https module instead of Electron's net for S3 compatibility
 */
export async function uploadToPresignedUrl(
  presignedUrl: string,
  filePath: string
): Promise<{ success: boolean; b2FileId?: string; error?: string }> {
  console.log(`[API] Uploading file to presigned URL: ${filePath}`)

  // Use dynamic import for https to avoid issues with Electron
  const https = await import('https')
  const http = await import('http')
  const { URL } = await import('url')

  return new Promise((resolve) => {
    try {
      const fileBuffer = readFileSync(filePath)
      console.log(`[API] File size: ${fileBuffer.length} bytes`)

      const urlObj = new URL(presignedUrl)
      const isHttps = urlObj.protocol === 'https:'
      const httpModule = isHttps ? https : http

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': fileBuffer.length
        }
      }

      console.log(`[API] Uploading to ${urlObj.hostname}${urlObj.pathname}`)

      const req = httpModule.request(options, (res) => {
        console.log(`[API] Upload response status: ${res.statusCode}`)

        let responseData = ''
        res.on('data', (chunk) => {
          responseData += chunk.toString()
        })

        res.on('end', () => {
          // Get b2FileId from response headers (Backblaze returns it as x-bz-file-id)
          const b2FileId = res.headers['x-bz-file-id'] as string | undefined

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[API] Upload successful, b2FileId:', b2FileId)
            // For S3-compatible uploads, we may need to extract ETag as file ID
            const etag = res.headers['etag'] as string | undefined
            resolve({ success: true, b2FileId: b2FileId || etag?.replace(/"/g, '') })
          } else {
            console.error('[API] Upload failed:', res.statusCode, responseData)
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${responseData}` })
          }
        })
      })

      req.on('error', (error) => {
        console.error('[API] Upload error:', error)
        resolve({ success: false, error: error.message })
      })

      req.write(fileBuffer)
      req.end()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[API] File read error:', message)
      resolve({ success: false, error: message })
    }
  })
}

// ==================== Share Link Helpers ====================

/**
 * Generate a share URL for an album
 */
export function getShareUrl(albumId: string): string {
  return `${APP_DOMAIN}/share/${albumId}`
}
