<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useNetworkStore } from './stores/network'
import AppToast from './components/ui/AppToast.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const networkStore = useNetworkStore()

// Main can't read the battery level; report it so ML work runs unplugged until it gets low
type BatteryManager = EventTarget & { level: number }
async function reportBattery(): Promise<void> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
  const battery = await nav.getBattery?.().catch(() => undefined)
  if (!battery) return
  const send = (): void => window.api.power.reportBattery(battery.level)
  send()
  battery.addEventListener('levelchange', send)
}

onMounted(async () => {
  reportBattery()
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
  <AppToast />
</template>
