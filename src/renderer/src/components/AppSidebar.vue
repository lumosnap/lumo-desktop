<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Camera, ChevronLeft, ChevronRight, Images, Pencil } from 'lucide-vue-next'

import { useUIStore } from '../stores/ui'
import { useAlbumStore } from '../stores/album'
import { useAuthStore } from '../stores/auth'
import { useProfileStore } from '../stores/profile'
import { storeToRefs } from 'pinia'
import { watch, onMounted } from 'vue'

const router = useRouter()
const uiStore = useUIStore()
const albumStore = useAlbumStore()
const authStore = useAuthStore()
const profileStore = useProfileStore()
const { albums } = storeToRefs(albumStore)
const currentDate = new Date()
const currentMonth = ref(currentDate.getMonth())
const currentYear = ref(currentDate.getFullYear())

// Sync local calendar view with global selected date
watch(
  () => uiStore.selectedDate,
  (newDate) => {
    currentMonth.value = newDate.getMonth()
    currentYear.value = newDate.getFullYear()
  },
  { immediate: true }
)

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]
const weekDays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const daysInMonth = computed(() => new Date(currentYear.value, currentMonth.value + 1, 0).getDate())
const firstDayOfMonth = computed(() => {
  const day = new Date(currentYear.value, currentMonth.value, 1).getDay()
  return day === 0 ? 6 : day - 1 // Adjust to make Monday 0
})

const calendarDays = computed(() => {
  const days: { date: number; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean }[] =
    []

  // Previous month padding
  for (let i = 0; i < firstDayOfMonth.value; i++) {
    days.push({ date: 0, isCurrentMonth: false, isToday: false, isSelected: false })
  }

  // Current month
  const today = new Date()
  for (let i = 1; i <= daysInMonth.value; i++) {
    const isToday =
      i === today.getDate() &&
      currentMonth.value === today.getMonth() &&
      currentYear.value === today.getFullYear()
    days.push({
      date: i,
      isCurrentMonth: true,
      isToday,
      isSelected:
        i === uiStore.selectedDate.getDate() &&
        currentMonth.value === uiStore.selectedDate.getMonth() &&
        currentYear.value === uiStore.selectedDate.getFullYear()
    })
  }

  return days
})

const prevMonth = (): void => {
  if (currentMonth.value === 0) {
    currentMonth.value = 11
    currentYear.value--
  } else {
    currentMonth.value--
  }
}

const nextMonth = (): void => {
  if (currentMonth.value === 11) {
    currentMonth.value = 0
    currentYear.value++
  } else {
    currentMonth.value++
  }
}

// Recent Albums
const recentAlbums = computed(() => {
  return [...albums.value]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
})

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function goToAlbumDate(album: { id: string; eventDate?: string | null; createdAt: string }): void {
  const date = new Date(album.eventDate || album.createdAt)
  uiStore.setSelectedDate(date)
  uiStore.setSelectedAlbumId(album.id)
}

onMounted(() => {
  albumStore.fetchAlbums()
  profileStore.fetchProfile()
})

// Display name: business name or username + "Photography"
const displayName = computed(() => {
  // First try business name from profile store
  if (profileStore.displayName) {
    return profileStore.displayName
  }
  // Fallback to username + Photography
  const name = authStore.user?.name || 'User'
  return `${name} Photography`
})

function goToProfile(): void {
  router.push('/profile')
}
</script>

