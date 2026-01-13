<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import AppLayout from '../layouts/AppLayout.vue'
import { CalendarDays, MapPin, Phone, AlertTriangle, Inbox, ArrowLeft, Info } from 'lucide-vue-next'
import Dropdown from '../components/ui/Dropdown.vue'

interface Booking {
  id: number
  photographerId: string
  eventType: string
  name: string
  phone: string
  eventDate: string
  location: string
  details: string
  createdAt: string
  updatedAt: string
}

const bookings = ref<Booking[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
const activeTab = ref<'upcoming' | 'past'>('upcoming')

const upcomingBookings = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return bookings.value
    .filter((booking) => {
      const eventDate = new Date(booking.eventDate)
      eventDate.setHours(0, 0, 0, 0)
      return eventDate >= today
    })
    .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime())
})

const pastBookings = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return bookings.value
    .filter((booking) => {
      const eventDate = new Date(booking.eventDate)
      eventDate.setHours(0, 0, 0, 0)
      return eventDate < today
    })
    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime()) // Sort past bookings decenting
})

const filteredBookings = computed(() => {
  return activeTab.value === 'upcoming' ? upcomingBookings.value : pastBookings.value
})

async function fetchBookings(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const result = await window.api.profile.getBookings()
    if (result.success && result.data) {
      bookings.value = result.data
    } else {
      error.value = result.error || 'Failed to fetch bookings'
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Failed to fetch bookings'
  } finally {
    isLoading.value = false
  }
}

