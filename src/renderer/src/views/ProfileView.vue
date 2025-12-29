<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Button from '../components/ui/Button.vue'
import { useAuthStore } from '../stores/auth'
import {
  User,
  CreditCard,
  Lock,
  Bell,
  LogOut,
  CheckCircle2,
  Camera,
  Globe,
  Mail,
  Building2
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const activeTab = ref('profile')

const tabs = [
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'billing', label: 'Billing & Plan', icon: CreditCard },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'notifications', label: 'Notifications', icon: Bell }
]

// Use auth store user data with fallbacks for editable fields
const user = computed(() => ({
  name: authStore.user?.name || '',
  email: authStore.user?.email || '',
  company: '',
  website: ''
}))

async function handleLogout(): Promise<void> {
  await authStore.logout()
  router.push('/login')
}
</script>

<template>
  <AppLayout>
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
                  class="flex items-center gap-1 text-emerald-600 text-[10px] font-medium bg-emerald-50 px-2 py-0.5 rounded-full"
                >
                  <CheckCircle2 class="h-3 w-3" />
                  Synced
                </div>
              </div>
              <p class="text-slate-500 text-sm">
                This will be displayed on your shared albums.
              </p>
            </div>

            <!-- Avatar Section -->
            <div
              class="bg-white rounded-2xl border border-slate-200 p-6 flex items-center gap-6"
            >
              <div class="relative">
                <div
                  class="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25 flex items-center justify-center text-white text-3xl font-bold"
                >
                  {{ user.name.charAt(0).toUpperCase() || '?' }}
                </div>
                <button
                  class="absolute -bottom-1 -right-1 w-8 h-8 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-sm hover:bg-slate-50 transition-colors"
                >
                  <Camera class="h-4 w-4 text-slate-500" />
                </button>
              </div>
              <div>
                <h3 class="font-semibold text-slate-900 mb-1">Profile Photo</h3>
                <p class="text-xs text-slate-400 mb-3">
                  JPG, GIF or PNG. Max 1MB.
                </p>
                <Button variant="secondary" size="sm">Upload New Photo</Button>
              </div>
            </div>

            <!-- Form Fields -->
            <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
              <div class="grid grid-cols-2 gap-6">
                <div class="space-y-2">
                  <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <User class="h-4 w-4 text-slate-400" />
                    Full Name
                  </label>
                  <input
                    v-model="user.name"
                    type="text"
                    class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none transition-all"
                    placeholder="Your full name"
                  />
                </div>
                <div class="space-y-2">
                  <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Building2 class="h-4 w-4 text-slate-400" />
                    Company Name
                  </label>
                  <input
                    v-model="user.company"
                    type="text"
                    class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none transition-all"
                    placeholder="Your company"
                  />
                </div>
              </div>

              <div class="space-y-2">
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Mail class="h-4 w-4 text-slate-400" />
                  Email Address
                </label>
                <input
                  v-model="user.email"
                  type="email"
                  class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none transition-all"
                  placeholder="you@example.com"
                />
              </div>

              <div class="space-y-2">
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Globe class="h-4 w-4 text-slate-400" />
                  Website
                </label>
                <div class="flex">
                  <span
                    class="inline-flex items-center px-4 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-slate-500 text-sm font-medium"
                  >
                    https://
                  </span>
                  <input
                    v-model="user.website"
                    type="text"
                    class="flex-1 bg-slate-50 border border-slate-200 rounded-r-xl px-4 py-3 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none transition-all"
                    placeholder="yourwebsite.com"
                  />
                </div>
              </div>
            </div>

            <!-- Save Button -->
            <div class="flex justify-end">
              <button
                class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5"
              >
                Save Changes
              </button>
            </div>
          </div>

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
                <div>
                  <div class="flex justify-between text-sm mb-2">
                    <span class="text-slate-600">Storage</span>
                    <span class="font-medium text-slate-900">4.2 GB / 50 GB</span>
                  </div>
                  <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div class="h-full w-[8%] bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"></div>
                  </div>
                </div>
                <div>
                  <div class="flex justify-between text-sm mb-2">
                    <span class="text-slate-600">Albums</span>
                    <span class="font-medium text-slate-900">12 / Unlimited</span>
                  </div>
                  <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div class="h-full w-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Security Section -->
          <div v-if="activeTab === 'security'" class="space-y-8 animate-fade-in">
            <div>
              <h2 class="text-2xl font-bold text-slate-900 mb-1">Security</h2>
              <p class="text-slate-500 text-sm">
                Manage your password and security settings.
              </p>
            </div>

            <div class="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 class="font-semibold text-slate-900 mb-4">Password</h3>
              <p class="text-slate-500 text-sm mb-4">
                You're signed in with Google. Password management is handled through your Google account.
              </p>
              <Button variant="secondary" size="sm">Manage Google Account</Button>
            </div>
          </div>

          <!-- Notifications Section -->
          <div v-if="activeTab === 'notifications'" class="space-y-8 animate-fade-in">
            <div>
              <h2 class="text-2xl font-bold text-slate-900 mb-1">Notifications</h2>
              <p class="text-slate-500 text-sm">
                Choose what updates you want to receive.
              </p>
            </div>

            <div class="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div class="flex items-center justify-between py-3 border-b border-slate-100">
                <div>
                  <h4 class="font-medium text-slate-900">Email notifications</h4>
                  <p class="text-sm text-slate-500">Receive emails about album activity</p>
                </div>
                <button class="w-12 h-7 bg-indigo-500 rounded-full relative transition-colors">
                  <span class="absolute right-1 top-1 w-5 h-5 bg-white rounded-full shadow-sm"></span>
                </button>
              </div>
              <div class="flex items-center justify-between py-3">
                <div>
                  <h4 class="font-medium text-slate-900">Marketing emails</h4>
                  <p class="text-sm text-slate-500">News about product updates and features</p>
                </div>
                <button class="w-12 h-7 bg-slate-200 rounded-full relative transition-colors">
                  <span class="absolute left-1 top-1 w-5 h-5 bg-white rounded-full shadow-sm"></span>
                </button>
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
</style>
