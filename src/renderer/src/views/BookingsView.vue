<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import AppLayout from '../layouts/AppLayout.vue'
import Modal from '../components/ui/Modal.vue'
import {
  Link,
  MapPin,
  Phone,
  ChevronDown,
  Copy,
  Check,
  ExternalLink,
  CircleAlert
} from 'lucide-vue-next'
import { useBookingUrl } from '../composables/useBookingUrl'
import { toast } from '../composables/useToast'

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
const open = reactive(new Set<number>())

function startOfDay(d: string | Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

const upcomingBookings = computed(() => {
  const today = startOfDay(new Date())
  return bookings.value
    .filter((b) => startOfDay(b.eventDate) >= today)
    .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime())
})

const pastBookings = computed(() => {
  const today = startOfDay(new Date())
  return bookings.value
    .filter((b) => startOfDay(b.eventDate) < today)
    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
})

const rows = computed(() =>
  activeTab.value === 'upcoming' ? upcomingBookings.value : pastBookings.value
)
const next = computed(() => upcomingBookings.value[0])

// silent = background poll: no skeleton, and a failed poll keeps the list on screen
async function fetchBookings(silent = false): Promise<void> {
  if (!silent) {
    isLoading.value = true
    error.value = null
  }
  try {
    const result = await window.api.profile.getBookings()
    if (result.success && result.data) {
      bookings.value = result.data
      error.value = null
    } else if (!silent) {
      error.value = result.error || 'Failed to fetch bookings'
    }
  } catch (err: unknown) {
    if (!silent) error.value = err instanceof Error ? err.message : 'Failed to fetch bookings'
    else console.error('Bookings poll failed:', err)
  } finally {
    if (!silent) isLoading.value = false
  }
}

function formatDate(s: string): string {
  if (!s) return 'N/A'
  const d = new Date(s)
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
  })
}

function shortDate(s: string): string {
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// "Today", "Tomorrow" or "Monday, in 4 days"
function relativeDay(s: string): string {
  const days = Math.round((startOfDay(s).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `${new Date(s).toLocaleDateString('en-GB', { weekday: 'long' })}, in ${days} days`
}

function initials(s: string): string {
  return s
    .split(/\s|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
}

const tel = (p: string): string => `tel:${p.replace(/\s/g, '')}`

function toggle(id: number): void {
  if (open.has(id)) open.delete(id)
  else open.add(id)
}

function readFirst(): void {
  if (next.value) open.add(next.value.id)
}

const link = useBookingUrl()
const showBookingModal = ref(false)

async function openBookingLink(): Promise<void> {
  if (await link.load()) showBookingModal.value = true
  else if (link.error.value) toast(link.error.value)
}

// New requests show up while this page is open; polling stops when you leave it
const POLL_MS = 10_000
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  fetchBookings()
  poll = setInterval(() => {
    if (!document.hidden) fetchBookings(true)
  }, POLL_MS)
})
onUnmounted(() => clearInterval(poll))
</script>

<template>
  <AppLayout>
    <div class="page">
      <header class="head">
        <div>
          <div class="label">Clients</div>
          <h1>Bookings</h1>
        </div>
        <div class="actions">
          <button class="btn ghost" :disabled="link.loading.value" @click="openBookingLink">
            <span v-if="link.loading.value" class="spin"></span><Link v-else />Booking link
          </button>
        </div>
      </header>

      <div class="book-wrap">
        <div v-if="error" class="err" role="alert" style="margin: 0">
          <CircleAlert />{{ error }}
          <button class="link" @click="fetchBookings()">Try again</button>
        </div>

        <div v-if="activeTab === 'upcoming' && next" class="card next-shoot">
          <div class="date">
            <small>{{ relativeDay(next.eventDate) }}</small
            ><b>{{ shortDate(next.eventDate) }}</b>
          </div>
          <div class="who-b">
            <div class="sub" style="margin: 0 0 2px">Next shoot</div>
            <div class="t">{{ next.name }}</div>
            <div class="m">
              <span class="tag">{{ next.eventType }}</span>
              <span v-if="next.location"><MapPin />{{ next.location }}</span>
              <span v-if="next.phone"
                ><Phone /><a class="tel" :href="tel(next.phone)">{{ next.phone }}</a></span
              >
            </div>
          </div>
          <button v-if="next.details" class="btn ghost" @click="readFirst">Read details</button>
        </div>

        <div class="card" style="padding: 8px 8px 4px">
          <div style="padding: 8px 8px 16px">
            <div class="seg" role="group" aria-label="Bookings">
              <button :aria-pressed="activeTab === 'upcoming'" @click="activeTab = 'upcoming'">
                Upcoming <span class="n num">{{ upcomingBookings.length }}</span>
              </button>
              <button :aria-pressed="activeTab === 'past'" @click="activeTab = 'past'">
                Past <span class="n num">{{ pastBookings.length }}</span>
              </button>
            </div>
          </div>

          <div v-if="isLoading" class="wait" style="padding: 24px 12px">
            <span class="spin"></span>Loading bookings…
          </div>
          <div v-else-if="!rows.length" class="empty" style="padding: 48px 8px">
            <p v-if="activeTab === 'upcoming'">
              No upcoming shoots. Share your booking link and requests land here.
            </p>
            <p v-else>No past shoots yet.</p>
          </div>
          <table v-else class="bk">
            <thead>
              <tr>
                <th>Client</th>
                <th>Shoot</th>
                <th>Date and place</th>
                <th>Phone</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="b in rows" :key="b.id">
                <tr>
                  <td>
                    <div class="client">
                      <span class="avatar">{{ initials(b.name) }}</span
                      >{{ b.name }}
                    </div>
                  </td>
                  <td>
                    <span class="tag">{{ b.eventType }}</span>
                  </td>
                  <td>
                    {{ formatDate(b.eventDate) }}
                    <div class="sm">{{ b.location }}</div>
                  </td>
                  <td class="ph-n">
                    <a class="tel num" :href="tel(b.phone)">{{ b.phone }}</a>
                  </td>
                  <td class="d">
                    <button
                      v-if="b.details"
                      class="more"
                      :aria-expanded="open.has(b.id)"
                      @click="toggle(b.id)"
                    >
                      <span>{{ b.details }}</span
                      ><ChevronDown />
                    </button>
                    <span v-else class="sm">None given</span>
                  </td>
                </tr>
                <tr v-if="open.has(b.id)" class="det">
                  <td></td>
                  <td colspan="4">
                    <div class="detail" style="white-space: pre-wrap">{{ b.details }}</div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <Modal :show="showBookingModal" title="Booking link" @close="showBookingModal = false">
      <p>Put this on Instagram or WhatsApp. New requests show up in Bookings.</p>
      <div class="input-row">
        <input class="input mono" readonly :value="link.url.value" aria-label="Booking link" />
        <button class="btn primary" @click="link.copy">
          <template v-if="link.copied.value"><Check />Copied</template>
          <template v-else><Copy />Copy</template>
        </button>
      </div>
      <template #footer>
        <button class="btn ghost" @click="showBookingModal = false">Close</button>
        <button class="btn primary" @click="link.open"><ExternalLink />Open page</button>
      </template>
    </Modal>
  </AppLayout>
</template>
