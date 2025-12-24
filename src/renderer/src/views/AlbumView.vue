<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import CreateAlbumModal from '../components/CreateAlbumModal.vue'
import SyncModal from '../components/SyncModal.vue'
import Dropdown from '../components/ui/Dropdown.vue'
import ProgressPopover from '../components/ui/ProgressPopover.vue'
import { ChevronLeft, ChevronRight, RefreshCw, Plus, Trash2, MoreHorizontal, Loader2 } from 'lucide-vue-next'
import type { Album } from '../stores/album'
import { useUIStore } from '../stores/ui'

const uiStore = useUIStore()
const router = useRouter()
const showCreateModal = ref(false)
const albums = ref<Album[]>([])
const loading = ref(true)
const currentDate = computed({
  get: () => uiStore.selectedDate,
  set: (val) => uiStore.setSelectedDate(val)
})
const selectedView = ref<'month' | 'week' | 'day'>('week')
const createAlbumDate = ref<Date | undefined>(undefined)

// Progress State
const isProcessing = ref(false)
const currentUploadingAlbumId = ref<string | null>(null)
const uploadProgress = ref<{
  albumId: string
  compressing: number
  uploading: number
  complete: number
  total: number
  failed: number
  pending: number
} | null>(null)
const batchInfo = ref<{ batchIndex: number; totalBatches: number } | null>(null)

// Delete State
const showDeleteModal = ref(false)
const albumToDelete = ref<Album | null>(null)
const deleteConfirmation = ref('')
const isDeleting = ref(false)
const deleteError = ref('')

// Sync State
const showSyncModal = ref(false)
const syncAlbum = ref<Album | null>(null)
const syncChanges = ref<any>(null)
const isSyncLoading = ref(false)

// Time slots for the calendar
const timeSlots = [
  '6 am',
  '7 am',
  '8 am',
  '9 am',
  '10 am',
  '11 am',
  '12 pm',
  '1 pm',
  '2 pm',
  '3 pm',
  '4 pm',
  '5 pm'
]

// Color palette for albums
const colors = ['yellow', 'green', 'purple', 'pink', 'blue', 'peach']

// --- Calendar Logic ---

// Week View Days
const weekDays = computed(() => {
  const days: { date: Date; dayName: string; dayNumber: number; isToday: boolean }[] = []
  const startOfWeek = new Date(currentDate.value)
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()) // Sunday

  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + i)
    days.push({
      date,
      dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNumber: date.getDate(),
      isToday: isToday(date)
    })
  }
  return days
})

// Month View Days
const monthDays = computed(() => {
  const days: { date: Date; dayNumber: number; isCurrentMonth: boolean; isToday: boolean }[] = []
  const year = currentDate.value.getFullYear()
  const month = currentDate.value.getMonth()

  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)

  // Start from the Sunday before the first day of the month
  const startDate = new Date(firstDayOfMonth)
  startDate.setDate(startDate.getDate() - startDate.getDay())

  // End on the Saturday after the last day of the month
  const endDate = new Date(lastDayOfMonth)
  endDate.setDate(endDate.getDate() + (6 - endDate.getDay()))

  const iterDate = new Date(startDate)
  while (iterDate <= endDate) {
    days.push({
      date: new Date(iterDate),
      dayNumber: iterDate.getDate(),
      isCurrentMonth: iterDate.getMonth() === month,
      isToday: isToday(iterDate)
    })
    iterDate.setDate(iterDate.getDate() + 1)
  }

  return days
})

// Day View
const currentDay = computed(() => {
  const date = new Date(currentDate.value)
  return {
    date,
    dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
    dayNumber: date.getDate(),
    isToday: isToday(date)
  }
})