<template>
  <aside
    class="fixed left-0 top-0 z-40 flex h-screen w-[280px] flex-col overflow-hidden border-r border-white/[0.08] bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950"
  >
    <!-- Ambient glow effects -->
    <div
      class="pointer-events-none absolute -top-20 -left-20 h-40 w-40 rounded-full bg-indigo-500/10 blur-3xl"
    ></div>
    <div
      class="pointer-events-none absolute -bottom-20 -right-20 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl"
    ></div>

    <!-- Scrollable Content -->
    <div class="sidebar-scrollable relative flex-1 space-y-4 overflow-y-auto p-4">
      <!-- CARD 1: User Profile + Mini Calendar -->
      <div class="sidebar-card">
        <!-- User Profile -->
        <div class="mb-5 flex items-center gap-3">
          <div class="relative">
            <div
              class="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25"
            >
              <Camera class="h-5 w-5 text-white" />
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-white/90 truncate text-sm">{{ displayName }}</p>
            <p class="text-xs text-white/40 truncate">Pro Plan</p>
          </div>
          <button
            class="rounded-lg p-2 text-white/40 hover:bg-white/5 hover:text-indigo-400 transition-all duration-200"
            title="Edit Profile"
            @click="goToProfile"
          >
            <Pencil class="h-4 w-4" />
          </button>
        </div>

        <!-- Image Usage Progress -->
        <div v-if="profileStore.profile" class="mb-5">
          <div class="flex items-center justify-between text-xs mb-2">
            <span class="text-white/40 font-medium">Image Usage</span>
            <span class="text-white/70 font-semibold">
              {{ (profileStore.profile.totalImages || 0).toLocaleString() }} /
              {{ (profileStore.profile.globalMaxImages || 50000).toLocaleString() }}
            </span>
          </div>
          <div class="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
              :style="{
                width: `${Math.min(((profileStore.profile.totalImages || 0) / (profileStore.profile.globalMaxImages || 50000)) * 100, 100)}%`
              }"
            ></div>
          </div>
        </div>

        <!-- Divider -->
        <div class="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mb-5"></div>

        <!-- Mini Calendar -->
        <div>
          <div class="mb-4 flex items-center justify-between">
            <span class="text-sm font-semibold text-white/90"
              >{{ monthNames[currentMonth] }} {{ currentYear }}</span
            >
            <div class="flex gap-0.5">
              <button
                class="rounded-lg p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white/80 transition-all duration-200"
                @click="prevMonth"
              >
                <ChevronLeft class="h-4 w-4" />
              </button>
              <button
                class="rounded-lg p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white/80 transition-all duration-200"
                @click="nextMonth"
              >
                <ChevronRight class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div class="mb-2 grid grid-cols-7 gap-0">
            <div
              v-for="day in weekDays"
              :key="day"
              class="text-center text-[10px] font-semibold text-white/30 uppercase tracking-wider"
            >
              {{ day }}
            </div>
          </div>

          <div class="grid grid-cols-7 gap-1">
            <div
              v-for="(day, index) in calendarDays"
              :key="index"
              class="calendar-day"
              :class="{
                'calendar-day--today': day.isToday,
                'calendar-day--selected': day.isSelected && !day.isToday,
                'calendar-day--muted': !day.isCurrentMonth
              }"
              @click="
                day.isCurrentMonth
                  ? uiStore.setSelectedDate(new Date(currentYear, currentMonth, day.date))
                  : null
              "
            >
              {{ day.date || '' }}
            </div>
          </div>
        </div>
      </div>

      <!-- CARD 2: Recent Albums -->
      <div class="sidebar-card">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-white/30">
            Recent Albums
          </h3>
        </div>

        <div class="space-y-1.5">
          <div
            v-for="album in recentAlbums"
            :key="album.id"
            class="group flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-all duration-200 hover:bg-white/[0.04]"
            @click="goToAlbumDate(album)"
          >
            <!-- Album Cover / Placeholder -->
            <div
              class="relative flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06]"
            >
              <img
                v-if="album.coverPhoto"
                :src="album.coverPhoto"
                class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                alt="Cover"
              />
              <Images
                v-else
                class="h-4 w-4 text-white/30 transition-colors group-hover:text-indigo-400"
              />
            </div>

            <!-- Album Info -->
            <div class="min-w-0 flex-1">
              <p
                class="truncate text-sm font-medium text-white/80 transition-colors group-hover:text-white"
              >
                {{ album.title }}
              </p>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[11px] text-white/40"> {{ album.totalImages || 0 }} photos </span>
                <span class="text-white/20">•</span>
                <span class="text-[11px] text-white/40">
                  {{ formatDate(album.createdAt) }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="recentAlbums.length === 0" class="py-8 text-center">
            <div
              class="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/[0.04] flex items-center justify-center"
            >
              <Images class="h-5 w-5 text-white/20" />
            </div>
            <p class="text-xs text-white/40">No albums yet</p>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  padding: 16px;
  backdrop-filter: blur(12px);
}

.calendar-day {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  width: 100%;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.15s ease;
}

.calendar-day:hover:not(.calendar-day--muted) {
  background: rgba(255, 255, 255, 0.06);
  color: white;
}

.calendar-day--today {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: white;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.calendar-day--selected {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-weight: 600;
  ring: 2px solid rgba(99, 102, 241, 0.5);
}

.calendar-day--muted {
  color: rgba(255, 255, 255, 0.15);
  cursor: default;
}

.sidebar-scrollable::-webkit-scrollbar {
  width: 4px;
}

.sidebar-scrollable::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-scrollable::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.sidebar-scrollable::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
