import { createAuthClient } from 'better-auth/vue'

// In renderer process, use import.meta.env for Vite environment variables
const BACKEND_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787'

export const authClient = createAuthClient({
  baseURL: `${BACKEND_BASE}/api/auth`, // Full URL required for better-auth with /auth segment
  fetchOptions: {
    credentials: 'include' // Critical for cookies!
  }
})

export const useAuth = (): typeof authClient => {
  return authClient
}