function formatDate(dateString: string): string {
  if (!dateString) return 'N/A'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

onMounted(() => {
  fetchBookings()
})
</script>

<template>
  <AppLayout>
    <div class="flex h-full flex-col overflow-hidden bg-slate-50 text-slate-900">
      <!-- Header -->
      <div class="flex flex-col border-b border-slate-200 bg-white px-8 pt-5 shrink-0">
        <div class="mb-5">
          <!-- Back Button -->
          <router-link
            to="/albums"
            class="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors mb-2"
          >
            <ArrowLeft class="w-4 h-4" />
            Back to Albums
          </router-link>
          <div class="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1">
            Management
          </div>
          <h1 class="text-2xl font-serif italic text-slate-900">Bookings</h1>
        </div>

        <!-- Tabs -->
        <div class="flex items-center gap-6 -mb-px">
          <button
            @click="activeTab = 'upcoming'"
            class="pb-3 text-sm font-medium transition-colors border-b-2"
            :class="
              activeTab === 'upcoming'
                ? 'text-indigo-600 border-indigo-600'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            "
          >
            Upcoming
            <span
              class="ml-1.5 py-0.5 px-2 rounded-full text-xs"
              :class="
                activeTab === 'upcoming'
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'bg-slate-100 text-slate-600'
              "
            >
              {{ upcomingBookings.length }}
            </span>
          </button>
          <button
            @click="activeTab = 'past'"
            class="pb-3 text-sm font-medium transition-colors border-b-2"
            :class="
              activeTab === 'past'
                ? 'text-indigo-600 border-indigo-600'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            "
          >
            Past
            <span
              class="ml-1.5 py-0.5 px-2 rounded-full text-xs"
              :class="
                activeTab === 'past'
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'bg-slate-100 text-slate-600'
              "
            >
              {{ pastBookings.length }}
            </span>
          </button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="flex-1 overflow-y-auto p-8">
        <div class="max-w-7xl mx-auto space-y-6">
          <!-- Error State -->
          <div
            v-if="error"
            class="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-700"
          >
            <AlertTriangle class="w-5 h-5 shrink-0" />
            <p>{{ error }}</p>
            <button
              @click="fetchBookings"
              class="text-sm font-medium underline hover:text-red-800 ml-auto"
            >
              Try Again
            </button>
          </div>

          <!-- Loading State (Skeleton) -->
          <div
            v-if="isLoading"
            class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm"
          >
            <div class="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
              <div class="h-4 w-32 bg-slate-200 rounded animate-pulse"></div>
            </div>
            <div class="divide-y divide-slate-100">
              <div v-for="i in 5" :key="i" class="p-6">
                <div class="flex items-start justify-between gap-4">
                  <div class="space-y-3 flex-1">
                    <div class="flex items-center gap-2">
                      <div class="h-5 w-40 bg-slate-200 rounded animate-pulse"></div>
                      <div class="h-5 w-24 bg-slate-200 rounded-full animate-pulse"></div>
                    </div>
                    <div class="space-y-2">
                      <div class="h-4 w-full max-w-md bg-slate-200 rounded animate-pulse"></div>
                      <div class="h-4 w-64 bg-slate-200 rounded animate-pulse"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty State -->
          <div
            v-else-if="filteredBookings.length === 0"
            class="flex flex-col items-center justify-center py-20 text-center"
          >
            <div class="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <Inbox class="w-10 h-10 text-slate-400" />
            </div>
            <h3 class="text-lg font-bold text-slate-900 mb-1">No {{ activeTab }} bookings</h3>
            <p class="text-slate-500 max-w-sm">
              {{
                activeTab === 'upcoming'
                  ? 'When clients book future events, they will appear here.'
                  : 'History of your completed events will appear here.'
              }}
            </p>
          </div>

          <!-- Bookings List -->
          <div
            v-else
            class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm"
          >
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th class="px-6 py-4 font-semibold text-slate-900">Client</th>
                    <th class="px-6 py-4 font-semibold text-slate-900">Event Type</th>
                    <th class="px-6 py-4 font-semibold text-slate-900">Date & Location</th>
                    <th class="px-6 py-4 font-semibold text-slate-900">Contact</th>
                    <th class="px-6 py-4 font-semibold text-slate-900">Details</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <tr
                    v-for="booking in filteredBookings"
                    :key="booking.id"
                    class="hover:bg-slate-50/50 transition-colors"
                  >
                    <td class="px-6 py-4 align-top">
                      <div class="font-medium text-slate-900 text-base">{{ booking.name }}</div>
                    </td>
                    <td class="px-6 py-4 align-top">
                      <span
                        class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100"
                      >
                        {{ booking.eventType }}
                      </span>
                    </td>
                    <td class="px-6 py-4 align-top">
                      <div class="flex items-center gap-2 text-slate-700 mb-1">
                        <CalendarDays class="w-4 h-4 text-slate-400" />
                        <span>{{ formatDate(booking.eventDate) }}</span>
                      </div>
                      <div class="flex items-center gap-2 text-slate-500 text-xs">
                        <MapPin class="w-4 h-4 text-slate-400" />
                        <span>{{ booking.location }}</span>
                      </div>
                    </td>
                    <td class="px-6 py-4 align-top">
                      <div class="flex items-center gap-2 text-slate-700">
                        <Phone class="w-4 h-4 text-slate-400" />
                        <a
                          :href="`tel:${booking.phone}`"
                          class="hover:text-indigo-600 hover:underline"
                        >
                          {{ booking.phone }}
                        </a>
                      </div>
                    </td>
                    <td class="px-6 py-4 align-top">
                      <div v-if="booking.details">
                        <Dropdown align="right" class="w-full">
                          <template #trigger>
                            <div class="group cursor-pointer">
                              <p
                                class="text-slate-600 line-clamp-2 max-w-xs group-hover:text-indigo-600 transition-colors"
                              >
                                {{ booking.details }}
                              </p>
                              <span
                                class="text-xs text-indigo-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity mt-1 inline-block"
                              >
                                Show more
                              </span>
                            </div>
                          </template>
                          <template #content>
                            <div class="p-4 w-80">
                              <div class="flex items-start gap-2 mb-2 text-indigo-600">
                                <Info class="w-4 h-4 shrink-0 mt-0.5" />
                                <span class="text-xs font-bold uppercase tracking-wider"
                                  >Event Details</span
                                >
                              </div>
                              <p class="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                {{ booking.details }}
                              </p>
                            </div>
                          </template>
                        </Dropdown>
                      </div>
                      <span v-else class="text-slate-400 text-sm italic">No details</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
