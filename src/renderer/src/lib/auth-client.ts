import { createAuthClient } from 'better-auth/vue'

export const authClient = createAuthClient({
  baseURL: 'http://localhost:8787/api/auth', // Full URL required for better-auth with /auth segment
  fetchOptions: {
    credentials: 'include' // Critical for cookies!
  }
})

export const useAuth = () => {
  return authClient
}
