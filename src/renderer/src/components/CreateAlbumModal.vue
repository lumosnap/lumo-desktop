<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Modal from './ui/Modal.vue'
import { AlertCircle, Plus, Loader2, AlertTriangle, ArrowUpCircle, WifiOff } from 'lucide-vue-next'
import { useProfileStore } from '../stores/profile'
import { useNetworkStore } from '../stores/network'

const profileStore = useProfileStore()
const networkStore = useNetworkStore()

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
  created: [albumId: string]
}>()

const title = ref<string>('')
const isCreating = ref(false)
const error = ref<string | null>(null)

// Computed for limit warning message
const limitWarning = computed(() => {
  if (!profileStore.profile) return null
  if (profileStore.isAtLimit) {
    return {
      type: 'error' as const,
      message:
        "You've reached your image limit. Uploads will not be processed until you upgrade your plan.",
      remaining: 0
    }
  }
  if (profileStore.isNearLimit) {
    return {
      type: 'warning' as const,
      message: `Only ${profileStore.remainingImages.toLocaleString()} images remaining in your plan. Consider upgrading.`,
      remaining: profileStore.remainingImages
    }
  }
  return null
})

async function createAlbum(): Promise<void> {
  if (!title.value.trim()) {
    error.value = 'Please enter an album title'
    return
  }

  isCreating.value = true
  error.value = null

  try {
    const result = await window.api.albums.create({
      title: title.value.trim(),
      eventDate: null,
      sourceFolderPath: '' // Will be set by master folder + title in backend
    })

    if (result.success) {
      emit('created', result.album.id)
      resetForm()
    } else {
      error.value = result.error || 'Failed to create album'
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Failed to create album'
  } finally {
    isCreating.value = false
  }
}

function resetForm(): void {
  title.value = ''
  error.value = null
}

function handleClose(): void {
  if (!isCreating.value) {
    resetForm()
    emit('close')
  }
}

// Reset form when modal is closed or opened
watch(
  () => props.show,
  (newValue) => {
    if (!newValue) {
      resetForm()
    }
  }
)
</script>

<template>
  <Modal :show="show" title="Create New Album" @close="handleClose">
    <div class="space-y-5">
      <!-- Limit Warning -->
      <div
        v-if="limitWarning"
        class="flex items-start gap-3 p-4 rounded-xl border"
        :class="
          limitWarning.type === 'error'
            ? 'bg-red-50 border-red-200'
            : 'bg-amber-50 border-amber-200'
        "
      >
        <AlertTriangle
          class="w-5 h-5 flex-shrink-0 mt-0.5"
          :class="limitWarning.type === 'error' ? 'text-red-500' : 'text-amber-500'"
        />
        <div class="flex-1">
          <p
            class="text-sm"
            :class="limitWarning.type === 'error' ? 'text-red-600' : 'text-amber-600'"
          >
            {{ limitWarning.message }}
          </p>
          <router-link
            to="/profile"
            class="inline-flex items-center gap-1 mt-2 text-sm font-medium"
            :class="
              limitWarning.type === 'error'
                ? 'text-red-700 hover:text-red-800'
                : 'text-amber-700 hover:text-amber-800'
            "
            @click="handleClose"
          >
            <ArrowUpCircle class="w-4 h-4" />
            Upgrade Plan
          </router-link>
        </div>
      </div>

      <!-- Album title -->
      <div>
        <label for="album-title" class="block text-sm font-medium text-slate-700 mb-2">
          Album Name <span class="text-red-500">*</span>
        </label>
        <input
          id="album-title"
          v-model="title"
          type="text"
          placeholder="e.g., Smith Wedding, Product Shoot"
          :disabled="isCreating"
          class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50"
          @keyup.enter="createAlbum"
        />
        <p class="mt-2 text-xs text-slate-500">
          A folder with this name will be created in your master folder
        </p>
      </div>

      <!-- Error message -->
      <div
        v-if="error"
        class="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3"
      >
        <AlertCircle class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
        <p class="text-sm text-red-600">{{ error }}</p>
      </div>

      <!-- Info note -->
      <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
        <p class="text-sm text-slate-600">
          <strong class="text-indigo-600">Tip:</strong> After creating the album, add photos to the
          folder. The app will automatically detect and process them.
        </p>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-3 pt-2">
        <button
          :disabled="isCreating"
          class="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          @click="handleClose"
        >
          Cancel
        </button>
        <button
          :disabled="!title.trim() || isCreating || !networkStore.isOnline"
          class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          :title="!networkStore.isOnline ? 'You are offline. Album creation requires an internet connection.' : ''"
          @click="createAlbum"
        >
          <WifiOff v-if="!networkStore.isOnline" class="w-4 h-4" />
          <Loader2 v-else-if="isCreating" class="w-4 h-4 animate-spin" />
          <Plus v-else class="w-4 h-4" />
          <span v-if="!networkStore.isOnline">Offline</span>
          <span v-else>{{ isCreating ? 'Creating...' : 'Create Album' }}</span>
        </button>
      </div>
    </div>
  </Modal>
</template>
