<script setup lang="ts">
import { ref, watch } from 'vue'
import Modal from './ui/Modal.vue'
import { AlertCircle, Plus, Loader2 } from 'lucide-vue-next'

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
          <strong class="text-indigo-600">Tip:</strong> After creating the album,
          add photos to the folder. The app will automatically detect and process them.
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
          :disabled="!title.trim() || isCreating"
          class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          @click="createAlbum"
        >
          <Loader2 v-if="isCreating" class="w-4 h-4 animate-spin" />
          <Plus v-else class="w-4 h-4" />
          <span>{{ isCreating ? 'Creating...' : 'Create Album' }}</span>
        </button>
      </div>
    </div>
  </Modal>
</template>
