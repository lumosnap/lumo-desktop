import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authClient } from '../lib/auth-client'

interface User {
  id: string
  email: string
  name: string
  image?: string
}

interface LoginCredentials {
  email: string
  password: string
}

interface SignupCredentials {
  email: string
  password: string
  name: string
}

// Helper to extract session cookie from document.cookie
function getSessionCookie(): string | null {
  const cookies = document.cookie
  if (!cookies) return null

  // better-auth typically sets a session cookie
  // Extract all relevant cookies to pass to main process
  const relevantCookies = cookies
    .split(';')
    .map((c) => c.trim())
    .filter(
      (c) =>
        c.startsWith('better-auth') ||
        c.startsWith('session') ||
        c.startsWith('__session') ||
        c.startsWith('auth')
    )
    .join('; ')

  return relevantCookies || cookies // Fall back to all cookies if no specific auth cookies found
}

// Helper to sync session to main process
async function syncSessionToMain(): Promise<void> {
  try {
    const cookie = getSessionCookie()
    if (cookie && window.api?.auth?.setSessionCookie) {
      await window.api.auth.setSessionCookie(cookie)
      console.log('[Auth] Session cookie synced to main process')
    }
  } catch (err) {
    console.error('[Auth] Failed to sync session to main:', err)
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const isAuthenticated = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Check if user is logged in using better-auth session
  async function checkSession(): Promise<void> {
    try {
      const session = await authClient.getSession()

      if (session.data?.user) {
        const sessionUser = session.data.user
        user.value = {
          id: sessionUser.id,
          email: sessionUser.email,
          name: sessionUser.name || sessionUser.email.split('@')[0],
          image: sessionUser.image || undefined
        }
        isAuthenticated.value = true

        // Sync session cookie to main process
        await syncSessionToMain()

        // Also store in localStorage for quick checks
        localStorage.setItem('lumo_user', JSON.stringify(user.value))
        localStorage.setItem('lumo_token', 'authenticated')
      } else {
        // Server says no session - clear any stale localStorage
        // Don't fall back to localStorage here, as that would show stale data
        user.value = null
        isAuthenticated.value = false
        localStorage.removeItem('lumo_user')
        localStorage.removeItem('lumo_token')
      }
    } catch (e) {
      console.error('Failed to check session:', e)
      // Only use localStorage fallback on network/server errors
      // This allows the app to work offline with cached user data
      const storedUser = localStorage.getItem('lumo_user')
      if (storedUser) {
        try {
          user.value = JSON.parse(storedUser)
          isAuthenticated.value = true
        } catch {
          logout()
        }
      }
    }
  }

  async function login(credentials: LoginCredentials): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Use better-auth signIn
      const result = await authClient.signIn.email({
        email: credentials.email,
        password: credentials.password
      })

      if (result.error) {
        throw new Error(result.error.message || 'Login failed')
      }

      if (result.data?.user) {
        const authUser = result.data.user
        user.value = {
          id: authUser.id,
          email: authUser.email,
          name: authUser.name || authUser.email.split('@')[0],
          image: authUser.image || undefined
        }
        isAuthenticated.value = true

        // Store in localStorage for UI persistence
        localStorage.setItem('lumo_user', JSON.stringify(user.value))
        localStorage.setItem('lumo_token', 'authenticated')

        // Sync session cookie to main process for API calls
        await syncSessionToMain()
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Login failed. Please try again.'
      error.value = message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function signup(credentials: SignupCredentials): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Use better-auth signUp
      const result = await authClient.signUp.email({
        email: credentials.email,
        password: credentials.password,
        name: credentials.name
      })

      if (result.error) {
        throw new Error(result.error.message || 'Signup failed')
      }

      if (result.data?.user) {
        const authUser = result.data.user
        user.value = {
          id: authUser.id,
          email: authUser.email,
          name: authUser.name || credentials.name,
          image: authUser.image || undefined
        }
        isAuthenticated.value = true

        // Store in localStorage for UI persistence
        localStorage.setItem('lumo_user', JSON.stringify(user.value))
        localStorage.setItem('lumo_token', 'authenticated')

        // Sync session cookie to main process for API calls
        await syncSessionToMain()
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Signup failed. Please try again.'
      error.value = message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function loginWithGoogle(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Use better-auth social sign-in for Google
      // For Electron with hash router, we just need origin + hash route
      // Example: http://localhost:5173/#/albums
      const callbackURL = `${window.location.origin}/#/albums`

      console.log('[Auth] Starting Google OAuth with callbackURL:', callbackURL)

      await authClient.signIn.social({
        provider: 'google',
        callbackURL
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Google login failed. Please try again.'
      error.value = message
      throw e
    } finally {
      loading.value = false
    }
  }


  async function logout(): Promise<void> {
    try {
      // Sign out from better-auth
      await authClient.signOut()
    } catch (e) {
      console.error('Error during signOut:', e)
    }

    user.value = null
    isAuthenticated.value = false
    localStorage.removeItem('lumo_user')
    localStorage.removeItem('lumo_token')

    // Clear session in main process
    if (window.api?.auth?.clearSession) {
      await window.api.auth.clearSession()
    }
  }

  return {
    user,
    isAuthenticated,
    loading,
    error,
    login,
    loginWithGoogle,
    signup,
    logout,
    checkSession
  }
})

