<script setup lang="ts">
import { nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useNetworkStore } from './stores/network'
import { useAlbumStore } from './stores/album'
import AppToast from './components/ui/AppToast.vue'
import { toast } from './composables/useToast'
import { foundNote, newlyFound } from './utils/cloud'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const networkStore = useNetworkStore()
const albumStore = useAlbumStore()

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

// The found album's row on Albums: its main button has the focus (the row, while a match runs)
async function showCloud(id: string): Promise<void> {
  if (route.path !== '/albums') await router.push('/albums')
  await nextTick()
  const row = document.querySelector<HTMLElement>(`.cloud-row[data-id="${CSS.escape(id)}"]`)
  const btn = row?.querySelector<HTMLButtonElement>('.btn.ghost')
  if (row) (btn && !btn.disabled ? btn : row).focus()
  else document.getElementById('cloud-h')?.scrollIntoView()
}
// When the same plug brought a local album back, its toast (with "Open") is not replaced
let reattachedAt = 0

// Removed on unmount, so a hot reload doesn't stack a second copy of each listener
let offIpc: Array<() => void> = []
onUnmounted(() => offIpc.forEach((off) => off()))

onMounted(async () => {
  reportBattery()
  const offExpired = window.api.auth.onExpired(() => {
    authStore.expire()
    router.replace({ path: '/login', query: { expired: '1' } })
  })
  // A drive came back, maybe under a new name or letter, and its album found its folder again.
  // Said on any screen once signed in; on the sign-in screen the list still reloads, unsaid
  const offReattached = window.api.on(
    'album:reattached',
    (_e, d: { albumId: string; title: string; volumeLabel: string | null }) => {
      albumStore.load()
      if (!authStore.isAuthenticated) return
      reattachedAt = Date.now()
      toast(
        d.volumeLabel
          ? `Found “${d.title}” on “${d.volumeLabel}”.`
          : `Found the folder for “${d.title}”.`,
        { label: 'Open', run: () => router.push(`/albums/${d.albumId}`) }
      )
    }
  )
  // A drive came or went: the account list says again which albums are on a plugged-in drive.
  // Only once the list was asked for (Albums asks first, so the first list never toasts); a
  // drive that newly has account albums is said on every screen
  const offDrives = window.api.on('drives:changed', async () => {
    if (!authStore.isAuthenticated || !networkStore.isOnline || !albumStore.cloud) return
    // After a failed ask the list is empty, not "nothing found": no "new" to compare with
    const before = albumStore.cloudFailed ? null : albumStore.cloudShown
    // A failed ask keeps the list it had
    if (!(await albumStore.loadCloud({ keep: true })) || !before) return
    if (!authStore.isAuthenticated || Date.now() - reattachedAt < 5000) return
    const now = newlyFound(before, albumStore.cloudShown)
    if (now.length) toast(foundNote(now), { label: 'Show', run: () => showCloud(now[0].id) })
  })
  offIpc = [offExpired, offReattached, offDrives]
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
