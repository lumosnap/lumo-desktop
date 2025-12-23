<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from '../components/ui/Button.vue'
import { Folder, HardDrive } from 'lucide-vue-next'

const router = useRouter()
const selectedPath = ref<string | null>(null)
const freeSpace = ref<string>('')
const isLoading = ref(false)
const error = ref<string | null>(null)

async function selectFolder(): Promise<void> {
  try {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      selectedPath.value = path

      // Get free space for selected path
      const result = await window.api.config.getFreeSpace(path)
      if (result.error) {
        error.value = result.error
      } else {
        freeSpace.value = result.formatted
      }
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to select folder'
  }
}

async function confirmSetup(): Promise<void> {
  if (!selectedPath.value) {
    error.value = 'Please select a storage location'
    return
  }

  isLoading.value = true
  error.value = null

  try {
    const result = await window.api.config.setStorageLocation(selectedPath.value)
    if (result.success) {
      // Navigate to albums page
      router.push('/albums')
    } else {
      error.value = result.error || 'Failed to set storage location'
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to configure storage'
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  // Check if already configured
  const configured = await window.api.config.isConfigured()
  if (configured) {
    router.push('/albums')
  }
})
</script>

<template>
  <div
    class="min-h-screen bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a] flex items-center justify-center p-8"
  >
    <div class="max-w-2xl w-full">
      <!-- Logo and header -->
      <div class="text-center mb-12">
        <h1 class="text-5xl font-bold text-white mb-4">Welcome to LumoSnap</h1>
        <p class="text-xl text-gray-400">Let's set up your photo storage location</p>
      </div>

      <!-- Setup card -->
      <div class="bg-[#1e1e1e] border border-[#2a2a2a] rounded-3xl p-12 shadow-2xl">
        <div class="mb-8">
          <h2 class="text-2xl font-bold text-white mb-3">Choose Storage Location</h2>
          <p class="text-gray-400">
            Select a folder where LumoSnap will store compressed images and albums. Make sure you
            have enough free space.
          </p>
        </div>

        <!-- Folder selection -->
        <div class="space-y-6">
          <button
            class="w-full bg-[#252525] hover:bg-[#2a2a2a] border border-[#333] rounded-2xl p-6 text-left transition-all hover:border-[var(--color-turquoise)] group"
            @click="selectFolder"
          >
            <div class="flex items-start gap-4">
              <div
                class="w-14 h-14 rounded-xl bg-[var(--color-turquoise)]/10 flex items-center justify-center group-hover:bg-[var(--color-turquoise)]/20 transition-colors"
              >
                <Folder class="w-7 h-7 text-[var(--color-turquoise)]" />
              </div>

              <div class="flex-1 min-w-0">
                <div class="text-sm text-gray-400 mb-1">Storage Location</div>
                <div
                  class="text-white font-medium truncate"
                  :class="selectedPath ? 'text-white' : 'text-gray-500'"
                >
                  {{ selectedPath || 'Click to select a folder...' }}
                </div>
              </div>
            </div>
          </button>

          <!-- Free space indicator -->
          <div v-if="selectedPath" class="bg-[#252525] border border-[#333] rounded-2xl p-6">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <HardDrive class="w-6 h-6 text-green-500" />
              </div>

              <div>
                <div class="text-sm text-gray-400">Available Space</div>
                <div class="text-lg font-bold text-white">{{ freeSpace || 'Calculating...' }}</div>
              </div>
            </div>
          </div>

          <!-- Error message -->
          <div
            v-if="error"
            class="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400"
          >
            {{ error }}
          </div>

          <!-- Action buttons -->
          <div class="flex gap-4 pt-4">
            <Button
              variant="primary"
              size="lg"
              :disabled="!selectedPath || isLoading"
              class="flex-1"
              @click="confirmSetup"
            >
              <span v-if="isLoading">Setting up...</span>
              <span v-else>Continue</span>
            </Button>
          </div>
        </div>

        <!-- Info note -->
        <div
          class="mt-8 p-4 bg-[var(--color-turquoise)]/5 border border-[var(--color-turquoise)]/20 rounded-xl"
        >
          <p class="text-sm text-gray-400">
            <strong class="text-[var(--color-turquoise)]">Note:</strong> You can change this
            location later in settings. Make sure to use a drive with sufficient space for your
            photo library.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
