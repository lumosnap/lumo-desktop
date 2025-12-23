<script setup lang="ts">
import { ref, watch } from 'vue'
import Modal from './ui/Modal.vue'
import Button from './ui/Button.vue'
import { Folder, AlertCircle } from 'lucide-vue-next'

const props = defineProps<{
  show: boolean
  initialDate?: Date
}>()

const emit = defineEmits<{
  close: []
  created: [albumId: string]
}>()

const sourceFolderPath = ref<string>('')
const title = ref<string>('')
const startTime = ref<string>('')
const endTime = ref<string>('')
const imageCount = ref<number>(0)
const isScanning = ref(false)
const isCreating = ref(false)
const error = ref<string | null>(null)

// Helper to format date for datetime-local input
function formatDateTime(date: Date): string {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

async function selectFolder(): Promise<void> {
  try {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      sourceFolderPath.value = path
      isScanning.value = true
      error.value = null

      // Scan folder for images
      const result = await window.api.albums.scanSourceFolder(path)
      if (result.success) {
        imageCount.value = result.count
      } else {
        error.value = result.error || 'Failed to scan folder'
      }
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to select folder'
  } finally {
    isScanning.value = false
  }
}

async function createAlbum(): Promise<void> {
  if (!sourceFolderPath.value || !title.value) {
    error.value = 'Please fill in all required fields'
    return
  }

  if (imageCount.value === 0) {
    error.value = 'No images found in the selected folder'
    return
  }

  isCreating.value = true
  error.value = null

  try {
    // Use startTime as the main eventDate if available
    const eventDate = startTime.value || null

    const result = await window.api.albums.create({
      title: title.value,
      eventDate: eventDate,
      sourceFolderPath: sourceFolderPath.value
    })

    if (result.success) {
      emit('created', result.album.id)
      resetForm()
    } else {
      error.value = result.error || 'Failed to create album'
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to create album'
  } finally {
    isCreating.value = false
  }
}

function resetForm(): void {
  sourceFolderPath.value = ''
  title.value = ''
  if (props.initialDate) {
    setInitialDates(props.initialDate)
  } else {
    startTime.value = ''
    endTime.value = ''
  }
  imageCount.value = 0
  error.value = null
}

function setInitialDates(date: Date): void {
  startTime.value = formatDateTime(date)

  // Default end time to 1 hour later
  const endDate = new Date(date)
  endDate.setHours(endDate.getHours() + 1)
  endTime.value = formatDateTime(endDate)
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
    if (newValue) {
      // When opening, set initial date if provided
      if (props.initialDate) {
        setInitialDates(props.initialDate)
      }
    } else {
      resetForm()
    }
  }
)
</script>

<template>
  <Modal :show="show" title="Create New Album" @close="handleClose">
    <div class="space-y-6">
      <!-- Source folder selection -->
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-2">
          Source Folder <span class="text-red-400">*</span>
        </label>
        <button
          :disabled="isScanning || isCreating"
          class="w-full bg-[#252525] hover:bg-[#2a2a2a] border border-[#333] rounded-xl p-4 text-left transition-all hover:border-[var(--color-turquoise)] group disabled:opacity-50 disabled:cursor-not-allowed"
          @click="selectFolder"
        >
          <div class="flex items-start gap-3">
            <div
              class="w-10 h-10 rounded-lg bg-[var(--color-turquoise)]/10 flex items-center justify-center group-hover:bg-[var(--color-turquoise)]/20 transition-colors"
            >
              <Folder class="w-5 h-5 text-[var(--color-turquoise)]" />
            </div>

            <div class="flex-1 min-w-0">
              <div
                class="text-sm font-medium truncate"
                :class="sourceFolderPath ? 'text-white' : 'text-gray-500'"
              >
                {{ sourceFolderPath || 'Click to select folder with images...' }}
              </div>
              <div v-if="sourceFolderPath" class="text-xs text-gray-400 mt-1">
                <span v-if="isScanning">Scanning for images...</span>
                <span v-else-if="imageCount > 0" class="text-green-400">
                  {{ imageCount }} {{ imageCount === 1 ? 'image' : 'images' }} found
                </span>
                <span v-else class="text-yellow-400">No images found</span>
              </div>
            </div>
          </div>
        </button>
      </div>

      <!-- Album title -->
      <div>
        <label for="album-title" class="block text-sm font-medium text-gray-300 mb-2">
          Album Title <span class="text-red-400">*</span>
        </label>
        <input
          id="album-title"
          v-model="title"
          type="text"
          placeholder="e.g., Smith Wedding, Product Shoot"
          :disabled="isCreating"
          class="w-full bg-[#252525] border border-[#333] rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-turquoise)] transition-colors disabled:opacity-50"
        />
      </div>

      <!-- Event Time Range -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="start-time" class="block text-sm font-medium text-gray-300 mb-2">
            Start Time
          </label>
          <input
            id="start-time"
            v-model="startTime"
            type="datetime-local"
            :disabled="isCreating"
            class="w-full bg-[#252525] border border-[#333] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--color-turquoise)] transition-colors disabled:opacity-50 [color-scheme:dark]"
          />
        </div>
        <div>
          <label for="end-time" class="block text-sm font-medium text-gray-300 mb-2">
            End Time
          </label>
          <input
            id="end-time"
            v-model="endTime"
            type="datetime-local"
            :disabled="isCreating"
            class="w-full bg-[#252525] border border-[#333] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--color-turquoise)] transition-colors disabled:opacity-50 [color-scheme:dark]"
          />
        </div>
      </div>

      <!-- Error message -->
      <div
        v-if="error"
        class="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3"
      >
        <AlertCircle class="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <p class="text-sm text-red-400">{{ error }}</p>
      </div>

      <!-- Info note -->
      <div
        class="bg-[var(--color-turquoise)]/5 border border-[var(--color-turquoise)]/20 rounded-xl p-4"
      >
        <p class="text-sm text-gray-400">
          <strong class="text-[var(--color-turquoise)]">Note:</strong> The images will be compressed
          and uploaded automatically. The original files will not be modified.
        </p>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-3 pt-2">
        <Button
          variant="secondary"
          size="md"
          :disabled="isCreating"
          class="flex-1"
          @click="handleClose"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          :disabled="!sourceFolderPath || !title || imageCount === 0 || isScanning || isCreating"
          class="flex-1"
          @click="createAlbum"
        >
          <span v-if="isCreating">Creating...</span>
          <span v-else>Create Album</span>
        </Button>
      </div>
    </div>
  </Modal>
</template>