// Month and year display
const monthYear = computed(() => {
  return currentDate.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

// Map albums to calendar grid
const calendarAlbums = computed(() => {
  // Filter albums based on view
  let filteredAlbums = albums.value

  if (selectedView.value === 'week') {
    if (!weekDays.value.length) return []
    const start = new Date(weekDays.value[0].date)
    start.setHours(0, 0, 0, 0)
    const end = new Date(weekDays.value[6].date)
    end.setHours(23, 59, 59, 999)

    filteredAlbums = albums.value.filter((a) => {
      const d = new Date(a.startTime || a.eventDate || a.createdAt)
      return d >= start && d <= end
    })
  } else if (selectedView.value === 'month') {
    if (!monthDays.value.length) return []
    const start = new Date(monthDays.value[0].date)
    start.setHours(0, 0, 0, 0)
    const end = new Date(monthDays.value[monthDays.value.length - 1].date)
    end.setHours(23, 59, 59, 999)

    filteredAlbums = albums.value.filter((a) => {
      const d = new Date(a.startTime || a.eventDate || a.createdAt)
      return d >= start && d <= end
    })
  } else if (selectedView.value === 'day') {
    const start = new Date(currentDate.value)
    start.setHours(0, 0, 0, 0)
    const end = new Date(currentDate.value)
    end.setHours(23, 59, 59, 999)

    filteredAlbums = albums.value.filter((a) => {
      const d = new Date(a.startTime || a.eventDate || a.createdAt)
      return d >= start && d <= end
    })
  }

  return filteredAlbums.map((album, index) => {
    // Determine start time
    const startDate = album.startTime
      ? new Date(album.startTime)
      : album.eventDate
        ? new Date(album.eventDate)
        : new Date(album.createdAt)

    const dayIndex = startDate.getDay() // 0-6 (Sun-Sat)

    // Calculate time slot
    const startHour = startDate.getHours()
    let timeSlot = startHour - 6 // Calendar starts at 6am
    if (timeSlot < 0) timeSlot = 0
    if (timeSlot >= timeSlots.length) timeSlot = timeSlots.length - 1

    // Calculate span
    let span = 2 // Default span
    if (album.endTime && album.startTime) {
      const end = new Date(album.endTime)
      const start = new Date(album.startTime)
      const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
      span = Math.max(1, Math.ceil(durationHours))
    }

    // Cap span to remaining slots
    span = Math.min(span, timeSlots.length - timeSlot)

    // Format time string
    const timeStr =
      album.startTime && album.endTime
        ? `${new Date(album.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${new Date(album.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : `${timeSlots[timeSlot]} - ${timeSlots[Math.min(timeSlot + span, timeSlots.length - 1)] || 'End'}`

    return {
      ...album,
      dayIndex, // For week view
      date: startDate, // For month/day view
      timeSlot,
      span,
      color: colors[index % colors.length],
      time: timeStr
    }
  })
})

function isToday(date: Date): boolean {
  const today = new Date()
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  )
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  )
}

function prev(): void {
  const newDate = new Date(currentDate.value)
  if (selectedView.value === 'month') {
    newDate.setMonth(newDate.getMonth() - 1)
  } else if (selectedView.value === 'week') {
    newDate.setDate(newDate.getDate() - 7)
  } else {
    newDate.setDate(newDate.getDate() - 1)
  }
  currentDate.value = newDate
}

function next(): void {
  const newDate = new Date(currentDate.value)
  if (selectedView.value === 'month') {
    newDate.setMonth(newDate.getMonth() + 1)
  } else if (selectedView.value === 'week') {
    newDate.setDate(newDate.getDate() + 7)
  } else {
    newDate.setDate(newDate.getDate() + 1)
  }
  currentDate.value = newDate
}

function goToToday(): void {
  currentDate.value = new Date()
}

function goToDate(date: Date): void {
  currentDate.value = date
  selectedView.value = 'day' // Switch to day view when clicking a date header
}

function openAlbum(albumId: string): void {
  router.push(`/albums/${albumId}`)
}

function openCreateModal(date?: Date, timeSlotIndex?: number): void {
  if (date) {
    const d = new Date(date)
    if (timeSlotIndex !== undefined) {
      // timeSlots start at 6am
      d.setHours(6 + timeSlotIndex, 0, 0, 0)
    } else {
      // Default to 9am if no time slot
      d.setHours(9, 0, 0, 0)
    }
    createAlbumDate.value = d
  } else {
    createAlbumDate.value = undefined
  }
  showCreateModal.value = true
}

async function loadAlbums(): Promise<void> {
  loading.value = true
  try {
    const result = await window.api.albums.list()
    if (result.success) {
      albums.value = result.albums || []
    }
  } catch (error) {
    console.error('Failed to load albums:', error)
  } finally {
    loading.value = false
  }
}

function handleAlbumCreated(albumId: string): void {
  showCreateModal.value = false
  loadAlbums()
  console.log('Album created:', albumId)
}

// Delete Functions
function openDeleteModal(album: Album): void {
  albumToDelete.value = album
  deleteConfirmation.value = ''
  deleteError.value = ''
  showDeleteModal.value = true
}

// Sync Functions
async function openSyncModal(album: Album): Promise<void> {
  syncAlbum.value = album
  syncChanges.value = null
  isSyncLoading.value = true
  showSyncModal.value = true

  try {
    const result = await window.api.sync.detectChanges(album.id)
    if (result.success) {
      syncChanges.value = result.changes
    }
  } catch (error) {
    console.error('Failed to detect sync changes:', error)
  } finally {
    isSyncLoading.value = false
  }
}

function handleSyncComplete(): void {
  loadAlbums()
}

async function handleDeleteAlbum(): Promise<void> {
  if (!albumToDelete.value) return

  if (deleteConfirmation.value !== albumToDelete.value.title) {
    deleteError.value = 'Album name does not match'
    return
  }

  isDeleting.value = true
  deleteError.value = ''

  try {
    const result = await window.api.albums.delete(albumToDelete.value.id)
    if (result.success) {
      showDeleteModal.value = false
      albumToDelete.value = null
      loadAlbums()
    } else {
      deleteError.value = result.error || 'Failed to delete album'
    }
  } catch (error: any) {
    deleteError.value = error.message || 'An unexpected error occurred'
  } finally {
    isDeleting.value = false
  }
}

// Event handlers
const onBatchStart = (_e: any, data: any): void => {
  isProcessing.value = true
  batchInfo.value = data
}

const onProgress = (_e: any, data: any): void => {
  isProcessing.value = true
  uploadProgress.value = data
  if (data.albumId) {
    currentUploadingAlbumId.value = data.albumId
  }
}

const onComplete = (): void => {
  isProcessing.value = false
  uploadProgress.value = null
  batchInfo.value = null
  currentUploadingAlbumId.value = null
  loadAlbums()
}

const onError = (): void => {
  isProcessing.value = false
  // Optional: show toast
}

const onAlbumStatusChanged = (_e: any, data: { albumId: string; needsSync: number }): void => {
  console.log('Album status changed:', data)
  const album = albums.value.find((a) => a.id === data.albumId)
  if (album) {
    album.needsSync = data.needsSync
  }
}

onMounted(() => {
  loadAlbums()

  // Register listeners
  if (window.api && window.api.on) {
    window.api.on('upload:batch-start', onBatchStart)
    window.api.on('upload:progress', onProgress)
    window.api.on('upload:complete', onComplete)
    window.api.on('upload:error', onError)
    window.api.on('album:status-changed', onAlbumStatusChanged)
  }
})

onUnmounted(() => {
  if (window.api && window.api.off) {
    window.api.off('upload:batch-start', onBatchStart)
    window.api.off('upload:progress', onProgress)
    window.api.off('upload:complete', onComplete)
    window.api.off('upload:error', onError)
    window.api.off('album:status-changed', onAlbumStatusChanged)
  }
})
</script>

<template>
  <AppLayout>
    <div class="flex h-full flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-8 py-6">
        <h1 class="text-3xl font-bold text-[var(--color-text-on-light)]">{{ monthYear }}</h1>

        <div class="flex items-center gap-4">
          <!-- View Toggle -->
          <div class="view-toggle">
            <button
              class="view-toggle-btn"
              :class="{ active: selectedView === 'month' }"
              @click="selectedView = 'month'"
            >
              Month
            </button>
            <button
              class="view-toggle-btn"
              :class="{ active: selectedView === 'week' }"
              @click="selectedView = 'week'"
            >
              Week
            </button>
            <button
              class="view-toggle-btn"
              :class="{ active: selectedView === 'day' }"
              @click="selectedView = 'day'"
            >
              Day
            </button>
          </div>

          <!-- Navigation -->
          <div class="flex items-center gap-2">
            <button
              class="rounded-lg p-2 text-[var(--color-text-on-light-muted)] hover:bg-black/5"
              @click="prev"
            >
              <ChevronLeft class="h-5 w-5" />
            </button>
            <button
              class="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-on-light)] hover:bg-black/5"
              @click="goToToday"
            >
              Today
            </button>
            <button
              class="rounded-lg p-2 text-[var(--color-text-on-light-muted)] hover:bg-black/5"
              @click="next"
            >
              <ChevronRight class="h-5 w-5" />
            </button>
          </div>

          <!-- Refresh Button -->
          <button
            class="rounded-lg p-2 text-[var(--color-text-on-light-muted)] hover:bg-black/5 transition-colors"
            title="Refresh Albums"
            :disabled="loading"
            @click="loadAlbums"
          >
            <RefreshCw class="h-5 w-5" :class="{ 'animate-spin': loading }" />
          </button>

          <!-- Create Album Button -->
          <button
            class="flex items-center gap-2 rounded-lg bg-[var(--color-turquoise)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-turquoise-dark)]"
            @click="openCreateModal()"
          >
            <Plus class="h-4 w-4" />
            New Album
          </button>

          <!-- Progress Popover -->
          <ProgressPopover :progress="uploadProgress" :is-processing="isProcessing" />
        </div>
      </div>

      <!-- WEEK VIEW -->
      <template v-if="selectedView === 'week'">
        <!-- Week Day Headers -->
        <div class="grid grid-cols-[80px_repeat(7,1fr)] border-b border-black/5 px-4">
          <div></div>
          <div
            v-for="day in weekDays"
            :key="day.date.getTime()"
            class="cursor-pointer py-4 text-center transition-all hover:bg-black/5"
            :class="{ 'rounded-2xl bg-[#1e1e2d] hover:bg-[#252535]': day.isToday }"
            @click="goToDate(day.date)"
          >
            <div
              class="text-xs font-medium"
              :class="day.isToday ? 'text-white/70' : 'text-[var(--color-text-on-light-muted)]'"
            >
              {{ day.dayName }}
            </div>
            <div
              class="text-2xl font-bold"
              :class="day.isToday ? 'text-white' : 'text-[var(--color-text-on-light)]'"
            >
              {{ day.dayNumber }}
            </div>
          </div>
        </div>

        <!-- Week Calendar Grid -->
        <div class="content-scrollable flex-1 overflow-y-auto">
          <div class="grid grid-cols-[80px_repeat(7,1fr)]">
            <!-- Time Slots -->
            <template v-for="(slot, slotIndex) in timeSlots" :key="slotIndex">
              <!-- Time Label -->
              <div class="flex h-24 items-start justify-end pr-4 pt-2">
                <span class="text-xs font-medium text-[var(--color-text-on-light-muted)]">
                  {{ slot }}
                </span>
              </div>

              <!-- Day Cells -->
              <div
                v-for="(day, dayIndex) in weekDays"
                :key="`${slotIndex}-${dayIndex}`"
                class="group relative h-24 border-b border-l border-black/5 p-1"
              >
                <!-- Add Button on Hover -->
                <div
                  class="pointer-events-none absolute inset-0 z-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <button
                    class="pointer-events-auto transform rounded-full bg-[var(--color-turquoise)] p-2 text-white shadow-lg transition-transform hover:scale-100 hover:scale-110"
                    title="Create Album Here"
                    @click="openCreateModal(day.date, slotIndex)"
                  >
                    <Plus class="h-4 w-4" />
                  </button>
                </div>

                <!-- Album Cards -->
                <div
                  v-for="album in calendarAlbums.filter(
                    (a) => isSameDay(a.date, day.date) && a.timeSlot === slotIndex
                  )"
                  :key="album.id"
                  class="album-card group/card relative z-10"
                  :class="`album-card-${album.color}`"
                  :style="{ height: album.span * 96 - 8 + 'px' }"
                  @click="openAlbum(album.id)"
                >
                  <!-- Needs Sync Badge -->
                  <div
                    v-if="album.needsSync"
                    class="absolute -right-1 -top-1 z-10 rounded-full bg-yellow-500 px-2 py-0.5 text-[9px] font-bold text-yellow-950 shadow-lg"
                  >
                    SYNC
                  </div>

                  <div class="text-xs font-semibold text-[var(--color-text-on-light)]">
                    {{ album.title }}
                  </div>
                  <div class="text-[11px] text-[var(--color-text-on-light-muted)]">
                    {{ album.time }}
                  </div>

                  <!-- Loading Overlay -->
                  <div
                    v-if="currentUploadingAlbumId === album.id"
                    class="absolute inset-0 z-30 flex items-center justify-center rounded-lg bg-black/50 backdrop-blur-[1px]"
                  >
                    <Loader2 class="h-6 w-6 animate-spin text-[var(--color-turquoise)]" />
                  </div>

                  <!-- Album Actions Dropdown (always visible, at bottom) -->
                  <div class="absolute bottom-1 right-1 z-20" @click.stop>
                    <Dropdown align="right" :disabled="currentUploadingAlbumId === album.id">
                      <template #trigger>
                        <button
                          class="rounded-full bg-black/30 p-1 text-white hover:bg-black/50 backdrop-blur-sm transition-colors"
                        >
                          <MoreHorizontal class="h-3 w-3" />
                        </button>
                      </template>
                      <template #content="{ close }">
                        <div class="py-1">
                          <button
                            v-if="album.needsSync"
                            class="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--color-turquoise)] hover:bg-[var(--color-turquoise)]/10"
                            @click="
                              () => {
                                close()
                                openSyncModal(album)
                              }
                            "
                          >
                            <RefreshCw class="h-4 w-4" />
                            Sync Album
                          </button>
                          <button
                            class="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300"
                            @click="
                              () => {
                                close()
                                openDeleteModal(album)
                              }
                            "
                          >
                            <Trash2 class="h-4 w-4" />
                            Delete Album
                          </button>
                        </div>
                      </template>
                    </Dropdown>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>

      <!-- MONTH VIEW -->
      <template v-else-if="selectedView === 'month'">
        <!-- Month Day Headers -->
        <div class="grid grid-cols-7 border-b border-black/5 px-4">
          <div
            v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']"
            :key="day"
            class="py-4 text-center text-xs font-medium text-[var(--color-text-on-light-muted)]"
          >
            {{ day }}
          </div>
        </div>

        <!-- Month Grid -->
        <div class="content-scrollable flex-1 overflow-y-auto p-4">
          <div class="grid h-full auto-rows-fr grid-cols-7 gap-1">
            <div
              v-for="day in monthDays"
              :key="day.date.getTime()"
              class="group relative min-h-[120px] rounded-lg border border-black/5 p-2 transition-colors hover:bg-white"
              :class="{ 'bg-white/50': !day.isCurrentMonth, 'bg-[#1e1e2d]/5': day.isToday }"
            >
              <div class="mb-2 flex items-start justify-between">
                <span
                  class="flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium"
                  :class="
                    day.isToday
                      ? 'bg-[#1e1e2d] text-white'
                      : 'text-[var(--color-text-on-light-muted)]'
                  "
                >
                  {{ day.dayNumber }}
                </span>

                <!-- Add Button on Hover -->
                <button
                  class="transform rounded-full bg-[var(--color-turquoise)] p-1 text-white opacity-0 shadow-sm transition-opacity hover:scale-100 group-hover:opacity-100"
                  title="Create Album"
                  @click="openCreateModal(day.date)"
                >
                  <Plus class="h-3 w-3" />
                </button>
              </div>

              <!-- Albums List -->
              <div class="space-y-1">
                <div
                  v-for="album in calendarAlbums.filter((a) => isSameDay(a.date, day.date))"
                  :key="album.id"
                  class="cursor-pointer truncate rounded px-1.5 py-1 text-[10px] font-medium text-white transition-opacity hover:opacity-80"
                  :class="`bg-${album.color}-500`"
                  :title="album.title"
                  @click="openAlbum(album.id)"
                >
                  {{ album.title }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- DAY VIEW -->
      <template v-else-if="selectedView === 'day'">
        <!-- Day Header -->
        <div class="border-b border-black/5 px-8 py-4 text-center">
          <div class="text-sm font-medium text-[var(--color-text-on-light-muted)]">
            {{ currentDay.dayName }}
          </div>
          <div class="text-3xl font-bold text-[var(--color-text-on-light)]">
            {{ currentDay.dayNumber }}
          </div>
        </div>

        <!-- Day Grid -->
        <div class="content-scrollable flex-1 overflow-y-auto">
          <div class="grid grid-cols-[80px_1fr]">
            <template v-for="(slot, slotIndex) in timeSlots" :key="slotIndex">
              <!-- Time Label -->
              <div class="flex h-32 items-start justify-end pr-4 pt-2">
                <span class="text-xs font-medium text-[var(--color-text-on-light-muted)]">
                  {{ slot }}
                </span>
              </div>

              <!-- Day Cell -->
              <div class="group relative h-32 border-b border-l border-black/5 p-2">
                <!-- Add Button on Hover -->
                <div
                  class="pointer-events-none absolute inset-0 z-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <button
                    class="pointer-events-auto transform rounded-full bg-[var(--color-turquoise)] p-2 text-white shadow-lg transition-transform hover:scale-100 hover:scale-110"
                    title="Create Album Here"
                    @click="openCreateModal(currentDay.date, slotIndex)"
                  >
                    <Plus class="h-4 w-4" />
                  </button>
                </div>

                <!-- Album Cards -->
                <div
                  v-for="album in calendarAlbums.filter(
                    (a) => isSameDay(a.date, currentDay.date) && a.timeSlot === slotIndex
                  )"
                  :key="album.id"
                  class="album-card group/card relative z-10"
                  :class="`album-card-${album.color}`"
                  :style="{ height: album.span * 128 - 16 + 'px' }"
                  @click="openAlbum(album.id)"
                >
                  <!-- Needs Sync Badge -->
                  <div
                    v-if="album.needsSync"
                    class="absolute -right-1 -top-1 z-10 rounded-full bg-yellow-500 px-2 py-0.5 text-[9px] font-bold text-yellow-950 shadow-lg"
                  >
                    SYNC
                  </div>

                  <div class="text-sm font-semibold text-[var(--color-text-on-light)]">
                    {{ album.title }}
                  </div>
                  <div class="text-xs text-[var(--color-text-on-light-muted)]">
                    {{ album.time }}
                  </div>
                  <div
                    v-if="album.totalImages"
                    class="mt-2 text-xs text-[var(--color-text-on-light-muted)]"
                  >
                    {{ album.totalImages }} photos
                  </div>

                  <!-- Loading Overlay -->
                  <div
                    v-if="currentUploadingAlbumId === album.id"
                    class="absolute inset-0 z-30 flex items-center justify-center rounded-lg bg-black/50 backdrop-blur-[1px]"
                  >
                    <Loader2 class="h-8 w-8 animate-spin text-[var(--color-turquoise)]" />
                  </div>

                  <!-- Album Actions Dropdown (always visible, at bottom) -->
                  <div class="absolute bottom-1 right-1 z-20" @click.stop>
                    <Dropdown align="right" :disabled="currentUploadingAlbumId === album.id">
                      <template #trigger>
                        <button
                          class="rounded-full bg-black/30 p-1 text-white hover:bg-black/50 backdrop-blur-sm transition-colors"
                        >
                          <MoreHorizontal class="h-4 w-4" />
                        </button>
                      </template>
                      <template #content="{ close }">
                        <div class="py-1">
                          <button
                            v-if="album.needsSync"
                            class="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--color-turquoise)] hover:bg-[var(--color-turquoise)]/10"
                            @click="
                              () => {
                                close()
                                openSyncModal(album)
                              }
                            "
                          >
                            <RefreshCw class="h-4 w-4" />
                            Sync Album
                          </button>
                          <button
                            class="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300"
                            @click="
                              () => {
                                close()
                                openDeleteModal(album)
                              }
                            "
                          >
                            <Trash2 class="h-4 w-4" />
                            Delete Album
                          </button>
                        </div>
                      </template>
                    </Dropdown>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>

    <!-- Create Album Modal -->
    <CreateAlbumModal
      :show="showCreateModal"
      :initial-date="createAlbumDate"
      @close="showCreateModal = false"
      @created="handleAlbumCreated"
    />

    <!-- Sync Modal -->
    <SyncModal
      :show="showSyncModal"
      :album-id="syncAlbum?.id || ''"
      :album-title="syncAlbum?.title || ''"
      :changes="syncChanges"
      :is-loading="isSyncLoading"
      @close="showSyncModal = false"
      @sync="handleSyncComplete"
    />

    <!-- Delete Confirmation Modal -->
    <div
      v-if="showDeleteModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div class="w-full max-w-md rounded-2xl bg-[#1e1e2d] border border-red-500/20 p-6 shadow-2xl">
        <h3 class="mb-2 text-xl font-bold text-white">Delete Album</h3>
        <p class="mb-4 text-sm text-gray-400">
          This will permanently delete <strong>{{ albumToDelete?.title }}</strong> from the cloud
          and your local device. This action cannot be undone.
        </p>

        <div class="mb-4">
          <label class="mb-1.5 block text-xs font-medium text-gray-400">
            Type <span class="text-white font-bold">{{ albumToDelete?.title }}</span> to confirm
          </label>
          <input
            v-model="deleteConfirmation"
            type="text"
            class="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-red-500/50 focus:outline-none"
            placeholder="Type album name"
          />
          <p v-if="deleteError" class="mt-1 text-xs text-red-500">{{ deleteError }}</p>
        </div>

        <div class="flex justify-end gap-3">
          <button
            class="rounded-lg px-4 py-2 text-sm font-medium text-gray-400 hover:text-white"
            :disabled="isDeleting"
            @click="showDeleteModal = false"
          >
            Cancel
          </button>
          <button
            class="rounded-lg bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/20 disabled:opacity-50"
            :disabled="isDeleting || deleteConfirmation !== albumToDelete?.title"
            @click="handleDeleteAlbum"
          >
            {{ isDeleting ? 'Deleting...' : 'Delete Album' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Progress Overlay Removed -->
  </AppLayout>
</template>
