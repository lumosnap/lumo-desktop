<script setup lang="ts">
import { ref, computed } from 'vue'
import { Camera, Calendar, ChevronLeft, ChevronRight, ChevronDown, Check } from 'lucide-vue-next'

// --- State & Data ---

// Mini Calendar
import { useUIStore } from '../stores/ui'
import { watch } from 'vue'

const uiStore = useUIStore()
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
