import { defineStore } from 'pinia'
import { ref } from 'vue'

interface User {
  id: string
  email: string
  name: string
  image?: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const isAuthenticated = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Check if user has stored auth on app startup
   */
  async function checkSession(): Promise<void> {
    try {
      const result = await window.api.auth.getStoredAuth()

      if (result.success && result.user) {
        user.value = {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name || result.user.email.split('@')[0],
          image: result.user.image || undefined
        }
        isAuthenticated.value = true
        console.log('[Auth] Session restored from storage')
      } else {
        user.value = null
        isAuthenticated.value = false
        console.log('[Auth] No stored session found')
      }
    } catch (e) {
      console.error('[Auth] Failed to check session:', e)
      user.value = null
      isAuthenticated.value = false
    }
  }

  /**
   * Start the auth flow - opens browser to auth page
   */
  async function startAuth(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const result = await window.api.auth.startAuth()

      if (!result.success) {
        throw new Error(result.error || 'Authentication failed')
      }

      if (result.user) {
        user.value = {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name || result.user.email.split('@')[0],
          image: result.user.image || undefined
        }
        isAuthenticated.value = true
        console.log('[Auth] Authentication successful')
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Authentication failed. Please try again.'
      error.value = message
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Logout - clears stored auth
   */
  async function logout(): Promise<void> {
    try {
      await window.api.auth.logout()
    } catch (e) {
      console.error('[Auth] Error during logout:', e)
    }

    user.value = null
    isAuthenticated.value = false
    console.log('[Auth] Logged out')
  }

  return {
    user,
    isAuthenticated,
    loading,
    error,
    startAuth,
    logout,
    checkSession
  }
})
