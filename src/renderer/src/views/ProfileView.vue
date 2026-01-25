<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Button from '../components/ui/Button.vue'
import { useAuthStore } from '../stores/auth'
import { useProfileStore } from '../stores/profile'
import {
  User,
  CreditCard,
  LogOut,
  CheckCircle2,
  Mail,
  Building2,
  Folder,
  HardDrive,
  AlertTriangle,
  X,
  Phone,
  Loader2,
  ImageIcon,
  ArrowLeft,
  Settings2,
  Eye,
  Sparkles,
  Clock,
  Link as LinkIcon,
  Copy,
  Check,
  ExternalLink,
  Download,
  RefreshCw,
  Trash2
} from 'lucide-vue-next'
import Modal from '../components/ui/Modal.vue'

const router = useRouter()
const authStore = useAuthStore()
const profileStore = useProfileStore()
import { useUpdater } from '../composables/useUpdater'

const { updateStatus, updateAvailable, checkForUpdates } = useUpdater()
import appLogo from '../assets/logo.png'

const activeTab = ref('profile')

const tabs = [
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'storage', label: 'Watch Folder', icon: Eye },
  { id: 'billing', label: 'Billing & Plan', icon: CreditCard },
  { id: 'advanced', label: 'Advanced', icon: Settings2 },
  { id: 'updates', label: 'Updates', icon: RefreshCw }
]

const appVersion = ref('Loading...')

async function loadAppVersion(): Promise<void> {
  if (window.api && window.api.config && window.api.config.getAppVersion) {
    try {
      appVersion.value = await window.api.config.getAppVersion()
    } catch (e) {
      console.error('Failed to get app version', e)
      appVersion.value = 'Unknown'
    }
  }
}

// Profile data from API (local editable fields only)
const profileData = ref<{
  businessName: string
  phone: string
}>({
  businessName: '',
  phone: ''
})
const isLoadingProfile = ref(false)
const isSavingProfile = ref(false)
const profileError = ref<string | null>(null)
const profileSaveSuccess = ref(false)

// Booking URL state
const bookingUrl = ref('')
const isBookingUrlLoading = ref(false)
const showBookingModal = ref(false)
const bookingError = ref<string | null>(null)
const bookingUrlCopied = ref(false)

// Use auth store user data
const user = computed(() => ({
  name: authStore.user?.name || '',
  email: authStore.user?.email || ''
}))

async function generateBookingUrl(): Promise<void> {
  isBookingUrlLoading.value = true
  bookingError.value = null

  // Check local storage first
  const storageKey = `bookingUrl_${authStore.user?.email || 'default'}`
  const cachedUrl = localStorage.getItem(storageKey)

  if (cachedUrl) {
    bookingUrl.value = cachedUrl
    showBookingModal.value = true
    isBookingUrlLoading.value = false
    return
  }

  try {
    const result = await window.api.profile.getBookingUrl()
    if (result.success && result.bookingUrl) {
      bookingUrl.value = result.bookingUrl
      localStorage.setItem(storageKey, result.bookingUrl)
      showBookingModal.value = true
    } else {
      bookingError.value = result.error || 'Failed to generate booking URL'
    }
  } catch (err: unknown) {
    bookingError.value = err instanceof Error ? err.message : 'Failed to generate booking URL'
  } finally {
    isBookingUrlLoading.value = false
  }
}

async function copyBookingUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(bookingUrl.value)
    bookingUrlCopied.value = true
    setTimeout(() => {
      bookingUrlCopied.value = false
    }, 2000)
  } catch {
    // Fallback for older browsers
    const textArea = document.createElement('textarea')
    textArea.value = bookingUrl.value
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    bookingUrlCopied.value = true
    setTimeout(() => {
      bookingUrlCopied.value = false
    }, 2000)
  }
}

function openBookingUrl(): void {
  window.open(bookingUrl.value, '_blank')
}

// Plans state
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
const isRequestingUpgrade = ref(false)
const upgradeSuccess = ref(false)
const upgradeError = ref<string | null>(null)

// Storage settings state
const storageLocation = ref<string | null>(null)
const freeSpace = ref('')
const freeSpaceBytes = ref(0)
const isLowStorage = ref(false)
const isLoadingStorage = ref(false)
const storageError = ref<string | null>(null)
const showChangeConfirmation = ref(false)
const pendingNewPath = ref<string | null>(null)
const isChangingStorage = ref(false)

// Master folder state
const masterFolder = ref<string | null>(null)
const isLoadingMasterFolder = ref(false)
const isSettingMasterFolder = ref(false)
const masterFolderError = ref<string | null>(null)

// Reset all data state
const showResetConfirmation = ref(false)
const isResetting = ref(false)
const resetError = ref<string | null>(null)

