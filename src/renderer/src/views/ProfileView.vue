<script setup lang="ts">
import { ref } from 'vue'
import AppLayout from '../layouts/AppLayout.vue'
import Button from '../components/ui/Button.vue'

const activeTab = ref('profile')

const tabs = [
  { id: 'profile', label: 'My Profile', icon: 'UserIcon' },
  { id: 'billing', label: 'Billing & Plan', icon: 'CreditCardIcon' },
  { id: 'security', label: 'Security', icon: 'LockClosedIcon' },
  { id: 'notifications', label: 'Notifications', icon: 'BellIcon' }
]

const user = ref({
  name: 'Alex Photographer',
  email: 'alex@lumosnap.com',
  company: 'Alex Shots Studio',
  website: 'www.alexshots.com'
})
</script>

<template>
  <AppLayout>
    <div class="flex h-full">
      <!-- Internal Sidebar -->
      <div class="w-64 border-r border-gray-200 p-6 flex flex-col gap-2">
        <h2 class="text-xl font-bold text-gray-900 mb-6">Settings</h2>

        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          class="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium"
          :class="
            activeTab === tab.id
              ? 'bg-[var(--color-turquoise)] text-white shadow-lg shadow-teal-500/20'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
          "
        >
          <!-- Icons would go here -->
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 p-8 overflow-y-auto">
        <div class="max-w-2xl">
          <!-- Profile Section -->
          <div v-if="activeTab === 'profile'" class="space-y-8">
            <div>
              <h3 class="text-lg font-bold text-gray-900 mb-1">Public Profile</h3>
              <p class="text-gray-500 text-sm">This will be displayed on your shared albums.</p>
            </div>

            <div class="flex items-center gap-6">
              <div
                class="w-24 h-24 rounded-full bg-gradient-to-tr from-[var(--color-turquoise)] to-[var(--color-deep-teal)] border-4 border-white shadow-lg"
              ></div>
              <div>
                <Button variant="secondary" size="sm" class="mb-2">Change Avatar</Button>
                <p class="text-xs text-gray-400">JPG, GIF or PNG. Max 1MB.</p>
              </div>
            </div>

            <div class="grid gap-6">
              <div class="grid grid-cols-2 gap-6">
                <div class="space-y-1.5">
                  <label class="text-sm font-medium text-gray-700">Full Name</label>
                  <input
                    v-model="user.name"
                    type="text"
                    class="w-full bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-gray-900 focus:border-[var(--color-turquoise)] focus:ring-2 focus:ring-[var(--color-turquoise)]/20 outline-none transition-all"
                  />
                </div>
                <div class="space-y-1.5">
                  <label class="text-sm font-medium text-gray-700">Company Name</label>
                  <input
                    v-model="user.company"
                    type="text"
                    class="w-full bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-gray-900 focus:border-[var(--color-turquoise)] focus:ring-2 focus:ring-[var(--color-turquoise)]/20 outline-none transition-all"
                  />
                </div>
              </div>

              <div class="space-y-1.5">
                <label class="text-sm font-medium text-gray-700">Email Address</label>
                <input
                  v-model="user.email"
                  type="email"
                  class="w-full bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-gray-900 focus:border-[var(--color-turquoise)] focus:ring-2 focus:ring-[var(--color-turquoise)]/20 outline-none transition-all"
                />
              </div>

              <div class="space-y-1.5">
                <label class="text-sm font-medium text-gray-700">Website</label>
                <div class="flex">
                  <span
                    class="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-200 bg-gray-50 text-gray-500 text-sm"
                    >https://</span
                  >
                  <input
                    v-model="user.website"
                    type="text"
                    class="flex-1 bg-white border border-gray-200 rounded-r-lg px-4 py-2.5 text-gray-900 focus:border-[var(--color-turquoise)] focus:ring-2 focus:ring-[var(--color-turquoise)]/20 outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            <div class="pt-6 border-t border-gray-100 flex justify-end">
              <Button variant="primary">Save Changes</Button>
            </div>
          </div>

          <!-- Billing Section -->
          <div v-if="activeTab === 'billing'" class="space-y-8">
            <div
              class="bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-100 rounded-2xl p-6"
            >
              <div class="flex justify-between items-start mb-4">
                <div>
                  <h4 class="font-bold text-gray-900 text-lg">Pro Plan</h4>
                  <p class="text-gray-500 text-sm">Billed annually</p>
                </div>
                <span
                  class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide"
                  >Active</span
                >
              </div>
              <div class="flex items-baseline gap-1 mb-6">
                <span class="text-3xl font-bold text-gray-900">$29</span>
                <span class="text-gray-500">/month</span>
              </div>
              <Button variant="outline" class="w-full justify-center bg-white hover:bg-gray-50"
                >Manage Subscription</Button
              >
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
