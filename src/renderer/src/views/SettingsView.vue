<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Modal from '../components/ui/Modal.vue'
import { useAuthStore } from '../stores/auth'
import { useProfileStore } from '../stores/profile'
import { useUpdater } from '../composables/useUpdater'
import { useBookingUrl } from '../composables/useBookingUrl'
import {
  UserRound,
  Receipt,
  HardDrive,
  Download,
  LogOut,
  Lock,
  Check,
  Copy,
  TriangleAlert,
  CircleAlert,
  Trash2
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const profileStore = useProfileStore()
const { updateStatus, checkForUpdates } = useUpdater()
const link = useBookingUrl()

// No "Watch folder" tab: albums watch their own source folders, there is no master folder.
const TABS = [
  { id: 'profile', icon: UserRound, label: 'Profile' },
  { id: 'billing', icon: Receipt, label: 'Plan and billing' },
  { id: 'storage', icon: HardDrive, label: 'Storage and data' },
  { id: 'updates', icon: Download, label: 'Updates' }
]
const tab = computed(() => {
  const t = route.params.tab
  return TABS.some((x) => x.id === t) ? (t as string) : 'profile'
})

const user = computed(() => ({
  name: authStore.user?.name || '',
  email: authStore.user?.email || ''
}))

/* ---- profile ---- */
const profileData = ref({ businessName: '', phone: '' })
const isLoadingProfile = ref(false)
const isSavingProfile = ref(false)
const profileError = ref<string | null>(null)
const profileSaveSuccess = ref(false)
const avatarLetter = computed(() => (profileData.value.businessName || user.value.name || '?')[0])

async function loadProfileData(): Promise<void> {
  isLoadingProfile.value = true
  profileError.value = null
  try {
    await profileStore.fetchProfile(true)
    if (profileStore.profile) {
      profileData.value = {
        businessName: profileStore.profile.businessName || '',
        phone: profileStore.profile.phone || ''
      }
    } else if (profileStore.error) {
      profileError.value = profileStore.error
    }
  } catch (err: unknown) {
    profileError.value = err instanceof Error ? err.message : 'Failed to load profile'
  } finally {
    isLoadingProfile.value = false
  }
}

async function saveProfile(): Promise<void> {
  isSavingProfile.value = true
  profileError.value = null
  profileSaveSuccess.value = false
  try {
    const result = await window.api.profile.update({
      businessName: profileData.value.businessName || undefined,
      phone: profileData.value.phone || undefined
    })
    if (result.success) {
      profileSaveSuccess.value = true
      await profileStore.fetchProfile(true)
      setTimeout(() => (profileSaveSuccess.value = false), 3000)
    } else {
      profileError.value = result.error || 'Failed to save profile'
    }
  } catch (err: unknown) {
    profileError.value = err instanceof Error ? err.message : 'Failed to save profile'
  } finally {
    isSavingProfile.value = false
  }
}

const showStack = ref(localStorage.getItem('lumo:hidePrintStack') !== '1')
function toggleStack(): void {
  if (showStack.value) localStorage.removeItem('lumo:hidePrintStack')
  else localStorage.setItem('lumo:hidePrintStack', '1')
  window.dispatchEvent(new Event('lumo:printstack'))
}

/* ---- billing ---- */
interface Plan {
  id: number
  name: string
  displayName: string
  imageLimit: number
  priceMonthly: string
  description: string
}
const availablePlans = ref<Plan[]>([])
const isLoadingPlans = ref(false)
const selectedPlanId = ref<number | null>(null)
const requestedPlanId = ref<number | null>(null)
const isRequestingUpgrade = ref(false)
const upgradeError = ref<string | null>(null)

function formatExpiryDate(date: string | null): string {
  if (!date) return 'Never'
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

// priceMonthly is in paise, as a string
function formatPrice(priceMonthly: string): string {
  const cents = parseInt(priceMonthly, 10)
  if (cents === 0) return 'Free'
  return `₹${(cents / 100).toFixed(0)}`
}

const isCurrentPlan = (plan: Plan): boolean => plan.displayName === profileStore.profile?.planName
const isPlanUpgrade = (plan: Plan): boolean =>
  !!profileStore.profile && plan.imageLimit > profileStore.profile.imageLimit
const isBelowUsage = (plan: Plan): boolean =>
  !!profileStore.profile && plan.imageLimit < profileStore.profile.totalImages

async function loadPlans(): Promise<void> {
  isLoadingPlans.value = true
  try {
    const result = await window.api.plans.list()
    if (result.success && result.data) availablePlans.value = result.data
  } catch (err: unknown) {
    console.error('Failed to load plans:', err)
  } finally {
    isLoadingPlans.value = false
  }
}

async function requestUpgrade(planId: number): Promise<void> {
  isRequestingUpgrade.value = true
  upgradeError.value = null
  selectedPlanId.value = planId
  try {
    const result = await window.api.plans.requestUpgrade(planId)
    if (result.success) requestedPlanId.value = planId
    else upgradeError.value = result.error || 'Failed to request upgrade'
  } catch (err: unknown) {
    upgradeError.value = err instanceof Error ? err.message : 'Failed to request upgrade'
  } finally {
    isRequestingUpgrade.value = false
    selectedPlanId.value = null
  }
}

/* ---- storage ---- */
const storageLocation = ref<string | null>(null)
const freeSpace = ref('')
const isLowStorage = ref(false)
const isLoadingStorage = ref(false)
const storageError = ref<string | null>(null)
const pendingNewPath = ref<string | null>(null)
const isChangingStorage = ref(false)

async function loadStorageInfo(): Promise<void> {
  isLoadingStorage.value = true
  storageError.value = null
  try {
    const info = await window.api.config.getCurrentStorageInfo()
    if (info.success) {
      storageLocation.value = info.path
      freeSpace.value = info.freeSpaceFormatted
      isLowStorage.value = info.isLowStorage
    } else {
      storageError.value = info.error || 'Failed to get storage info'
    }
  } catch (err: unknown) {
    storageError.value = err instanceof Error ? err.message : 'Failed to load storage info'
  } finally {
    isLoadingStorage.value = false
  }
}

async function selectNewFolder(): Promise<void> {
  try {
    const path = await window.api.dialog.openDirectory()
    if (path && path !== storageLocation.value) pendingNewPath.value = path
  } catch (err: unknown) {
    storageError.value = err instanceof Error ? err.message : 'Failed to select folder'
  }
}

async function confirmChangeStorage(): Promise<void> {
  if (!pendingNewPath.value) return
  isChangingStorage.value = true
  storageError.value = null
  try {
    const result = await window.api.config.setStorageLocation(pendingNewPath.value)
    if (result.success) {
      storageLocation.value = pendingNewPath.value
      await loadStorageInfo()
    } else {
      storageError.value = result.error || 'Failed to change storage location'
    }
  } catch (err: unknown) {
    storageError.value = err instanceof Error ? err.message : 'Failed to change storage location'
  } finally {
    isChangingStorage.value = false
    pendingNewPath.value = null
  }
}

/* ---- reset ---- */
const showReset = ref(false)
const resetWord = ref('')
const isResetting = ref(false)
const resetError = ref<string | null>(null)

function openReset(): void {
  resetWord.value = ''
  resetError.value = null
  showReset.value = true
}

async function confirmResetAllData(): Promise<void> {
  isResetting.value = true
  resetError.value = null
  try {
    const result = await window.api.config.resetAllData()
    if (result.success) {
      localStorage.clear()
      showReset.value = false
      await authStore.logout()
      router.push('/login')
    } else {
      resetError.value = result.error || 'Failed to reset data'
    }
  } catch (err: unknown) {
    resetError.value = err instanceof Error ? err.message : 'Failed to reset data'
  } finally {
    isResetting.value = false
  }
}

/* ---- updates ---- */
const appVersion = ref('')
async function loadAppVersion(): Promise<void> {
  try {
    appVersion.value = await window.api.config.getAppVersion()
  } catch (e) {
    console.error('Failed to get app version', e)
    appVersion.value = 'Unknown'
  }
}

/* ---- sign out ---- */
const showSignOut = ref(false)
async function handleLogout(): Promise<void> {
  showSignOut.value = false
  await authStore.logout()
  router.push('/login')
}

onMounted(() => {
  loadStorageInfo()
  loadProfileData()
  loadPlans()
  loadAppVersion()
  link.load()
})
</script>

<template>
  <AppLayout>
    <div class="page">
      <header class="head">
        <div>
          <div class="label">Account</div>
          <h1>Settings</h1>
        </div>
      </header>
      <div class="settings">
        <nav class="tabs" aria-label="Settings">
          <router-link
            v-for="t in TABS"
            :key="t.id"
            :to="`/settings/${t.id}`"
            :aria-current="t.id === tab ? 'page' : undefined"
          >
            <component :is="t.icon" />{{ t.label }}
          </router-link>
          <hr />
          <button class="out" @click="showSignOut = true"><LogOut />Sign out</button>
        </nav>

        <div class="stack">
          <!-- Profile -->
          <template v-if="tab === 'profile'">
            <div class="card profile-top">
              <span class="avatar lg" style="margin: 0 auto">{{ avatarLetter }}</span>
              <h2>{{ profileData.businessName || user.name }}</h2>
              <div class="sub">{{ user.name }} · {{ user.email }}</div>
            </div>
            <form class="card" @submit.prevent="saveProfile">
              <h2>Details clients see</h2>
              <div class="sub">On your booking page and shared albums</div>
              <div class="form2">
                <div class="field">
                  <label for="f-biz">Business name</label>
                  <input
                    id="f-biz"
                    v-model="profileData.businessName"
                    class="input"
                    :disabled="isLoadingProfile"
                  />
                </div>
                <div class="field">
                  <label for="f-ph">Phone</label>
                  <input
                    id="f-ph"
                    v-model="profileData.phone"
                    class="input"
                    type="tel"
                    :disabled="isLoadingProfile"
                  />
                </div>
                <div class="field">
                  <span class="lbl"
                    >Full name <span class="lock"><Lock />From Google</span></span
                  >
                  <input
                    class="input"
                    :value="user.name"
                    readonly
                    aria-label="Full name, managed by Google"
                  />
                </div>
                <div class="field">
                  <span class="lbl"
                    >Email <span class="lock"><Lock />From Google</span></span
                  >
                  <input
                    class="input"
                    :value="user.email"
                    readonly
                    aria-label="Email, managed by Google"
                  />
                </div>
              </div>
              <div v-if="profileError" class="err" role="alert">
                <CircleAlert />{{ profileError }}
              </div>
              <div class="row-actions">
                <button
                  class="btn primary"
                  type="submit"
                  :disabled="isSavingProfile || isLoadingProfile"
                >
                  <span v-if="isSavingProfile" class="spin"></span
                  >{{ isSavingProfile ? 'Saving…' : 'Save changes' }}
                </button>
                <span v-if="profileSaveSuccess" class="saved"><Check />Saved</span>
              </div>
            </form>
            <div class="card">
              <h2>Sidebar</h2>
              <label class="check-row">
                <input v-model="showStack" type="checkbox" @change="toggleStack" />Show the print
                stack
              </label>
            </div>
            <div class="card">
              <h2>Booking page</h2>
              <div class="sub">
                Clients pick a date and tell you about the shoot. Requests land in Bookings.
              </div>
              <div v-if="link.url.value" class="input-row" style="margin-top: 16px">
                <input
                  class="input mono"
                  readonly
                  :value="link.url.value"
                  aria-label="Booking page link"
                />
                <button class="btn primary" @click="link.copy">
                  <template v-if="link.copied.value"><Check />Copied</template>
                  <template v-else><Copy />Copy</template>
                </button>
                <button class="btn ghost" @click="link.open">Open</button>
              </div>
              <div v-else-if="link.loading.value" class="wait" style="margin: 16px 0 0">
                <span class="spin"></span>Getting your link…
              </div>
              <div v-else-if="link.error.value" class="err" role="alert">
                <CircleAlert />{{ link.error.value }}
                <button class="link" @click="link.load">Try again</button>
              </div>
            </div>
          </template>

          <!-- Plan and billing -->
          <template v-else-if="tab === 'billing'">
            <div class="card">
              <h2>{{ profileStore.profile?.planName || 'Loading…' }}</h2>
              <div class="sub">
                Expires {{ formatExpiryDate(profileStore.profile?.planExpiry || null) }}
              </div>
              <div class="inset" style="margin-top: 16px">
                <div
                  style="
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                    margin-bottom: 8px;
                  "
                >
                  <span>
                    <span style="color: var(--brand); font-size: 22px" class="num">{{
                      (profileStore.profile?.totalImages || 0).toLocaleString()
                    }}</span>
                    <span style="color: var(--ink-3)">
                      of
                      {{ (profileStore.profile?.imageLimit || 500).toLocaleString() }} photos</span
                    >
                  </span>
                  <span class="num" style="font-size: 12px; color: var(--ink-3)"
                    >{{ Math.round(profileStore.usagePercentage) }}% used</span
                  >
                </div>
                <div class="bar lg">
                  <span
                    :class="{ warn: profileStore.isNearLimit || profileStore.isAtLimit }"
                    :style="{ '--p': profileStore.usagePercentage / 100 }"
                  ></span>
                </div>
              </div>
              <div v-if="profileStore.isAtLimit" class="note-line" style="margin-top: 8px">
                <TriangleAlert /><span
                  >You have reached your plan limit. Upgrade to upload more photos.</span
                >
              </div>
              <div v-else-if="profileStore.isNearLimit" class="note-line" style="margin-top: 8px">
                <TriangleAlert /><span
                  >About {{ profileStore.remainingImages.toLocaleString() }} photos left.</span
                >
              </div>
            </div>
            <div class="card">
              <h2>Plans</h2>
              <div v-if="isLoadingPlans" class="wait" style="margin: 16px 0 0">
                <span class="spin"></span>Loading plans…
              </div>
              <div v-else class="plans" style="margin-top: 16px">
                <div
                  v-for="plan in availablePlans"
                  :key="plan.id"
                  class="plan"
                  :class="{ current: isCurrentPlan(plan) }"
                >
                  <div style="display: flex; justify-content: space-between">
                    {{ plan.displayName
                    }}<span v-if="isCurrentPlan(plan)" class="sub" style="margin: 0"
                      >Your plan</span
                    >
                  </div>
                  <div class="p num">
                    {{ formatPrice(plan.priceMonthly)
                    }}<small v-if="plan.priceMonthly !== '0'">/mo</small>
                  </div>
                  <div class="num" style="font-size: 14px">
                    {{ plan.imageLimit.toLocaleString() }} photos
                  </div>
                  <div class="d">{{ plan.description }}</div>
                  <template v-if="!isCurrentPlan(plan) && isPlanUpgrade(plan)">
                    <span v-if="requestedPlanId === plan.id" class="saved"><Check />Requested</span>
                    <button
                      v-else
                      class="btn sm primary"
                      :disabled="isRequestingUpgrade"
                      @click="requestUpgrade(plan.id)"
                    >
                      <span v-if="selectedPlanId === plan.id" class="spin"></span>Request upgrade
                    </button>
                  </template>
                  <span
                    v-else-if="!isCurrentPlan(plan) && isBelowUsage(plan)"
                    class="sub"
                    style="margin: 0"
                    >Lower than your usage</span
                  >
                </div>
              </div>
              <div v-if="upgradeError" class="err" role="alert">
                <CircleAlert />{{ upgradeError }}
              </div>
            </div>
          </template>

          <!-- Storage and data -->
          <template v-else-if="tab === 'storage'">
            <div class="card">
              <h2>Where photos wait before upload</h2>
              <div class="sub">
                LumoSnap keeps a compressed copy of each photo here until it reaches the cloud
              </div>
              <div class="inset path-row" style="margin-top: 16px">
                <HardDrive />
                <span class="p">{{
                  isLoadingStorage ? 'Loading…' : storageLocation || 'Not set'
                }}</span>
                <button class="btn sm ghost" :disabled="isChangingStorage" @click="selectNewFolder">
                  Change…
                </button>
              </div>
              <div
                v-if="storageLocation && !isLoadingStorage"
                style="margin-top: 16px; font-size: 13px"
              >
                <b style="font-weight: 500">{{ freeSpace || 'Unknown' }}</b>
                <span style="color: var(--ink-3)">free on this drive</span>
              </div>
              <div v-if="isLowStorage" class="note-line" style="margin-top: 12px">
                <TriangleAlert /><span
                  >Under 10 GB free. A large wedding may not fit. Pick a drive with more room.</span
                >
              </div>
              <div v-if="storageError" class="err" role="alert">
                <CircleAlert />{{ storageError }}
              </div>
            </div>
            <div class="card">
              <h2>Reset LumoSnap on this computer</h2>
              <div class="sub">Use this if the app is in a bad state. It removes:</div>
              <ul class="danger-list">
                <li>All albums, from the cloud and from this computer</li>
                <li>All uploaded and compressed photos</li>
                <li>Settings</li>
                <li>Your sign-in</li>
              </ul>
              <button class="btn danger-ghost" @click="openReset"><Trash2 />Reset all data…</button>
            </div>
          </template>

          <!-- Updates -->
          <template v-else-if="tab === 'updates'">
            <div class="card">
              <h2>LumoSnap {{ appVersion }}</h2>
              <div class="row-actions">
                <button
                  class="btn ghost"
                  :disabled="updateStatus === 'Checking for updates...'"
                  @click="checkForUpdates"
                >
                  Check for updates
                </button>
                <span v-if="updateStatus === 'Checking for updates...'" class="status"
                  ><span class="spin"></span>Checking…</span
                >
                <span v-else-if="updateStatus === 'App is up to date'" class="saved"
                  ><Check />You have the latest version</span
                >
                <span v-else-if="updateStatus" class="status">{{ updateStatus }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <Modal :show="!!pendingNewPath" title="Move the upload cache?" @close="pendingNewPath = null">
      <p>
        Existing albums are not moved. Albums in the old location will not be accessible from the
        app.
      </p>
      <div class="inset path-row">
        <HardDrive /><span class="p">{{ pendingNewPath }}</span>
      </div>
      <template #footer>
        <button class="btn ghost" autofocus @click="pendingNewPath = null">Cancel</button>
        <button class="btn primary" :disabled="isChangingStorage" @click="confirmChangeStorage">
          {{ isChangingStorage ? 'Changing…' : 'Use this folder' }}
        </button>
      </template>
    </Modal>

    <Modal :show="showReset" title="Reset all data?" @close="showReset = false">
      <p>
        This signs you out and deletes every album from the cloud and from this computer, along with
        settings and cached photos. Client links stop working. This can't be undone.
      </p>
      <div class="field">
        <label for="rs">Type <b>reset</b> to confirm</label>
        <input id="rs" v-model="resetWord" class="input" autocomplete="off" autofocus />
      </div>
      <div v-if="resetError" class="err" role="alert"><CircleAlert />{{ resetError }}</div>
      <template #footer>
        <button class="btn ghost" @click="showReset = false">Cancel</button>
        <button
          class="btn danger"
          :disabled="resetWord !== 'reset' || isResetting"
          @click="confirmResetAllData"
        >
          <span v-if="isResetting" class="spin"></span
          >{{ isResetting ? 'Resetting…' : 'Reset all data' }}
        </button>
      </template>
    </Modal>

    <Modal :show="showSignOut" title="Sign out of LumoSnap?" @close="showSignOut = false">
      <p>Uploads in progress pause until you sign in again. Your albums stay on this computer.</p>
      <template #footer>
        <button class="btn ghost" autofocus @click="showSignOut = false">Cancel</button>
        <button class="btn primary" @click="handleLogout">Sign out</button>
      </template>
    </Modal>
  </AppLayout>
</template>