// Format plan expiry date
function formatExpiryDate(date: string | null): string {
  if (!date) return 'Never'
  const d = new Date(date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Format price (priceMonthly is in cents as string)
function formatPrice(priceMonthly: string): string {
  const cents = parseInt(priceMonthly, 10)
  if (cents === 0) return 'Free'
  return `₹${(cents / 100).toFixed(0)}`
}

// Check if plan is current
function isCurrentPlan(plan: Plan): boolean {
  return plan.displayName === profileStore.profile?.planName
}

// Check if plan is an upgrade
function isPlanUpgrade(plan: Plan): boolean {
  if (!profileStore.profile) return false
  return plan.imageLimit > profileStore.profile.imageLimit
}

async function loadPlans(): Promise<void> {
  isLoadingPlans.value = true
  try {
    const result = await window.api.plans.list()
    if (result.success && result.data) {
      availablePlans.value = result.data
    }
  } catch (err: unknown) {
    console.error('Failed to load plans:', err)
  } finally {
    isLoadingPlans.value = false
  }
}

async function requestUpgrade(planId: number): Promise<void> {
  isRequestingUpgrade.value = true
  upgradeError.value = null
  upgradeSuccess.value = false
  selectedPlanId.value = planId

  try {
    const result = await window.api.plans.requestUpgrade(planId)
    if (result.success) {
      upgradeSuccess.value = true
      setTimeout(() => {
        upgradeSuccess.value = false
        selectedPlanId.value = null
      }, 3000)
    } else {
      upgradeError.value = result.error || 'Failed to request upgrade'
    }
  } catch (err: unknown) {
    upgradeError.value = err instanceof Error ? err.message : 'Failed to request upgrade'
  } finally {
    isRequestingUpgrade.value = false
  }
}

async function loadProfileData(): Promise<void> {
  isLoadingProfile.value = true
  profileError.value = null
  try {
    // Use the profile store to fetch data (syncs with other components)
    await profileStore.fetchProfile(true) // force refresh
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
      // Refresh the store to sync changes across components
      await profileStore.fetchProfile(true)
      setTimeout(() => {
        profileSaveSuccess.value = false
      }, 3000)
    } else {
      profileError.value = result.error || 'Failed to save profile'
    }
  } catch (err: unknown) {
    profileError.value = err instanceof Error ? err.message : 'Failed to save profile'
  } finally {
    isSavingProfile.value = false
  }
}

async function loadStorageInfo(): Promise<void> {
  isLoadingStorage.value = true
  storageError.value = null
  try {
    const info = await window.api.config.getCurrentStorageInfo()
    if (info.success) {
      storageLocation.value = info.path
      freeSpace.value = info.freeSpaceFormatted
      freeSpaceBytes.value = info.freeSpace
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
    if (path && path !== storageLocation.value) {
      pendingNewPath.value = path
      showChangeConfirmation.value = true
    }
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
      // Reload storage info to get updated free space
      await loadStorageInfo()
    } else {
      storageError.value = result.error || 'Failed to change storage location'
    }
  } catch (err: unknown) {
    storageError.value = err instanceof Error ? err.message : 'Failed to change storage location'
  } finally {
    isChangingStorage.value = false
    showChangeConfirmation.value = false
    pendingNewPath.value = null
  }
}

function cancelChangeStorage(): void {
  showChangeConfirmation.value = false
  pendingNewPath.value = null
}

async function loadMasterFolder(): Promise<void> {
  isLoadingMasterFolder.value = true
  masterFolderError.value = null
  try {
    const folder = await window.api.config.getMasterFolder()
    masterFolder.value = folder
  } catch (err: unknown) {
    masterFolderError.value = err instanceof Error ? err.message : 'Failed to load master folder'
  } finally {
    isLoadingMasterFolder.value = false
  }
}

async function selectMasterFolder(): Promise<void> {
  try {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      isSettingMasterFolder.value = true
      masterFolderError.value = null
      const result = await window.api.config.setMasterFolder(path)
      if (result.success) {
        masterFolder.value = path
      } else {
        masterFolderError.value = result.error || 'Failed to set master folder'
      }
      isSettingMasterFolder.value = false
    }
  } catch (err: unknown) {
    masterFolderError.value = err instanceof Error ? err.message : 'Failed to select folder'
    isSettingMasterFolder.value = false
  }
}

async function openMasterFolder(): Promise<void> {
  if (masterFolder.value) {
    await window.api.shell.openFolder(masterFolder.value)
  }
}

async function confirmResetAllData(): Promise<void> {
  isResetting.value = true
  resetError.value = null

  try {
    const result = await window.api.config.resetAllData()
    if (result.success) {
      // Clear local storage
      localStorage.clear()
      showResetConfirmation.value = false
      // Redirect to login (app will reinitialize on next launch)
      await authStore.logout()
      router.push('/login')
    } else {
      // Keep modal open to show the error
      resetError.value = result.error || 'Failed to reset data'
    }
  } catch (err: unknown) {
    resetError.value = err instanceof Error ? err.message : 'Failed to reset data'
  } finally {
    isResetting.value = false
  }
}

