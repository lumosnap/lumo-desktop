/**
 * Secure Auth Storage using Electron's safeStorage
 *
 * Stores authentication token encrypted at rest using OS-level encryption.
 * Implements in-memory caching to minimize disk I/O.
 */

import { safeStorage, app } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface StoredUser {
  id: string
  email: string
  name: string
  image?: string
}

interface AuthData {
  token: string
  user: StoredUser
}

// In-memory cache to avoid reading from disk on every request
let cachedAuth: AuthData | null = null
let isCacheInitialized = false

// Get auth file path in user data directory
function getAuthFilePath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'auth.encrypted')
}

/**
 * Save authentication data (token + user info)
 */
export function saveAuth(token: string, user: StoredUser): void {
  const authData: AuthData = { token, user }
  const jsonData = JSON.stringify(authData)

  // Update cache
  cachedAuth = authData
  isCacheInitialized = true

  // Encrypt the data
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[AuthStorage] Encryption not available, storing in plain text')
    const filePath = getAuthFilePath()
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, jsonData, 'utf-8')
    return
  }

  const encrypted = safeStorage.encryptString(jsonData)
  const filePath = getAuthFilePath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, encrypted)
  console.log('[AuthStorage] Auth data saved securely')
}

/**
 * Get stored authentication data
 */
export function getAuth(): AuthData | null {
  // Return cached data if available
  if (isCacheInitialized) {
    return cachedAuth
  }

  const filePath = getAuthFilePath()

  if (!existsSync(filePath)) {
    console.log('[AuthStorage] No auth data found')
    isCacheInitialized = true
    cachedAuth = null
    return null
  }

  try {
    const fileContent = readFileSync(filePath)

    // Try to decrypt
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(fileContent)
      const authData = JSON.parse(decrypted) as AuthData
      console.log('[AuthStorage] Auth data loaded (encrypted)')

      // Update cache
      cachedAuth = authData
      isCacheInitialized = true

      return authData
    } else {
      // Fallback: assume it's plain text
      const authData = JSON.parse(fileContent.toString('utf-8')) as AuthData
      console.log('[AuthStorage] Auth data loaded (plain text)')

      // Update cache
      cachedAuth = authData
      isCacheInitialized = true

      return authData
    }
  } catch (error) {
    console.error('[AuthStorage] Failed to read auth data:', error)
    // Clear corrupted data
    clearAuth()
    return null
  }
}

/**
 * Get just the token
 */
export function getToken(): string | null {
  const auth = getAuth()
  return auth?.token || null
}

/**
 * Get just the user
 */
export function getUser(): StoredUser | null {
  const auth = getAuth()
  return auth?.user || null
}

/**
 * Clear stored authentication data
 */
export function clearAuth(): void {
  // Clear cache
  cachedAuth = null
  isCacheInitialized = true

  const filePath = getAuthFilePath()

  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath)
      console.log('[AuthStorage] Auth data cleared')
    } catch (error) {
      console.error('[AuthStorage] Failed to clear auth data:', error)
    }
  }
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return getAuth() !== null
}
