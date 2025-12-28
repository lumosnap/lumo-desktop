<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AuthLayout from '../layouts/AuthLayout.vue'
import { ExternalLink, Loader2 } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const handleConnect = async (): Promise<void> => {
  try {
    await authStore.startAuth()
    router.push('/albums')
  } catch (e: unknown) {
    // Error is already set in the store
    console.error('Auth failed:', e)
  }
}

const handleCancel = (): void => {
  // Reset the loading state - the server will timeout on its own
  authStore.loading = false
  authStore.error = 'Authentication cancelled. You can try again.'
}
</script>

<template>
  <AuthLayout>
    <div class="text-center mb-12">
      <!-- Logo -->
      <div class="mb-8">
        <div
          class="w-20 h-20 mx-auto bg-gradient-to-br from-[#2DD4BF] to-[#14B8A6] rounded-2xl flex items-center justify-center shadow-lg shadow-[#2DD4BF]/20"
        >
          <svg
            class="w-10 h-10 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      </div>

      <h1 class="text-3xl font-bold text-white mb-3">LumoSnap Desktop</h1>
      <p class="text-gray-400 max-w-xs mx-auto">
        Compress and share thousands of photos with your clients effortlessly.
      </p>
    </div>

    <!-- Loading State -->
    <div v-if="authStore.loading" class="space-y-4">
      <div
        class="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-800 text-gray-300 font-semibold rounded-xl"
      >
        <Loader2 class="w-5 h-5 animate-spin" />
        <span>Waiting for browser authentication...</span>
      </div>
      <button
        type="button"
        class="w-full px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-xl transition-colors text-sm"
        @click="handleCancel"
      >
        Cancel
      </button>
      <p class="text-center text-gray-500 text-xs">
        Complete the sign-in in your browser, then return here.
      </p>
    </div>

    <!-- Connect Button -->
    <button
      v-else
      type="button"
      class="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-[#2DD4BF] to-[#14B8A6] hover:from-[#14B8A6] hover:to-[#0D9488] text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-[#2DD4BF]/20 hover:shadow-xl hover:shadow-[#2DD4BF]/30"
      @click="handleConnect"
    >
      <ExternalLink class="w-5 h-5" />
      <span>Connect to LumoSnap</span>
    </button>

    <!-- Error Message -->
    <div
      v-if="authStore.error"
      class="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center"
    >
      {{ authStore.error }}
    </div>

    <!-- Info Text -->
    <p v-if="!authStore.loading" class="text-center text-gray-500 text-sm mt-8">
      You'll be redirected to your browser to sign in securely.
    </p>
  </AuthLayout>
</template>
