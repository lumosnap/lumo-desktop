<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Images, CalendarDays, Settings2, WifiOff, X } from 'lucide-vue-next'
import PrintStack from '../components/PrintStack.vue'
import { useNetworkStore } from '../stores/network'
import { useProfileStore } from '../stores/profile'
import { useAuthStore } from '../stores/auth'
import { useAlbumStore } from '../stores/album'

const BANNER_DISMISSED_KEY = 'lumosnap:lowStorageBannerDismissed'
const BANNER_DISMISSED_SPACE_KEY = 'lumosnap:lowStorageBannerDismissedAtSpace'

const route = useRoute()
const networkStore = useNetworkStore()
const profileStore = useProfileStore()
const authStore = useAuthStore()
const albumStore = useAlbumStore()

const lowStorage = ref<string | null>(null)
const upcoming = ref<number | null>(null)

const nf = (n: number): string => n.toLocaleString('en-IN')
const section = computed(() =>
  route.path.startsWith('/bookings')
    ? 'bookings'
    : route.path.startsWith('/settings')
      ? 'settings'
      : 'albums'
)
const biz = computed(
  () => profileStore.profile?.businessName || authStore.user?.name || authStore.user?.email || ''
)
const used = computed(() => profileStore.profile?.totalImages ?? 0)
const limit = computed(() => profileStore.profile?.imageLimit || 0)

async function checkStorageStatus(): Promise<void> {
  try {
    const info = await window.api.config.getCurrentStorageInfo()
    if (!info.success || !info.isLowStorage) {
      localStorage.removeItem(BANNER_DISMISSED_KEY)
      localStorage.removeItem(BANNER_DISMISSED_SPACE_KEY)
      lowStorage.value = null
      return
    }
    const dismissedSpace = localStorage.getItem(BANNER_DISMISSED_SPACE_KEY)
    // Show again if space dropped by more than 1 GB since the last dismissal
    const stillDismissed =
      localStorage.getItem(BANNER_DISMISSED_KEY) &&
      dismissedSpace &&
      info.freeSpace >= parseInt(dismissedSpace, 10) - 1024 * 1024 * 1024
    lowStorage.value = stillDismissed ? null : info.freeSpaceFormatted
  } catch {
    lowStorage.value = null
  }
}

function dismissBanner(): void {
  lowStorage.value = null
  localStorage.setItem(BANNER_DISMISSED_KEY, Date.now().toString())
  window.api.config.getCurrentStorageInfo().then((info) => {
    if (info.success) localStorage.setItem(BANNER_DISMISSED_SPACE_KEY, info.freeSpace.toString())
  })
}

async function countUpcoming(): Promise<void> {
  const res = await window.api.profile.getBookings()
  if (!res.success || !res.data) return
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  upcoming.value = res.data.filter((b) => new Date(b.eventDate) >= today).length
}

onMounted(() => {
  checkStorageStatus()
  profileStore.fetchProfile()
  if (albumStore.status !== 'ready') albumStore.load()
  countUpcoming().catch((e) => console.error('Failed to count bookings:', e))
})
</script>

<template>
  <div class="app">
    <aside class="side">
      <div class="mark"><img src="../assets/logo.png" alt="" />LumoSnap</div>
      <nav class="nav" aria-label="Main">
        <router-link to="/albums" :aria-current="section === 'albums' ? 'page' : undefined">
          <Images />Albums
          <span v-if="albumStore.status === 'ready'" class="count num">{{
            albumStore.albums.length
          }}</span>
        </router-link>
        <router-link to="/bookings" :aria-current="section === 'bookings' ? 'page' : undefined">
          <CalendarDays />Bookings
          <span v-if="upcoming !== null" class="count num">{{ upcoming }}</span>
        </router-link>
        <router-link
          to="/settings/profile"
          :aria-current="section === 'settings' ? 'page' : undefined"
        >
          <Settings2 />Settings
        </router-link>
      </nav>
      <PrintStack />
      <div class="side-foot">
        <div v-if="limit" class="usage">
          <div class="usage-row">
            <span>{{ profileStore.profile?.planName }} plan</span>
            <span class="num">{{ Math.round((used / limit) * 100) }}%</span>
          </div>
          <div
            class="bar"
            role="meter"
            :aria-valuenow="used"
            :aria-valuemax="limit"
            aria-label="Photos used"
          >
            <span :style="{ '--p': Math.min(1, used / limit) }"></span>
          </div>
          <div class="usage-row">
            <span
              ><b class="num">{{ nf(used) }}</b> of {{ nf(limit) }} photos</span
            >
          </div>
          <div style="margin-top: 8px">
            <router-link to="/settings/billing">See plans</router-link>
          </div>
        </div>
        <router-link class="who" to="/settings/profile">
          <span class="avatar brand">{{ biz[0]?.toUpperCase() }}</span>
          <span
            >{{ biz }}<small>{{ authStore.user?.email }}</small></span
          >
        </router-link>
      </div>
    </aside>
    <main id="main" class="main">
      <div v-if="!networkStore.isOnline" class="banner offline" role="status">
        <WifiOff />
        <p>
          <b>You're offline.</b> Uploads and new albums wait until you reconnect. Your photos stay
          on this computer.
        </p>
      </div>
      <div v-if="lowStorage && route.path !== '/settings/storage'" class="banner" role="status">
        <span class="dot warn"></span>
        <p>
          <b>{{ lowStorage }} left on this drive.</b> LumoSnap keeps compressed copies here until
          they upload.
        </p>
        <router-link class="btn sm ghost" to="/settings/storage">Change location</router-link>
        <button
          class="icon-btn sm plain"
          aria-label="Dismiss storage warning"
          @click="dismissBanner"
        >
          <X />
        </button>
      </div>
      <slot />
    </main>
  </div>
</template>
