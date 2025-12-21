<script setup lang="ts">
import { ref, computed } from 'vue'
import { Camera, Calendar, ChevronLeft, ChevronRight, ChevronDown, Check } from 'lucide-vue-next'

// --- State & Data ---

// Mini Calendar
const currentDate = new Date()
const currentMonth = ref(currentDate.getMonth())
const currentYear = ref(currentDate.getFullYear())
const selectedDate = ref(currentDate.getDate())

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
      isSelected: i === selectedDate.value
    })
  }

  return days
})

const prevMonth = () => {
  if (currentMonth.value === 0) {
    currentMonth.value = 11
    currentYear.value--
  } else {
    currentMonth.value--
  }
}

const nextMonth = () => {
  if (currentMonth.value === 11) {
    currentMonth.value = 0
    currentYear.value++
  } else {
    currentMonth.value++
  }
}

// Upcoming Shoot
const upcomingShoot = ref({
  title: 'Wedding Shoot at the Grand Hotel',
  time: '12:00 - 13:30',
  minutesAway: 14
})

// My Albums
const isAlbumsExpanded = ref(true)
const albums = ref([
  { id: 1, name: 'Weddings', count: 8, checked: true },
  { id: 2, name: 'Portraits', count: 12, checked: true },
  { id: 3, name: 'Product', count: 5, checked: false },
  { id: 4, name: 'Events', count: 3, checked: false }
])

// Categories
const isCategoriesExpanded = ref(true)
const categories = ref([
  { id: 1, name: 'Personal', color: '#F87171', progress: 70 },
  { id: 2, name: 'Work', color: '#60A5FA', progress: 45 },
  { id: 3, name: 'Freelance', color: '#34D399', progress: 90 }
])
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
                @click="prevMonth"
                class="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft class="h-4 w-4" />
              </button>
              <button
                @click="nextMonth"
                class="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white"
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
              @click="day.isCurrentMonth ? (selectedDate = day.date) : null"
            >
              {{ day.date || '' }}
            </div>
          </div>
        </div>
      </div>

      <!-- CARD 2: Upcoming Shoot Preview -->
      <div class="sidebar-card !p-0 overflow-hidden">
        <div class="relative bg-gradient-to-br from-amber-700/40 to-amber-900/60 p-4">
          <div class="time-badge absolute right-3 top-3 flex items-center gap-1">
            <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-green-400"></span>
            <span>{{ upcomingShoot.minutesAway }} min</span>
          </div>

          <p class="mb-1 text-xs text-white/70">{{ upcomingShoot.time }}</p>
          <h3 class="mb-3 text-sm font-semibold leading-tight text-white">
            {{ upcomingShoot.title }}
          </h3>

          <div class="flex gap-2">
            <button
              class="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-white/20"
            >
              Later
            </button>
            <button
              class="rounded-full bg-[var(--color-turquoise)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-turquoise-dark)]"
            >
              Details
            </button>
          </div>
        </div>
      </div>

      <!-- CARD 3: My Albums -->
      <div class="sidebar-card">
        <button
          @click="isAlbumsExpanded = !isAlbumsExpanded"
          class="mb-3 flex w-full items-center justify-between text-sm font-semibold text-white"
        >
          <span>My Albums</span>
          <ChevronDown
            class="h-4 w-4 text-white/60 transition-transform"
            :class="{ 'rotate-180': !isAlbumsExpanded }"
          />
        </button>

        <div v-if="isAlbumsExpanded" class="space-y-2">
          <div
            v-for="album in albums"
            :key="album.id"
            class="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5"
          >
            <div
              class="flex h-4 w-4 items-center justify-center rounded border border-white/20 transition-colors"
              :class="
                album.checked
                  ? 'bg-[var(--color-turquoise)] border-[var(--color-turquoise)]'
                  : 'bg-transparent'
              "
              @click.stop="album.checked = !album.checked"
            >
              <Check v-if="album.checked" class="h-3 w-3 text-white" />
            </div>
            <span class="flex-1 text-sm text-white">{{ album.name }}</span>
            <span
              class="rounded-full bg-[var(--color-turquoise)] px-2 py-0.5 text-[10px] font-bold text-white"
              >{{ album.count }}</span
            >
          </div>
        </div>
      </div>

      <!-- CARD 4: Categories -->
      <div class="sidebar-card">
        <button
          @click="isCategoriesExpanded = !isCategoriesExpanded"
          class="mb-3 flex w-full items-center justify-between text-sm font-semibold text-white"
        >
          <span>Categories</span>
          <ChevronDown
            class="h-4 w-4 text-white/60 transition-transform"
            :class="{ 'rotate-180': !isCategoriesExpanded }"
          />
        </button>

        <div v-if="isCategoriesExpanded" class="space-y-3">
          <div v-for="category in categories" :key="category.id" class="flex items-center gap-3">
            <div class="category-indicator" :style="{ backgroundColor: category.color }"></div>
            <span class="flex-1 text-sm text-white">{{ category.name }}</span>
            <div class="progress-bar w-16">
              <div
                class="progress-bar-fill"
                :style="{ width: category.progress + '%', backgroundColor: category.color }"
              ></div>
            </div>
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
