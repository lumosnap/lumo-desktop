<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useNetworkStore } from './stores/network'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const networkStore = useNetworkStore()

onMounted(async () => {
  console.log('App.vue mounted successfully!')

  // Initialize network monitoring
  networkStore.setupListener()
  await networkStore.checkStatus()

  // Check and sync session - important for OAuth callbacks
  // When user returns from Google OAuth, the session cookie is set
  // We need to sync it to the main process for API calls
  try {
    await authStore.checkSession()

    // If user is authenticated but on a guest-only page (login/signup),
    // redirect to albums. This handles OAuth callback redirects.
    const guestOnlyRoutes = ['/login', '/signup']
    if (authStore.isAuthenticated && guestOnlyRoutes.includes(route.path)) {
      console.log('[App] User authenticated, redirecting from guest page to /albums')
      router.replace('/albums')
    }
  } catch (e) {
    console.error('Failed to check session on mount:', e)
  }
})
</script>

<template>
  <router-view />
</template>
