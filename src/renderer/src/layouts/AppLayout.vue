<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppSidebar from '../components/AppSidebar.vue'
import FloatingNavbar from '../components/FloatingNavbar.vue'
import { AlertTriangle, X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  showSidebar?: boolean
}>(), {
  showSidebar: true
})

const BANNER_DISMISSED_KEY = 'lumosnap:lowStorageBannerDismissed'
const BANNER_DISMISSED_SPACE_KEY = 'lumosnap:lowStorageBannerDismissedAtSpace'

const showLowStorageBanner = ref(false)
const isCheckingStorage = ref(true)

async function checkStorageStatus(): Promise<void> {
  isCheckingStorage.value = true
  try {
    const info = await window.api.config.getCurrentStorageInfo()
    
    if (info.success && info.isLowStorage) {
      // Check if banner was previously dismissed
      const dismissedAt = localStorage.getItem(BANNER_DISMISSED_KEY)
      const dismissedSpace = localStorage.getItem(BANNER_DISMISSED_SPACE_KEY)
      
      // If storage has gotten worse (less space) since dismissal, show again
      if (dismissedAt && dismissedSpace) {
        const previousSpace = parseInt(dismissedSpace, 10)
        // Show again if space decreased by more than 1GB since last dismissal
        if (info.freeSpace >= previousSpace - 1024 * 1024 * 1024) {
          showLowStorageBanner.value = false
        } else {
          // Space got significantly worse, show banner again
          showLowStorageBanner.value = true
        }
      } else {
        showLowStorageBanner.value = true
      }
    } else {
      // Storage is healthy, clear any previous dismissal
      localStorage.removeItem(BANNER_DISMISSED_KEY)
      localStorage.removeItem(BANNER_DISMISSED_SPACE_KEY)
      showLowStorageBanner.value = false
    }
  } catch {
    // Silent fail, don't show banner on error
    showLowStorageBanner.value = false
  } finally {
    isCheckingStorage.value = false
  }
}

function dismissBanner(): void {
  showLowStorageBanner.value = false
  localStorage.setItem(BANNER_DISMISSED_KEY, Date.now().toString())
  // Store current space to detect if it gets worse
  window.api.config.getCurrentStorageInfo().then(info => {
    if (info.success) {
      localStorage.setItem(BANNER_DISMISSED_SPACE_KEY, info.freeSpace.toString())
    }
  })
}

onMounted(() => {
  checkStorageStatus()
})
</script>

<template>
  <div
    class="min-h-screen bg-[#0f0f13] font-sans text-gray-900 selection:bg-[#00E0C6] selection:text-white overflow-hidden"
  >
    <!-- Ambient Background Blobs -->
    <div class="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <!-- Turquoise/Blue Blob (Top Left) -->
      <div
        class="absolute -left-32 top-1/4 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-teal-500/40 to-blue-600/30 blur-[100px] animate-pulse-slow"
      ></div>

      <!-- Cyan/Emerald Blob (Bottom Right) -->
      <div
        class="absolute -left-20 bottom-0 h-[400px] w-[400px] rounded-full bg-gradient-to-br from-cyan-500/30 to-emerald-400/20 blur-[80px]"
      ></div>

      <!-- Blue/Teal Blob (Top Right) -->
      <div
        class="absolute left-32 top-0 h-[300px] w-[300px] rounded-full bg-gradient-to-br from-blue-500/20 to-teal-400/20 blur-[60px]"
      ></div>
    </div>

    <AppSidebar v-if="props.showSidebar" />
    <FloatingNavbar />

    <!-- Main Content Area -->
    <main :class="props.showSidebar ? 'ml-[280px]' : 'ml-0'" class="min-h-screen relative z-10 p-4" :style="props.showSidebar ? 'padding-left: 0' : ''">
      <div
        :class="props.showSidebar ? 'rounded-l-[24px]' : 'rounded-[24px]'"
        class="h-[calc(100vh-2rem)] bg-[#f5f6f7] shadow-[-4px_0_24px_rgba(0,0,0,0.2)] overflow-hidden relative flex flex-col"
      >
        <!-- Low Storage Banner -->
        <Transition name="slide-down">
          <div
            v-if="showLowStorageBanner"
            class="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 flex items-center justify-between gap-4 shrink-0"
          >
            <div class="flex items-center gap-3">
              <AlertTriangle class="w-5 h-5 text-white shrink-0" />
              <p class="text-sm font-medium text-white">
                You're running low on storage space. Consider freeing up space or changing your storage location in Settings.
              </p>
            </div>
            <button
              class="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors shrink-0"
              @click="dismissBanner"
            >
              <X class="w-4 h-4 text-white" />
            </button>
          </div>
        </Transition>

        <div class="flex-1 overflow-y-auto custom-scrollbar">
          <slot />
        </div>
      </div>
    </main>
  </div>
</template>

<style>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 20px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
}

/* Banner slide transition */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}
</style>
