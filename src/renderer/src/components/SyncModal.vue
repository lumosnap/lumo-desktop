<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { RefreshCw, Plus, Edit3, Trash2, ChevronDown, ChevronUp, X } from 'lucide-vue-next'

interface SyncChanges {
  new: Array<{ filename: string; size: number }>
  modified: Array<{ filename: string; existingId: number }>
  deleted: Array<{ id: number; serverId: number | null; originalFilename: string }>
}

interface Props {
  show: boolean
  albumId: string
  albumTitle: string
  changes: SyncChanges | null
  isLoading?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  sync: []
}>()

const isSyncing = ref(false)
const syncError = ref('')
const expandedSections = ref<{ new: boolean; modified: boolean; deleted: boolean }>({
  new: false,
  modified: false,
  deleted: false
})

const hasChanges = computed(() => {
  if (!props.changes) return false
  return (
    props.changes.new.length > 0 ||
    props.changes.modified.length > 0 ||
    props.changes.deleted.length > 0
  )
})

const totalChanges = computed(() => {
  if (!props.changes) return 0
  return props.changes.new.length + props.changes.modified.length + props.changes.deleted.length
})

function toggleSection(section: 'new' | 'modified' | 'deleted') {
  expandedSections.value[section] = !expandedSections.value[section]
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

async function handleSync() {
  if (!props.changes) return

  isSyncing.value = true
  syncError.value = ''

  try {
    // Deep clone to strip Vue reactivity - IPC can't clone reactive objects
    const plainChanges = JSON.parse(JSON.stringify(props.changes))
    console.log('[SyncModal] Sending changes to sync:', plainChanges)

    const result = await window.api.sync.execute(props.albumId, plainChanges)
    if (result.success) {
      emit('sync')
      emit('close')
    } else {
      syncError.value = result.error || 'Sync failed'
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    console.error('[SyncModal] Sync error:', error)
    syncError.value = message
  } finally {
    isSyncing.value = false
  }
}

// Reset state when modal closes
watch(
  () => props.show,
  (show) => {
    if (!show) {
      isSyncing.value = false
      syncError.value = ''
      expandedSections.value = { new: false, modified: false, deleted: false }
    }
  }
)
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
  >
    <div
      class="w-full max-w-lg rounded-2xl bg-[#1e1e2d] border border-[var(--color-turquoise)]/20 p-6 shadow-2xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-turquoise)]/10"
          >
            <RefreshCw class="h-5 w-5 text-[var(--color-turquoise)]" />
          </div>
          <div>
            <h3 class="text-xl font-bold text-white">Sync Album</h3>
            <p class="text-sm text-gray-400">{{ albumTitle }}</p>
          </div>
        </div>
        <button
          class="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"
          @click="emit('close')"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="py-8 text-center">
        <RefreshCw class="h-8 w-8 text-[var(--color-turquoise)] animate-spin mx-auto mb-3" />
        <p class="text-gray-400">Detecting changes...</p>
      </div>

      <!-- No Changes -->
      <div v-else-if="!hasChanges" class="py-8 text-center">
        <div
          class="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 mx-auto mb-4"
        >
          <RefreshCw class="h-8 w-8 text-green-500" />
        </div>
        <p class="text-lg font-medium text-white mb-1">Album is in sync</p>
        <p class="text-sm text-gray-400">No changes detected in source folder</p>
      </div>

      <!-- Changes Summary -->
      <div v-else class="space-y-3 max-h-[60vh] overflow-y-auto">
        <p class="text-sm text-gray-400 mb-4">
          {{ totalChanges }} change{{ totalChanges !== 1 ? 's' : '' }} detected in source folder
        </p>

        <!-- New Files -->
        <div
          v-if="changes?.new.length"
          class="rounded-lg bg-green-500/10 border border-green-500/20 overflow-hidden"
        >
          <button
            class="flex w-full items-center justify-between p-3 text-left"
            @click="toggleSection('new')"
          >
            <div class="flex items-center gap-2">
              <Plus class="h-4 w-4 text-green-500" />
              <span class="font-medium text-green-400"
                >{{ changes.new.length }} new file{{ changes.new.length !== 1 ? 's' : '' }}</span
              >
            </div>
            <component
              :is="expandedSections.new ? ChevronUp : ChevronDown"
              class="h-4 w-4 text-green-500"
            />
          </button>
          <div v-if="expandedSections.new" class="px-3 pb-3 max-h-32 overflow-y-auto">
            <div
              v-for="file in changes.new"
              :key="file.filename"
              class="flex items-center justify-between py-1 text-sm"
            >
              <span class="text-gray-300 truncate">{{ file.filename }}</span>
              <span class="text-gray-500 text-xs">{{ formatBytes(file.size) }}</span>
            </div>
          </div>
        </div>

        <!-- Modified Files -->
        <div
          v-if="changes?.modified.length"
          class="rounded-lg bg-yellow-500/10 border border-yellow-500/20 overflow-hidden"
        >
          <button
            class="flex w-full items-center justify-between p-3 text-left"
            @click="toggleSection('modified')"
          >
            <div class="flex items-center gap-2">
              <Edit3 class="h-4 w-4 text-yellow-500" />
              <span class="font-medium text-yellow-400"
                >{{ changes.modified.length }} modified file{{
                  changes.modified.length !== 1 ? 's' : ''
                }}</span
              >
            </div>
            <component
              :is="expandedSections.modified ? ChevronUp : ChevronDown"
              class="h-4 w-4 text-yellow-500"
            />
          </button>
          <div v-if="expandedSections.modified" class="px-3 pb-3 max-h-32 overflow-y-auto">
            <div
              v-for="file in changes.modified"
              :key="file.existingId"
              class="py-1 text-sm text-gray-300 truncate"
            >
              {{ file.filename }}
            </div>
          </div>
        </div>

        <!-- Deleted Files -->
        <div
          v-if="changes?.deleted.length"
          class="rounded-lg bg-red-500/10 border border-red-500/20 overflow-hidden"
        >
          <button
            class="flex w-full items-center justify-between p-3 text-left"
            @click="toggleSection('deleted')"
          >
            <div class="flex items-center gap-2">
              <Trash2 class="h-4 w-4 text-red-500" />
              <span class="font-medium text-red-400"
                >{{ changes.deleted.length }} deleted file{{
                  changes.deleted.length !== 1 ? 's' : ''
                }}</span
              >
            </div>
            <component
              :is="expandedSections.deleted ? ChevronUp : ChevronDown"
              class="h-4 w-4 text-red-500"
            />
          </button>
          <div v-if="expandedSections.deleted" class="px-3 pb-3 max-h-32 overflow-y-auto">
            <div
              v-for="file in changes.deleted"
              :key="file.id"
              class="py-1 text-sm text-gray-300 truncate"
            >
              {{ file.originalFilename }}
            </div>
          </div>
        </div>

        <!-- Error Message -->
        <p v-if="syncError" class="text-sm text-red-500 mt-2">{{ syncError }}</p>

        <!-- Actions -->
        <div class="flex justify-end gap-3 pt-4 border-t border-white/5">
          <button
            class="rounded-lg px-4 py-2 text-sm font-medium text-gray-400 hover:text-white"
            :disabled="isSyncing"
            @click="emit('close')"
          >
            Cancel
          </button>
          <button
            class="flex items-center gap-2 rounded-lg bg-[var(--color-turquoise)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-turquoise-dark)] disabled:opacity-50"
            :disabled="isSyncing"
            @click="handleSync"
          >
            <RefreshCw v-if="isSyncing" class="h-4 w-4 animate-spin" />
            {{ isSyncing ? 'Syncing...' : 'Sync Now' }}
          </button>
        </div>
      </div>

      <!-- Close button for no-changes state -->
      <div v-if="!isLoading && !hasChanges" class="flex justify-center pt-4">
        <button
          class="rounded-lg px-6 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5"
          @click="emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
