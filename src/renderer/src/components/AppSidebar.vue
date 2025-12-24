<script setup lang="ts">
import { ref, computed } from 'vue'
import { Camera, Calendar, ChevronLeft, ChevronRight, Images } from 'lucide-vue-next'

import { useUIStore } from '../stores/ui'
import { useAlbumStore } from '../stores/album'
import { storeToRefs } from 'pinia'
import { watch, onMounted } from 'vue'

const uiStore = useUIStore()
const albumStore = useAlbumStore()
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
})



</script>

<template>
  <aside
    class="glass-sidebar fixed left-0 top-0 z-40 flex h-screen w-[280px] flex-col overflow-hidden border-r border-white/10"
  >
    <!-- Scrollable Content -->
    <div class="sidebar-scrollable flex-1 space-y-4 overflow-y-auto p-4">
      <!-- CARD 1: User Profile + Mini Calendar -->
      <div class="sidebar-card">
        <!-- User Profile -->
        <div class="mb-6 flex items-center gap-3">
          <div class="relative">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-turquoise)] to-[var(--color-deep-teal)]"
            >
              <Camera class="h-6 w-6 text-white" />
            </div>
            <div
              class="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-turquoise)] text-[10px] font-bold text-white"
            >
              3
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-white truncate">Alex Photo</p>
            <p class="text-xs text-[var(--color-text-on-dark-muted)] truncate">Pro Plan</p>
          </div>
          <button
            class="ml-auto rounded-lg p-2 text-[var(--color-text-on-dark-muted)] hover:bg-white/5"
          >
            <Calendar class="h-5 w-5" />
          </button>
        </div>

        <!-- Mini Calendar -->
        <div>
          <div class="mb-4 flex items-center justify-between">
            <span class="text-sm font-semibold text-white"
              >{{ monthNames[currentMonth] }} {{ currentYear }}</span
            >
            <div class="flex gap-1">
              <button
                class="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white"
                @click="prevMonth"
              >
                <ChevronLeft class="h-4 w-4" />
              </button>
              <button
                class="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white"
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
              class="text-center text-[11px] font-medium text-[var(--color-text-on-dark-muted)]"
            >
              {{ day }}
            </div>
          </div>

          <div class="grid grid-cols-7 gap-1">
            <div
              v-for="(day, index) in calendarDays"
              :key="index"
              class="mini-calendar-cell"
              :class="{
                today: day.isToday,
                selected: day.isSelected && !day.isToday,
                muted: !day.isCurrentMonth
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
        <div class="mb-3 flex items-center justify-between">
          <h3
            class="text-xs font-bold uppercase tracking-wider text-[var(--color-text-on-dark-muted)]"
          >
            Recent Albums
          </h3>
        </div>

        <div class="space-y-3">
          <div
            v-for="album in recentAlbums"
            :key="album.id"
            class="group flex cursor-pointer items-center gap-3 rounded-xl p-2 transition-all duration-300 hover:bg-white/10 hover:shadow-lg hover:shadow-black/5"
            @click="goToAlbumDate(album)"
          >
            <!-- Album Cover / Placeholder -->
            <div
              class="relative flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[var(--color-surface-dark)] to-black/40 shadow-inner"
            >
              <img
                v-if="album.coverPhoto"
                :src="album.coverPhoto"
                class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                alt="Cover"
              />
              <Images
                v-else
                class="h-5 w-5 text-[var(--color-text-on-dark-muted)] transition-colors group-hover:text-[var(--color-turquoise)]"
              />
            </div>

            <!-- Album Info -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between">
                <p
                  class="truncate text-sm font-medium text-white transition-colors group-hover:text-[var(--color-turquoise)]"
                >
                  {{ album.title }}
                </p>
                <span class="text-[10px] font-medium text-[var(--color-text-on-dark-muted)]">
                  {{ formatDate(album.createdAt) }}
                </span>
              </div>
              <p class="mt-0.5 text-xs text-[var(--color-text-on-dark-muted)]">
                {{ album.totalImages || 0 }} photos
              </p>
            </div>
          </div>

          <div
            v-if="recentAlbums.length === 0"
            class="py-6 text-center text-xs text-[var(--color-text-on-dark-muted)]"
          >
            No albums yet
          </div>
        </div>
      </div>

    </div>
  </aside>
</template>

<style scoped>
.sidebar-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 16px;
  backdrop-filter: blur(8px);
}
</style>
