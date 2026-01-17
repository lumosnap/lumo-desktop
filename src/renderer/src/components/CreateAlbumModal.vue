<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Modal from './ui/Modal.vue'
import {
  AlertCircle,
  Plus,
  Loader2,
  AlertTriangle,
  ArrowUpCircle,
  WifiOff,
  FolderOpen,
  X
} from 'lucide-vue-next'
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

// Optional folder path - if set, determines album type
const sourceFolderPath = ref<string>('')
const masterFolder = ref<string | null>(null)

// Load master folder on mount
watch(
  () => props.show,
  async (newValue) => {
    if (newValue) {
      try {
        masterFolder.value = await window.api.config.getMasterFolder()
      } catch (err) {
        console.error('Failed to get master folder:', err)
      }
    } else {
      resetForm()
    }
  }
)

// Auto-detect album type based on folder path
const albumType = computed<'watch_folder' | 'standalone'>(() => {
  if (!sourceFolderPath.value) {
    return 'watch_folder' // Default: create in master folder
  }
  
  // Check if selected folder is inside master folder
  if (masterFolder.value && sourceFolderPath.value.startsWith(masterFolder.value)) {
    return 'watch_folder'
  }
  
  return 'standalone'
})

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

// Check if form is valid
const isFormValid = computed(() => {
  return title.value.trim().length > 0
})

async function selectFolder(): Promise<void> {
  try {
    const result = await window.api.dialog.openDirectory()
    if (result) {
      sourceFolderPath.value = result
      // Auto-fill title from folder name if empty
      if (!title.value.trim()) {
        const folderName = result.split(/[/\\]/).pop() || ''
        title.value = folderName
      }
    }
  } catch (err) {
    console.error('Failed to open folder dialog:', err)
  }
}

function clearFolder(): void {
  sourceFolderPath.value = ''
}

async function createAlbum(): Promise<void> {
  if (!isFormValid.value) {
    error.value = 'Please enter an album title'
    return
  }

  isCreating.value = true
  error.value = null

  try {
    const result = await window.api.albums.create({
      title: title.value.trim(),
      eventDate: null,
      sourceFolderPath: sourceFolderPath.value,
      albumType: albumType.value
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
  sourceFolderPath.value = ''
}

function handleClose(): void {
  if (!isCreating.value) {
    resetForm()
    emit('close')
  }
}
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
      </div>

      <!-- Optional Folder Picker -->
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-2">
          Source Folder
          <span class="text-slate-400 font-normal">(optional)</span>
        </label>

        <div v-if="!sourceFolderPath" class="flex gap-2">
          <button
            type="button"
            :disabled="isCreating"
            class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-slate-500 hover:text-indigo-600 font-medium transition-all disabled:opacity-50"
            @click="selectFolder"
          >
            <FolderOpen class="w-4 h-4" />
            Select Existing Folder
          </button>
        </div>

        <div v-else class="flex items-center gap-2">
          <div
            class="flex-1 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-sm text-indigo-900 truncate"
          >
            {{ sourceFolderPath }}
          </div>
          <button
            type="button"
            :disabled="isCreating"
            class="p-3 rounded-xl bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors disabled:opacity-50"
            title="Clear folder selection"
            @click="clearFolder"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <p class="mt-2 text-xs text-slate-500">
          <template v-if="!sourceFolderPath">
            Leave empty to create a new folder in your watch folder, or select an existing folder
            with photos.
          </template>
          <template v-else-if="albumType === 'standalone'">
            <span class="text-indigo-600 font-medium">Standalone album:</span> This folder will be
            watched independently.
          </template>
          <template v-else>
            <span class="text-indigo-600 font-medium">Watch folder album:</span> This folder is
            inside your master folder.
          </template>
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
          <strong class="text-indigo-600">Tip:</strong>
          <template v-if="sourceFolderPath">
            The app will scan and upload all photos from the selected folder. Any new photos added
            later will be detected automatically.
          </template>
          <template v-else>
            A folder will be created in your watch folder. Add photos to it and they'll be
            automatically detected and processed.
          </template>
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
          :disabled="!isFormValid || isCreating || !networkStore.isOnline"
          class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          :title="
            !networkStore.isOnline
              ? 'You are offline. Album creation requires an internet connection.'
              : ''
          "
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
