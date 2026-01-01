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
  ArrowLeft
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const profileStore = useProfileStore()

const activeTab = ref('profile')

const tabs = [
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'billing', label: 'Billing & Plan', icon: CreditCard }
]

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

// Use auth store user data
const user = computed(() => ({
  name: authStore.user?.name || '',
  email: authStore.user?.email || ''
}))

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

async function handleLogout(): Promise<void> {
  await authStore.logout()
  router.push('/login')
}

onMounted(() => {
  loadStorageInfo()
  loadProfileData()
})
</script>

<template>
  <AppLayout :show-sidebar="false">
    <div class="flex h-full overflow-hidden bg-slate-50 text-slate-900">
      <!-- Left Sidebar -->
      <aside
        class="w-80 border-r border-slate-200 bg-white p-6 flex flex-col shrink-0 shadow-sm"
      >
        <!-- Header -->
        <div class="mb-8">
          <div class="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2">
            Account
          </div>
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
              <p class="text-slate-500 text-sm">
                This will be displayed on your shared albums.
              </p>
            </div>

            <!-- Loading State -->
            <div v-if="isLoadingProfile" class="flex items-center justify-center py-12">
              <Loader2 class="w-8 h-8 text-indigo-500 animate-spin" />
            </div>

            <!-- Form Fields -->
            <div v-else class="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
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

          <!-- Storage Section -->
          <div v-if="activeTab === 'storage'" class="space-y-8 animate-fade-in">
            <!-- Section Header -->
            <div>
              <h2 class="text-2xl font-bold text-slate-900 mb-1">Storage Settings</h2>
              <p class="text-slate-500 text-sm">
                Manage where LumoSnap stores your compressed images.
              </p>
            </div>

            <!-- Current Storage Location -->
            <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
              <div>
                <h3 class="font-semibold text-slate-900 mb-4">Storage Location</h3>
                
                <!-- Loading State -->
                <div v-if="isLoadingStorage" class="flex items-center gap-3 text-slate-500">
                  <div class="w-5 h-5 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin"></div>
                  <span>Loading storage info...</span>
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
                        <Folder class="w-6 h-6 text-indigo-600" />
                      </div>

                      <div class="flex-1 min-w-0">
                        <div class="text-sm text-slate-400 mb-1">Current Location</div>
                        <div class="text-slate-900 font-medium truncate">
                          {{ storageLocation || 'Not configured' }}
                        </div>
                      </div>
                    </div>
                  </button>

                  <p class="mt-3 text-xs text-slate-400">
                    Click to change the storage location. 
                  </p>
                </div>
              </div>

              <!-- Free Space Indicator -->
              <div v-if="storageLocation && !isLoadingStorage" class="pt-4 border-t border-slate-100">
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

            <!-- Storage Error -->
            <div
              v-if="storageError"
              class="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm"
            >
              {{ storageError }}
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
                    <div class="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                      <AlertTriangle class="w-6 h-6 text-amber-600" />
                    </div>
                    <div>
                      <h3 class="text-lg font-bold text-slate-900 mb-2">Change Storage Location?</h3>
                      <p class="text-sm text-slate-500">
                        Changing the storage location will not move existing albums. 
                        <strong class="text-slate-700">Albums in the old location will not be accessible from the app.</strong>
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
                    <Button
                      variant="secondary"
                      class="flex-1"
                      @click="cancelChangeStorage"
                    >
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

          <!-- Billing Section -->
          <div v-if="activeTab === 'billing'" class="space-y-8 animate-fade-in">
            <!-- Section Header -->
            <div>
              <h2 class="text-2xl font-bold text-slate-900 mb-1">Billing & Plan</h2>
              <p class="text-slate-500 text-sm">
                Manage your subscription and payment methods.
              </p>
            </div>

            <!-- Current Plan Card -->
            <div
              class="bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 border border-indigo-100 rounded-2xl p-6 relative overflow-hidden"
            >
              <!-- Decorative circles -->
              <div class="absolute -top-10 -right-10 w-40 h-40 bg-indigo-200/30 rounded-full blur-2xl"></div>
              <div class="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-200/30 rounded-full blur-2xl"></div>
              
              <div class="relative">
                <div class="flex justify-between items-start mb-6">
                  <div>
                    <h3 class="font-bold text-slate-900 text-xl mb-1">Pro Plan</h3>
                    <p class="text-slate-500 text-sm">Billed annually</p>
                  </div>
                  <span
                    class="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-1"
                  >
                    <CheckCircle2 class="h-3 w-3" />
                    Active
                  </span>
                </div>

                <div class="flex items-baseline gap-1 mb-6">
                  <span class="text-4xl font-bold text-slate-900">$29</span>
                  <span class="text-slate-500">/month</span>
                </div>

                <div class="flex gap-3">
                  <button
                    class="flex-1 flex items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                  >
                    Manage Subscription
                  </button>
                  <button
                    class="flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors shadow-sm"
                  >
                    Upgrade
                  </button>
                </div>
              </div>
            </div>

            <!-- Usage Stats -->
            <div class="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 class="font-semibold text-slate-900 mb-4">Current Usage</h3>
              <div class="space-y-4">
                <!-- Images Usage -->
                <div>
                  <div class="flex items-center gap-3 mb-3">
                    <div class="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                      <ImageIcon class="w-5 h-5 text-indigo-600" />
                    </div>
                    <div class="flex-1">
                      <div class="flex justify-between text-sm mb-1">
                        <span class="text-slate-600 font-medium">Images</span>
                        <span class="font-semibold text-slate-900">
                          {{ (profileStore.profile?.totalImages || 0).toLocaleString() }} / {{ (profileStore.profile?.globalMaxImages || 50000).toLocaleString() }}
                        </span>
                      </div>
                      <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                          :style="{ width: `${Math.min(((profileStore.profile?.totalImages || 0) / (profileStore.profile?.globalMaxImages || 50000)) * 100, 100)}%` }"
                        ></div>
                      </div>
                    </div>
                  </div>
                  <p class="text-xs text-slate-400 ml-[52px]">
                    {{ Math.round(((profileStore.profile?.totalImages || 0) / (profileStore.profile?.globalMaxImages || 50000)) * 100) }}% of your image quota used
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
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
