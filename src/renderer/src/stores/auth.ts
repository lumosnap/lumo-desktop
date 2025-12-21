import { defineStore } from 'pinia'
import { ref } from 'vue'

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

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const isAuthenticated = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Check if user is logged in from localStorage
  function checkSession(): void {
    const storedUser = localStorage.getItem('lumo_user')
    const storedToken = localStorage.getItem('lumo_token')

    if (storedUser && storedToken) {
      try {
        user.value = JSON.parse(storedUser)
        isAuthenticated.value = true
      } catch (e) {
        console.error('Failed to parse stored user', e)
        logout()
      }
    }
  }

  async function login(credentials: LoginCredentials): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // For demo purposes, accept any email/password
      // In production, this would be an actual API call
      const mockUser: User = {
        id: '1',
        email: credentials.email,
        name: credentials.email.split('@')[0],
        image: undefined
      }

      // Store in localStorage
      localStorage.setItem('lumo_user', JSON.stringify(mockUser))
      localStorage.setItem('lumo_token', 'mock-token-' + Date.now())

      user.value = mockUser
      isAuthenticated.value = true
    } catch (e) {
      error.value = 'Login failed. Please try again.'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function signup(credentials: SignupCredentials): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // For demo purposes, create a mock user
      const mockUser: User = {
        id: '1',
        email: credentials.email,
        name: credentials.name,
        image: undefined
      }

      // Store in localStorage
      localStorage.setItem('lumo_user', JSON.stringify(mockUser))
      localStorage.setItem('lumo_token', 'mock-token-' + Date.now())

      user.value = mockUser
      isAuthenticated.value = true
    } catch (e) {
      error.value = 'Signup failed. Please try again.'
      throw e
    } finally {
      loading.value = false
    }
  }

  function logout(): void {
    user.value = null
    isAuthenticated.value = false
    localStorage.removeItem('lumo_user')
    localStorage.removeItem('lumo_token')
  }

  return {
    user,
    isAuthenticated,
    loading,
    error,
    login,
    signup,
    logout,
    checkSession
  }
})