function cancelReset(): void {
  showResetConfirmation.value = false
  resetError.value = null
}

async function handleLogout(): Promise<void> {
  await authStore.logout()
  router.push('/login')
}

onMounted(() => {
  loadStorageInfo()
  loadProfileData()
  loadMasterFolder()
  loadPlans()
  loadAppVersion()
})
</script>

<template>
  <AppLayout>
    <div class="flex h-full overflow-hidden bg-slate-50 text-slate-900">
      <!-- Left Sidebar -->
      <aside class="w-80 border-r border-slate-200 bg-white p-6 flex flex-col shrink-0 shadow-sm">
        <!-- Header -->
        <div class="mb-8">
          <div class="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2">Account</div>
          <h1 class="text-3xl font-serif italic text-slate-900">Settings</h1>
        </div>

        <!-- Navigation -->
        <div class="bg-slate-50 rounded-2xl p-3 border border-slate-100 shadow-inner space-y-1.5">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium"
            :class="
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
            "
            @click="activeTab = tab.id"
          >
            <component
              :is="tab.icon"
              class="h-4 w-4"
              :class="activeTab === tab.id ? 'text-indigo-500' : 'text-slate-400'"
            />
            <span>{{ tab.label }}</span>
          </button>
        </div>

        <!-- Spacer -->
        <div class="flex-1"></div>

        <!-- Back to Albums -->
        <button
          class="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent hover:border-slate-200"
          @click="router.push('/')"
        >
          <ArrowLeft class="h-4 w-4" />
          <span>Back to Albums</span>
        </button>

        <!-- Logout Button -->
        <button
          class="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium text-rose-500 hover:bg-rose-50 hover:text-rose-600 border border-transparent hover:border-rose-100"
          @click="handleLogout"
        >
          <LogOut class="h-4 w-4" />
          <span>Logout</span>
        </button>
      </aside>

      <!-- Main Content -->
      <main class="flex-1 overflow-y-auto p-8">
        <div class="max-w-2xl mx-auto">
          <!-- Profile Section -->
          <div v-if="activeTab === 'profile'" class="space-y-8 animate-fade-in">
            <!-- Section Header -->
            <div>
              <div class="flex items-center gap-2 mb-1">
                <h2 class="text-2xl font-bold text-slate-900">Public Profile</h2>
                <div
                  v-if="profileSaveSuccess"
                  class="flex items-center gap-1 text-emerald-600 text-[10px] font-medium bg-emerald-50 px-2 py-0.5 rounded-full"
                >
                  <CheckCircle2 class="h-3 w-3" />
                  Saved
                </div>
              </div>
              <p class="text-slate-500 text-sm">This will be displayed on your shared albums.</p>
            </div>

            <!-- Loading State -->
            <div v-if="isLoadingProfile" class="space-y-6">
              <div class="h-8 w-48 bg-slate-200 rounded animate-pulse"></div>
              <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
                <div class="grid grid-cols-2 gap-6">
                  <div class="space-y-2">
                    <div class="h-4 w-24 bg-slate-200 rounded animate-pulse"></div>
                    <div class="h-12 w-full bg-slate-100 rounded-xl animate-pulse"></div>
                  </div>
                  <div class="space-y-2">
                    <div class="h-4 w-24 bg-slate-200 rounded animate-pulse"></div>
                    <div class="h-12 w-full bg-slate-100 rounded-xl animate-pulse"></div>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-6">
                  <div class="space-y-2">
                    <div class="h-4 w-24 bg-slate-200 rounded animate-pulse"></div>
                    <div class="h-12 w-full bg-slate-100 rounded-xl animate-pulse"></div>
                  </div>
                  <div class="space-y-2">
                    <div class="h-4 w-24 bg-slate-200 rounded animate-pulse"></div>
                    <div class="h-12 w-full bg-slate-100 rounded-xl animate-pulse"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Form Fields -->
            <div v-else class="space-y-8 animate-fade-in">
              <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
                <div class="grid grid-cols-2 gap-6">
                  <div class="space-y-2">
                    <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <User class="h-4 w-4 text-slate-400" />
                      Full Name
                    </label>
                    <input
                      :value="user.name"
                      type="text"
                      disabled
                      class="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 text-slate-500 cursor-not-allowed"
                      placeholder="Your full name"
                    />
                    <p class="text-xs text-slate-400">Managed by your Google account</p>
                  </div>
                  <div class="space-y-2">
                    <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <Building2 class="h-4 w-4 text-slate-400" />
                      Business Name
                    </label>
                    <input
                      v-model="profileData.businessName"
                      type="text"
                      class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none transition-all"
                      placeholder="Your business name"
                    />
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-6">
                  <div class="space-y-2">
                    <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <Mail class="h-4 w-4 text-slate-400" />
                      Email Address
                    </label>
                    <input
                      :value="user.email"
                      type="email"
                      disabled
                      class="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 text-slate-500 cursor-not-allowed"
                      placeholder="you@example.com"
                    />
                    <p class="text-xs text-slate-400">Managed by your Google account</p>
                  </div>
                  <div class="space-y-2">
                    <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <Phone class="h-4 w-4 text-slate-400" />
                      Phone Number
                    </label>
                    <input
                      v-model="profileData.phone"
                      type="tel"
                      class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none transition-all"
                      placeholder="+1 (555) 000-0000"
                    />
                  </div>
                </div>

                <!-- Error Message -->
                <div
                  v-if="profileError"
                  class="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm"
                >
                  {{ profileError }}
                </div>
              </div>

              <!-- Booking URL Section -->
              <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="font-semibold text-slate-900">Booking URL</h3>
                    <p class="text-sm text-slate-500">
                      Share this link with clients to let them book you directly.
                    </p>
                  </div>
                  <button
                    class="flex items-center gap-2 rounded-xl bg-indigo-50 text-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-100 transition-colors"
                    :disabled="isBookingUrlLoading"
                    @click="generateBookingUrl"
                  >
                    <LinkIcon v-if="!isBookingUrlLoading" class="h-4 w-4" />
                    <Loader2 v-else class="h-4 w-4 animate-spin" />
                    <span>Get Link</span>
                  </button>
                </div>
                <div v-if="bookingError" class="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                  {{ bookingError }}
                </div>
              </div>

              <!-- Save Button -->
              <div class="flex justify-end">
                <button
                  :disabled="isSavingProfile"
                  class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="saveProfile"
                >
                  <Loader2 v-if="isSavingProfile" class="w-4 h-4 animate-spin" />
                  <span>{{ isSavingProfile ? 'Saving...' : 'Save Changes' }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Watch Folder Section (renamed from Storage) -->
          <div v-if="activeTab === 'storage'" class="space-y-8 animate-fade-in">
            <!-- Section Header -->
            <div>
              <h2 class="text-2xl font-bold text-slate-900 mb-1">Watch Folder</h2>
              <p class="text-slate-500 text-sm">
                Set up a master folder to automatically detect and create albums from subfolders.
              </p>
            </div>

            <!-- Master Folder Card -->
            <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
              <div>
                <h3 class="font-semibold text-slate-900 mb-4">Master Watch Folder</h3>

                <!-- Loading State -->
                <div
                  v-if="isLoadingMasterFolder"
                  class="w-full bg-slate-50 border border-slate-200 rounded-2xl p-5"
                >
                  <div class="flex items-start gap-4">
                    <div class="w-12 h-12 rounded-xl bg-slate-200 animate-pulse"></div>
                    <div class="flex-1 space-y-2">
                      <div class="h-4 w-24 bg-slate-200 rounded animate-pulse"></div>
                      <div class="h-5 w-48 bg-slate-200 rounded animate-pulse"></div>
                    </div>
                  </div>
                </div>

                <div v-else>
                  <!-- Folder Display -->
                  <button
                    class="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl p-5 text-left transition-all hover:border-indigo-300 group"
                    :disabled="isSettingMasterFolder"
                    @click="selectMasterFolder"
                  >
                    <div class="flex items-start gap-4">
                      <div
                        class="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center group-hover:bg-violet-200 transition-colors"
                      >
                        <Eye class="w-6 h-6 text-violet-600" />
                      </div>

                      <div class="flex-1 min-w-0">
                        <div class="text-sm text-slate-400 mb-1">Watch Folder</div>
                        <div class="text-slate-900 font-medium truncate">
                          {{ masterFolder || 'Not configured' }}
                        </div>
                      </div>

                      <Loader2
                        v-if="isSettingMasterFolder"
                        class="w-5 h-5 text-indigo-500 animate-spin"
                      />
                    </div>
                  </button>

                  <p class="mt-3 text-xs text-slate-400">
                    Click to select a folder. Subfolders will automatically become albums.
                  </p>

                  <!-- Warning when changing existing folder -->
                  <div
                    v-if="masterFolder"
                    class="mt-4 flex items-start gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3"
                  >
                    <AlertTriangle class="w-4 h-4 shrink-0 mt-0.5" />
                    <span
                      >Changing the watch folder will stop tracking changes for albums in the
                      current folder.</span
                    >
                  </div>
                </div>
              </div>

              <!-- Open Folder Button -->
              <div v-if="masterFolder" class="pt-4 border-t border-slate-100">
                <button
                  class="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  @click="openMasterFolder"
                >
                  <Folder class="w-4 h-4" />
                  Open Watch Folder
                </button>
              </div>

              <!-- How it works -->
              <div class="pt-4 border-t border-slate-100">
                <h4 class="text-sm font-medium text-slate-700 mb-3">How it works</h4>
                <ul class="space-y-2 text-xs text-slate-500">
                  <li class="flex items-start gap-2">
                    <CheckCircle2 class="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>Create folders inside your watch folder for each event</span>
                  </li>
                  <li class="flex items-start gap-2">
                    <CheckCircle2 class="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>LumoSnap automatically creates albums from each subfolder</span>
                  </li>
                  <li class="flex items-start gap-2">
                    <CheckCircle2 class="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>Add photos to the folder and they'll sync automatically</span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Master Folder Error -->
            <div
              v-if="masterFolderError"
              class="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm"
            >
              {{ masterFolderError }}
            </div>
          </div>

          <!-- Change Storage Confirmation Modal -->
          <Teleport to="body">
            <Transition name="fade">
              <div
                v-if="showChangeConfirmation"
                class="fixed inset-0 z-50 flex items-center justify-center p-4"
              >
                <!-- Backdrop -->
                <div
                  class="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  @click="cancelChangeStorage"
                ></div>

                <!-- Modal -->
                <div class="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 z-10">
                  <button
                    class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
                    @click="cancelChangeStorage"
                  >
                    <X class="w-5 h-5 text-slate-400" />
                  </button>

                  <div class="flex items-start gap-4 mb-6">
                    <div
                      class="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0"
                    >
                      <AlertTriangle class="w-6 h-6 text-amber-600" />
                    </div>
                    <div>
                      <h3 class="text-lg font-bold text-slate-900 mb-2">
                        Change Storage Location?
                      </h3>
                      <p class="text-sm text-slate-500">
                        Changing the storage location will not move existing albums.
                        <strong class="text-slate-700"
                          >Albums in the old location will not be accessible from the app.</strong
                        >
                      </p>
                    </div>
                  </div>

                  <div class="bg-slate-50 rounded-xl p-4 mb-6">
                    <div class="text-xs text-slate-400 mb-1">New Location</div>
                    <div class="text-sm text-slate-900 font-medium truncate">
                      {{ pendingNewPath }}
                    </div>
                  </div>

                  <div class="flex gap-3">
                    <Button variant="secondary" class="flex-1" @click="cancelChangeStorage">
                      Cancel
                    </Button>
                    <button
                      class="flex-1 flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                      :disabled="isChangingStorage"
                      @click="confirmChangeStorage"
                    >
                      <span v-if="isChangingStorage">Changing...</span>
                      <span v-else>Change Location</span>
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </Teleport>

          <!-- Reset Confirmation Modal -->
          <Teleport to="body">
            <Transition name="fade">
              <div
                v-if="showResetConfirmation"
                class="fixed inset-0 z-50 flex items-center justify-center p-4"
              >
                <!-- Backdrop -->
                <div
                  class="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  @click="cancelReset"
                ></div>

                <!-- Modal -->
                <div class="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 z-10">
                  <button
                    class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
                    @click="cancelReset"
                  >
                    <X class="w-5 h-5 text-slate-400" />
                  </button>

                  <div class="flex items-start gap-4 mb-6">
                    <div
                      class="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0"
                    >
                      <Trash2 class="w-6 h-6 text-red-600" />
                    </div>
                    <div>
                      <h3 class="text-lg font-bold text-slate-900 mb-2">
                        Reset All Data?
                      </h3>
                      <p class="text-sm text-slate-500">
                        This will permanently delete all albums from cloud and local storage,
                        compressed images, settings, and your login session.
                        <strong class="text-slate-700">This cannot be undone.</strong>
                      </p>
                    </div>
                  </div>

                  <!-- Error Display -->
                  <div
                    v-if="resetError"
                    class="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-600"
                  >
                    {{ resetError }}
                  </div>

                  <div class="flex gap-3">
                    <Button variant="secondary" class="flex-1" @click="cancelReset">
                      Cancel
                    </Button>
                    <button
                      class="flex-1 flex items-center justify-center gap-2 rounded-xl bg-red-500 hover:bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                      :disabled="isResetting"
                      @click="confirmResetAllData"
                    >
                      <Loader2 v-if="isResetting" class="w-4 h-4 animate-spin" />
                      <span v-if="isResetting">Resetting...</span>
                      <span v-else>Reset All Data</span>
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </Teleport>

          <!-- Billing Section -->
          <div v-if="activeTab === 'billing'" class="space-y-8 animate-fade-in">
            <!-- Section Header -->
            <div>
              <h2 class="text-2xl font-bold text-slate-900 mb-1">Billing & Plan</h2>
              <p class="text-slate-500 text-sm">
                View your subscription and request plan upgrades.
              </p>
            </div>

            <!-- Current Plan Card -->
            <div
              class="bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 border border-indigo-100 rounded-2xl p-6 relative overflow-hidden"
            >
              <!-- Decorative circles -->
              <div
                class="absolute -top-10 -right-10 w-40 h-40 bg-indigo-200/30 rounded-full blur-2xl"
              ></div>
              <div
                class="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-200/30 rounded-full blur-2xl"
              ></div>

              <div class="relative">
                <div class="flex justify-between items-start mb-4">
                  <div>
                    <h3 class="font-bold text-slate-900 text-xl mb-1">
                      {{ profileStore.profile?.planName || 'Loading...' }}
                    </h3>
                    <p class="text-slate-500 text-sm flex items-center gap-2">
                      <Clock class="w-4 h-4" />
                      Expires: {{ formatExpiryDate(profileStore.profile?.planExpiry || null) }}
                    </p>
                  </div>
                  <span
                    class="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-1"
                  >
                    <CheckCircle2 class="h-3 w-3" />
                    Active
                  </span>
                </div>

                <!-- Usage Stats -->
                <div class="flex items-center gap-3 mb-3">
                  <div class="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center">
                    <ImageIcon class="w-5 h-5 text-indigo-600" />
                  </div>
                  <div class="flex-1">
                    <div class="flex justify-between text-sm mb-1">
                      <span class="text-slate-600 font-medium">Images</span>
                      <span class="font-semibold text-slate-900">
                        {{ (profileStore.profile?.totalImages || 0).toLocaleString() }} /
                        {{ (profileStore.profile?.imageLimit || 500).toLocaleString() }}
                      </span>
                    </div>
                    <div class="h-2.5 bg-white/50 rounded-full overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all duration-500"
                        :class="
                          profileStore.isAtLimit
                            ? 'bg-red-500'
                            : profileStore.isNearLimit
                              ? 'bg-amber-500'
                              : 'bg-gradient-to-r from-indigo-500 to-purple-500'
                        "
                        :style="{ width: `${profileStore.usagePercentage}%` }"
                      ></div>
                    </div>
                  </div>
                </div>

                <!-- Limit Warning -->
                <div
                  v-if="profileStore.isAtLimit"
                  class="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mt-4"
                >
                  <AlertTriangle class="w-5 h-5 text-red-500 shrink-0" />
                  <div>
                    <p class="text-sm font-medium text-red-800">You've reached your image limit</p>
                    <p class="text-xs text-red-600">Upgrade your plan to upload more images.</p>
                  </div>
                </div>
                <div
                  v-else-if="profileStore.isNearLimit"
                  class="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-4"
                >
                  <AlertTriangle class="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <p class="text-sm font-medium text-amber-800">You're running low on space</p>
                    <p class="text-xs text-amber-600">
                      Only {{ profileStore.remainingImages.toLocaleString() }} images remaining.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Available Plans -->
            <div class="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 class="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Sparkles class="w-5 h-5 text-indigo-500" />
                Available Plans
              </h3>

              <!-- Loading State -->
              <div v-if="isLoadingPlans" class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div
                  v-for="i in 3"
                  :key="i"
                  class="border border-slate-200 rounded-xl p-4 transition-all"
                >
                  <div class="h-6 w-24 bg-slate-200 rounded animate-pulse mb-3"></div>
                  <div class="h-8 w-20 bg-slate-200 rounded animate-pulse mb-1"></div>
                  <div class="h-4 w-16 bg-slate-200 rounded animate-pulse mb-3"></div>
                  <div class="h-4 w-full bg-slate-200 rounded animate-pulse mb-4"></div>
                  <div class="h-10 w-full bg-slate-200 rounded animate-pulse"></div>
                </div>
              </div>

              <!-- Plans Grid -->
              <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div
                  v-for="plan in availablePlans"
                  :key="plan.id"
                  class="border rounded-xl p-4 transition-all"
                  :class="
                    isCurrentPlan(plan)
                      ? 'border-indigo-300 bg-indigo-50/50'
                      : 'border-slate-200 hover:border-indigo-200'
                  "
                >
                  <div class="flex items-start justify-between mb-2">
                    <h4 class="font-semibold text-slate-900">{{ plan.displayName }}</h4>
                    <span
                      v-if="isCurrentPlan(plan)"
                      class="text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full"
                    >
                      Current
                    </span>
                  </div>
                  <p class="text-2xl font-bold text-slate-900 mb-1">
                    {{ formatPrice(plan.priceMonthly) }}
                    <span
                      v-if="plan.priceMonthly !== '0'"
                      class="text-sm font-normal text-slate-500"
                      >/mo</span
                    >
                  </p>
                  <p class="text-xs text-slate-500 mb-3">
                    {{ plan.imageLimit.toLocaleString() }} images
                  </p>
                  <p class="text-xs text-slate-600 mb-4">{{ plan.description }}</p>

                  <button
                    v-if="!isCurrentPlan(plan) && isPlanUpgrade(plan)"
                    :disabled="isRequestingUpgrade && selectedPlanId === plan.id"
                    class="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white hover:shadow-lg transition-all disabled:opacity-50"
                    @click="requestUpgrade(plan.id)"
                  >
                    <Loader2
                      v-if="isRequestingUpgrade && selectedPlanId === plan.id"
                      class="w-4 h-4 animate-spin"
                    />
                    <span>{{
                      isRequestingUpgrade && selectedPlanId === plan.id
                        ? 'Requesting...'
                        : 'Request Upgrade'
                    }}</span>
                  </button>
                  <div
                    v-else-if="isCurrentPlan(plan)"
                    class="w-full text-center py-2 text-sm text-indigo-600 font-medium"
                  >
                    Your current plan
                  </div>
                </div>
              </div>

              <!-- Upgrade Success -->
              <div
                v-if="upgradeSuccess"
                class="mt-4 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3"
              >
                <CheckCircle2 class="w-5 h-5 text-emerald-500" />
                <p class="text-sm text-emerald-700">
                  Upgrade request submitted! We'll review it shortly.
                </p>
              </div>

              <!-- Upgrade Error -->
              <div
                v-if="upgradeError"
                class="mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3"
              >
                <AlertTriangle class="w-5 h-5 text-red-500" />
                <p class="text-sm text-red-700">{{ upgradeError }}</p>
              </div>
            </div>
          </div>

          <!-- Advanced Section -->
          <div v-if="activeTab === 'advanced'" class="space-y-8 animate-fade-in">
            <!-- Section Header -->
            <div>
              <h2 class="text-2xl font-bold text-slate-900 mb-1">Advanced Settings</h2>
              <p class="text-slate-500 text-sm">
                Configure internal storage and other advanced options.
              </p>
            </div>

            <!-- Storage Location Card -->
            <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
              <div>
                <h3 class="font-semibold text-slate-900 mb-2">Internal Storage Location</h3>
                <p class="text-xs text-slate-400 mb-4">
                  Where LumoSnap stores compressed images before uploading.
                </p>

                <!-- Loading State -->
                <div
                  v-if="isLoadingStorage"
                  class="w-full bg-slate-50 border border-slate-200 rounded-2xl p-5"
                >
                  <div class="flex items-start gap-4">
                    <div class="w-12 h-12 rounded-xl bg-slate-200 animate-pulse"></div>
                    <div class="flex-1 space-y-2">
                      <div class="h-4 w-24 bg-slate-200 rounded animate-pulse"></div>
                      <div class="h-5 w-48 bg-slate-200 rounded animate-pulse"></div>
                    </div>
                  </div>
                </div>

                <!-- Storage Location Display -->
                <div v-else>
                  <button
                    class="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl p-5 text-left transition-all hover:border-indigo-300 group"
                    @click="selectNewFolder"
                  >
                    <div class="flex items-start gap-4">
                      <div
                        class="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center group-hover:bg-indigo-200 transition-colors"
                      >
                        <HardDrive class="w-6 h-6 text-indigo-600" />
                      </div>

                      <div class="flex-1 min-w-0">
                        <div class="text-sm text-slate-400 mb-1">Current Location</div>
                        <div class="text-slate-900 font-medium truncate">
                          {{ storageLocation || 'Not configured' }}
                        </div>
                      </div>
                    </div>
                  </button>

                  <p class="mt-3 text-xs text-slate-400">Click to change the storage location.</p>
                </div>
              </div>

              <!-- Free Space Indicator -->
              <div
                v-if="storageLocation && !isLoadingStorage"
                class="pt-4 border-t border-slate-100"
              >
                <div class="flex items-center gap-4">
                  <div
                    class="w-12 h-12 rounded-xl flex items-center justify-center"
                    :class="isLowStorage ? 'bg-amber-100' : 'bg-emerald-100'"
                  >
                    <HardDrive
                      class="w-6 h-6"
                      :class="isLowStorage ? 'text-amber-600' : 'text-emerald-600'"
                    />
                  </div>

                  <div class="flex-1">
                    <div class="text-sm text-slate-400">Available Space</div>
                    <div
                      class="text-lg font-bold"
                      :class="isLowStorage ? 'text-amber-600' : 'text-slate-900'"
                    >
                      {{ freeSpace || 'Unknown' }}
                    </div>
                  </div>
                </div>

                <!-- Low Storage Warning -->
                <div
                  v-if="isLowStorage"
                  class="mt-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4"
                >
                  <AlertTriangle class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p class="text-sm font-medium text-amber-800">You're running out of space</p>
                    <p class="text-xs text-amber-600 mt-1">
                      Consider freeing up space or changing to a different storage location.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-if="storageError"
              class="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm"
            >
              {{ storageError }}
            </div>

            <!-- Reset All Data Card -->
            <div class="bg-white rounded-2xl border border-red-200 p-6 space-y-4">
              <div class="flex items-center gap-3 mb-2">
                <div class="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                  <Trash2 class="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 class="font-semibold text-slate-900">Reset All Data</h3>
                  <p class="text-xs text-slate-500">
                    Delete all local data and start fresh
                  </p>
                </div>
              </div>

              <div class="bg-red-50 border border-red-100 rounded-xl p-4">
                <p class="text-sm text-red-800 mb-2 font-medium">
                  This will permanently delete:
                </p>
                <ul class="text-xs text-red-700 space-y-1">
                  <li class="flex items-center gap-2">
                    <span class="w-1 h-1 bg-red-400 rounded-full"></span>
                    All albums from cloud and local storage
                  </li>
                  <li class="flex items-center gap-2">
                    <span class="w-1 h-1 bg-red-400 rounded-full"></span>
                    All uploaded and compressed images
                  </li>
                  <li class="flex items-center gap-2">
                    <span class="w-1 h-1 bg-red-400 rounded-full"></span>
                    App configuration and settings
                  </li>
                  <li class="flex items-center gap-2">
                    <span class="w-1 h-1 bg-red-400 rounded-full"></span>
                    Your login session
                  </li>
                </ul>
                <p class="text-xs text-red-600 mt-3 flex items-start gap-2">
                  <AlertTriangle class="w-4 h-4 shrink-0 mt-0.5" />
                  <span>This action cannot be undone.</span>
                </p>
              </div>

              <button
                class="w-full flex items-center justify-center gap-2 rounded-xl bg-red-500 hover:bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors"
                @click="showResetConfirmation = true"
              >
                <Trash2 class="w-4 h-4" />
                Reset All Data
              </button>
            </div>

            </div>
            <!-- Updates Section -->
          <div v-if="activeTab === 'updates'" class="space-y-8 animate-fade-in">
            <!-- Section Header -->
            <div>
              <h2 class="text-2xl font-bold text-slate-900 mb-1">App Updates</h2>
              <p class="text-slate-500 text-sm">
                Check for new features and improvements.
              </p>
            </div>

            <!-- App Updates Card -->
            <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
              
              <!-- Version Info -->
               <div class="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div class="h-12 w-12 bg-white rounded-lg border border-slate-200 flex items-center justify-center shadow-sm">
                   <img :src="appLogo" alt="Logo" class="h-8 w-8 object-contain opactiy-90" />
                </div>
                <div>
                   <p class="text-sm font-medium text-slate-500">Current Version</p>
                   <p class="text-xl font-bold text-slate-900">v{{ appVersion }}</p>
                </div>
              </div>

              <div class="flex items-center justify-between pt-4 border-t border-slate-100">
                <div>
                  <h3 class="font-semibold text-slate-900">Check for Updates</h3>
                  <p class="text-xs text-slate-400">
                    See if a newer version of LumoSnap is available.
                  </p>
                </div>
                <button
                  class="flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-200 hover:shadow-lg hover:shadow-indigo-300"
                  @click="checkForUpdates"
                >
                  <RefreshCw
                    class="h-4 w-4"
                    :class="{ 'animate-spin': updateStatus && !updateAvailable }"
                  />
                  <span>Check Now</span>
                </button>
              </div>

              <div v-if="updateStatus" class="bg-indigo-50 border border-indigo-100 rounded-xl p-4 animate-fade-in">
                <div class="flex items-center gap-3">
                  <Download v-if="updateAvailable" class="h-5 w-5 text-indigo-600" />
                  <div class="flex-1">
                    <p class="text-sm font-medium text-indigo-900">{{ updateStatus }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>

      </main>
      <Teleport to="body">
        <Transition name="fade">
          <Modal :show="showBookingModal" @close="showBookingModal = false">
            <div class="p-6">
              <h3 class="text-xl font-bold text-slate-900 mb-2">Booking URL Generated</h3>
              <p class="text-slate-500 mb-6">
                Share this URL with your clients so they can book you directly.
              </p>

              <div
                class="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 flex items-center gap-3"
              >
                <div class="flex-1 font-mono text-sm text-slate-600 truncate select-all">
                  {{ bookingUrl }}
                </div>
                <button
                  class="p-2 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 text-slate-400 hover:text-indigo-500"
                  title="Copy to clipboard"
                  @click="copyBookingUrl"
                >
                  <Check v-if="bookingUrlCopied" class="w-4 h-4 text-emerald-500" />
                  <Copy v-else class="w-4 h-4" />
                </button>
              </div>

              <div class="flex gap-3">
                <Button variant="secondary" class="flex-1" @click="showBookingModal = false">
                  Close
                </Button>
                <button
                  class="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-sm font-semibold transition-colors"
                  @click="openBookingUrl"
                >
                  <ExternalLink class="w-4 h-4 text-white" />
                  Open Link
                </button>
              </div>
            </div>
          </Modal>
        </Transition>
      </Teleport>
    </div>
  </AppLayout>
</template>

<style>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-out forwards;
}

/* Modal transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
