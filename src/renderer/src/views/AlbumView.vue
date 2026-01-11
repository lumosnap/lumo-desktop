<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import CreateAlbumModal from '../components/CreateAlbumModal.vue'
import SyncModal from '../components/SyncModal.vue'
import Dropdown from '../components/ui/Dropdown.vue'
import ProgressPopover from '../components/ui/ProgressPopover.vue'
import {
  RefreshCw,
  Plus,
  Trash2,
  MoreHorizontal,
  Loader2,
  FolderOpen,
  Image as ImageIcon,
  AlertCircle,
  ArrowUpCircle
} from 'lucide-vue-next'
import type { Album } from '../stores/album'
import { useUIStore } from '../stores/ui'
import { useProfileStore } from '../stores/profile'

const uiStore = useUIStore()
const profileStore = useProfileStore()
const router = useRouter()

// Usage percentage for circular progress - now using imageLimit from profileStore
const usagePercentage = computed(() => profileStore.usagePercentage)
const showCreateModal = ref(false)
const albums = ref<Album[]>([])
const loading = ref(true)
const masterFolder = ref<string | null>(null)

// Progress State
const isProcessing = ref(false)
const currentUploadingAlbumId = ref<string | null>(null)
const uploadProgress = ref<{
  albumId: string
  compressing: number
  uploading: number
  complete: number
  total: number
  failed: number
  pending: number
} | null>(null)
const batchInfo = ref<{ batchIndex: number; totalBatches: number } | null>(null)

// Delete State
const showDeleteModal = ref(false)
const albumToDelete = ref<Album | null>(null)
const deleteConfirmation = ref('')
const isDeleting = ref(false)
const deleteError = ref('')

// Sync State
const showSyncModal = ref(false)
const syncAlbum = ref<Album | null>(null)
const syncChanges = ref<any>(null)
const isSyncLoading = ref(false)

// Pastel color palette for albums
const pastelColors = [
  { bg: '#C3F5E4', border: '#5DD4B0', text: '#0D7357', shadow: 'rgba(93, 212, 176, 0.3)' },
  { bg: '#FFE0C4', border: '#FFB876', text: '#B85C1A', shadow: 'rgba(255, 184, 118, 0.3)' },
  { bg: '#FFF3C4', border: '#FFE066', text: '#9A7B1A', shadow: 'rgba(255, 224, 102, 0.3)' },
  { bg: '#D4F5F5', border: '#7DD8D8', text: '#1A7A7A', shadow: 'rgba(125, 216, 216, 0.3)' },
  { bg: '#FFE4F0', border: '#FFB3D9', text: '#B84D83', shadow: 'rgba(255, 179, 217, 0.3)' },
  { bg: '#E9D5FF', border: '#C4A3FF', text: '#6B3FA0', shadow: 'rgba(196, 163, 255, 0.3)' }
]

// Get color for album based on index
function getAlbumColor(index: number) {
  return pastelColors[index % pastelColors.length]
}

function openAlbum(album: Album): void {
  if (album.totalImages === 0 && album.sourceFolderPath) {
    // Open in file manager if empty
    window.api.shell.openFolder(album.sourceFolderPath)
  } else {
    router.push(`/albums/${album.id}`)
  }
}

function openCreateModal(): void {
  showCreateModal.value = true
}

function openFolderInExplorer(album: Album): void {
  if (album.sourceFolderPath) {
    window.api.shell.openFolder(album.sourceFolderPath)
  }
}

async function openWatchFolder(): Promise<void> {
  if (masterFolder.value) {
    await window.api.shell.openFolder(masterFolder.value)
  }
}

let loadDebounceTimer: ReturnType<typeof setTimeout> | null = null

async function loadAlbums(): Promise<void> {
  // Simple debounce
  if (loadDebounceTimer) clearTimeout(loadDebounceTimer)
  
  loadDebounceTimer = setTimeout(async () => {
    loading.value = true
    try {
      const result = await window.api.albums.list()
      if (result.success) {
        albums.value = result.albums || []
      }
    } catch (error) {
      console.error('Failed to load albums:', error)
    } finally {
      loading.value = false
    }
  }, 100)
}

async function loadMasterFolder(): Promise<void> {
  try {
    masterFolder.value = await window.api.config.getMasterFolder()
  } catch (error) {
    console.error('Failed to load master folder:', error)
  }
}

function handleAlbumCreated(albumId: string): void {
  showCreateModal.value = false
  loadAlbums()
  console.log('Album created:', albumId)
}

// Delete Functions
function openDeleteModal(album: Album): void {
  albumToDelete.value = album
  deleteConfirmation.value = ''
  deleteError.value = ''
  showDeleteModal.value = true
}

// Sync Functions
async function openSyncModal(album: Album): Promise<void> {
  syncAlbum.value = album
  syncChanges.value = null
  isSyncLoading.value = true
  showSyncModal.value = true

  try {
    const result = await window.api.sync.detectChanges(album.id)
    if (result.success) {
      syncChanges.value = result.changes
    }
  } catch (error) {
    console.error('Failed to detect sync changes:', error)
  } finally {
    isSyncLoading.value = false
  }
}

function handleSyncComplete(): void {
  loadAlbums()
}

async function handleDeleteAlbum(): Promise<void> {
  if (!albumToDelete.value) return

  if (deleteConfirmation.value !== albumToDelete.value.title) {
    deleteError.value = 'Album name does not match'
    return
  }

  isDeleting.value = true
  deleteError.value = ''

  try {
    const result = await window.api.albums.delete(albumToDelete.value.id)
    if (result.success) {
      showDeleteModal.value = false
      albumToDelete.value = null
      loadAlbums()
    } else {
      deleteError.value = result.error || 'Failed to delete album'
    }
  } catch (error: any) {
    deleteError.value = error.message || 'An unexpected error occurred'
  } finally {
    isDeleting.value = false
  }
}

// Event handlers
const onBatchStart = (_e: any, data: any): void => {
  isProcessing.value = true
  batchInfo.value = data
}

const onProgress = (_e: any, data: any): void => {
  isProcessing.value = true
  uploadProgress.value = data
  if (data.albumId) {
    currentUploadingAlbumId.value = data.albumId
  }
}

const onComplete = (): void => {
  isProcessing.value = false
  uploadProgress.value = null
  batchInfo.value = null
  currentUploadingAlbumId.value = null
  loadAlbums()
}

const onError = (): void => {
  isProcessing.value = false
}

const onAlbumStatusChanged = (_e: any, data: { albumId: string; needsSync: number }): void => {
  console.log('Album status changed:', data)
  const album = albums.value.find((a) => a.id === data.albumId)
  if (album) {
    album.needsSync = data.needsSync
  }
}

const onAlbumsRefresh = (): void => {
  console.log('Albums refresh requested')
  loadAlbums()
}

onMounted(() => {
  loadAlbums()
  loadMasterFolder()
  profileStore.fetchProfile()

  // Register listeners
  if (window.api && window.api.on) {
    window.api.on('upload:batch-start', onBatchStart)
    window.api.on('upload:progress', onProgress)
    window.api.on('upload:complete', onComplete)
    window.api.on('upload:error', onError)
    window.api.on('album:status-changed', onAlbumStatusChanged)
    window.api.on('albums:refresh', onAlbumsRefresh)
  }
})

onUnmounted(() => {
  if (window.api && window.api.off) {
    window.api.off('upload:batch-start', onBatchStart)
    window.api.off('upload:progress', onProgress)
    window.api.off('upload:complete', onComplete)
    window.api.off('upload:error', onError)
    window.api.off('album:status-changed', onAlbumStatusChanged)
    window.api.off('albums:refresh', onAlbumsRefresh)
  }
})
</script>

<template>
  <AppLayout>
    <div class="flex h-full flex-col bg-slate-50">
      <!-- Header -->
      <div class="flex items-center justify-between px-8 py-6 border-b border-slate-200 bg-white">
        <div>
          <div class="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1">
            Library
          </div>
          <h1 class="text-3xl font-bold text-slate-900">Albums</h1>
        </div>

        <div class="flex items-center gap-3">
          <!-- Open Watch Folder Button -->
          <button
            v-if="masterFolder"
            class="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
            title="Open Watch Folder"
            @click="openWatchFolder"
          >
            <FolderOpen class="h-4 w-4" />
            Open Watch Folder
          </button>

          <!-- Refresh Button -->
          <button
            class="rounded-xl p-2.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Refresh Albums"
            :disabled="loading"
            @click="loadAlbums"
          >
            <RefreshCw class="h-5 w-5" :class="{ 'animate-spin': loading }" />
          </button>

          <!-- Create Album Button -->
          <button
            class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5"
            @click="openCreateModal()"
          >
            <Plus class="h-4 w-4" />
            New Album
          </button>

          <!-- Progress Popover -->
          <ProgressPopover :progress="uploadProgress" :is-processing="isProcessing" />

          <!-- Profile Avatar with Usage Ring -->
          <router-link
            to="/profile"
            class="flex items-center gap-3 bg-slate-50 rounded-2xl pl-1.5 pr-4 py-1.5 border border-slate-100 shadow-inner group hover:bg-slate-100/80 transition-all"
            title="Profile & Settings"
          >
            <!-- Avatar with Ring -->
            <div class="relative">
              <!-- Circular Progress Ring -->
              <svg class="w-10 h-10 -rotate-90" viewBox="0 0 44 44">
                <!-- Background circle -->
                <circle cx="22" cy="22" r="19" fill="none" stroke="#e2e8f0" stroke-width="3" />
                <!-- Progress circle -->
                <circle
                  cx="22"
                  cy="22"
                  r="19"
                  fill="none"
                  stroke="url(#usageGradient)"
                  stroke-width="3"
                  stroke-linecap="round"
                  :stroke-dasharray="119.38"
                  :stroke-dashoffset="119.38 - (119.38 * usagePercentage) / 100"
                  class="transition-all duration-500"
                />
                <defs>
                  <linearGradient id="usageGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#6366f1" />
                    <stop offset="100%" stop-color="#8b5cf6" />
                  </linearGradient>
                </defs>
              </svg>
              <!-- Avatar inside the ring -->
              <div class="absolute inset-0 flex items-center justify-center">
                <div class="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[11px] font-bold shadow-sm group-hover:scale-105 transition-transform">
                  {{ profileStore.profile?.businessName?.charAt(0).toUpperCase() || 'P' }}
                </div>
              </div>
            </div>
            <!-- Name -->
            <span class="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors max-w-[100px] truncate hidden sm:block">
              {{ (profileStore.profile?.businessName || 'Profile').slice(0, 15) }}{{ (profileStore.profile?.businessName || '').length > 15 ? '...' : '' }}
            </span>

            <!-- Upgrade Badge -->
            <span
              v-if="profileStore.isAtLimit || profileStore.isNearLimit"
              class="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold transition-colors"
              :class="profileStore.isAtLimit ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'"
            >
              <ArrowUpCircle class="w-3 h-3" />
              <span class="hidden sm:inline">Upgrade</span>
            </span>
          </router-link>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-8">
        <!-- Loading State -->
        <div v-if="loading" class="flex items-center justify-center py-20">
          <Loader2 class="w-10 h-10 text-indigo-500 animate-spin" />
        </div>

        <!-- Empty State -->
        <div
          v-else-if="albums.length === 0"
          class="flex flex-col items-center justify-center py-20 text-center"
        >
          <div
            class="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-6"
          >
            <ImageIcon class="w-10 h-10 text-indigo-500" />
          </div>
          <h3 class="text-xl font-bold text-slate-900 mb-2">No albums yet</h3>
          <p class="text-slate-500 mb-6 max-w-sm">
            Create your first album to start organizing and sharing your photos with clients.
          </p>
          <button
            class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-xl"
            @click="openCreateModal()"
          >
            <Plus class="h-4 w-4" />
            Create Your First Album
          </button>
        </div>

        <!-- Albums Grid -->
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <div
            v-for="(album, index) in albums"
            :key="album.id"
            class="group relative bg-white rounded-2xl border border-slate-200 transition-all duration-300 hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 cursor-pointer hover:z-30 focus-within:z-30"
            :class="[
              uiStore.selectedAlbumId === album.id ? 'ring-2 ring-indigo-500' : ''
            ]"
            @click="openAlbum(album)"
          >
            <!-- Thumbnail / Color Block -->
            <div
              class="h-40 relative overflow-hidden rounded-t-2xl"
              :style="{ backgroundColor: getAlbumColor(index).bg }"
            >
              <!-- Thumbnail Image -->
              <img
                v-if="album.thumbnail"
                :src="`file://${album.thumbnail}`"
                :alt="album.title"
                class="w-full h-full object-cover"
              />
              
              <!-- Empty State Icon -->
              <div
                v-else
                class="absolute inset-0 flex items-center justify-center"
              >
                <FolderOpen
                  class="w-12 h-12 opacity-40"
                  :style="{ color: getAlbumColor(index).text }"
                />
              </div>

              <!-- Sync Badge -->
              <div
                v-if="album.needsSync && !album.isOrphaned"
                class="absolute top-3 right-3 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white shadow-lg"
              >
                SYNC
              </div>

              <!-- Orphaned Badge -->
              <div
                v-if="album.isOrphaned"
                class="absolute top-3 right-3 rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-bold text-white shadow-lg"
                title="Source folder was deleted"
              >
                ORPHANED
              </div>

              <!-- Loading Overlay -->
              <div
                v-if="currentUploadingAlbumId === album.id"
                class="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm"
              >
                <Loader2 class="h-8 w-8 animate-spin text-white" />
              </div>
            </div>

            <!-- Info -->
            <div class="p-4">
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-slate-900 truncate">{{ album.title }}</h3>
                  <p class="text-sm text-slate-500 mt-0.5">
                    {{ album.totalImages }} {{ album.totalImages === 1 ? 'photo' : 'photos' }}
                  </p>
                </div>

                <!-- Actions Dropdown -->
                <div @click.stop>
                  <Dropdown align="right" :disabled="currentUploadingAlbumId === album.id">
                    <template #trigger>
                      <button
                        class="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <MoreHorizontal class="h-4 w-4" />
                      </button>
                    </template>
                    <template #content="{ close }">
                      <div class="py-1">
                        <!-- Open Folder -->
                        <button
                          class="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                          @click="
                            () => {
                              close()
                              openFolderInExplorer(album)
                            }
                          "
                        >
                          <FolderOpen class="h-4 w-4" />
                          Open Folder
                        </button>

                        <!-- Sync Option -->
                        <button
                          v-if="album.needsSync"
                          class="flex w-full items-center gap-2 px-4 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
                          @click="
                            () => {
                              close()
                              openSyncModal(album)
                            }
                          "
                        >
                          <RefreshCw class="h-4 w-4" />
                          Sync Album
                        </button>

                        <!-- Delete Option -->
                        <button
                          class="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50"
                          @click="
                            () => {
                              close()
                              openDeleteModal(album)
                            }
                          "
                        >
                          <Trash2 class="h-4 w-4" />
                          Delete Album
                        </button>
                      </div>
                    </template>
                  </Dropdown>
                </div>
              </div>

              <!-- Empty Album Hint -->
              <div
                v-if="album.totalImages === 0"
                class="mt-3 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2"
              >
                <AlertCircle class="h-3.5 w-3.5 flex-shrink-0" />
                <span>Click to open folder and add photos</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Album Modal -->
    <CreateAlbumModal
      :show="showCreateModal"
      @close="showCreateModal = false"
      @created="handleAlbumCreated"
    />

    <!-- Sync Modal -->
    <SyncModal
      :show="showSyncModal"
      :album-id="syncAlbum?.id || ''"
      :album-title="syncAlbum?.title || ''"
      :changes="syncChanges"
      :is-loading="isSyncLoading"
      @close="showSyncModal = false"
      @sync="handleSyncComplete"
    />

    <!-- Delete Confirmation Modal -->
    <div
      v-if="showDeleteModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div class="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl">
        <h3 class="mb-2 text-xl font-bold text-slate-900">Delete Album</h3>
        <p class="mb-4 text-sm text-slate-500">
          This will permanently delete <strong class="text-slate-900">{{ albumToDelete?.title }}</strong> from the cloud
          and your local device. This action cannot be undone.
        </p>

        <div class="mb-4">
          <label class="mb-1.5 block text-xs font-medium text-slate-500">
            Type <span class="text-slate-900 font-bold">{{ albumToDelete?.title }}</span> to confirm
          </label>
          <input
            v-model="deleteConfirmation"
            type="text"
            class="w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
            placeholder="Type album name"
          />
          <p v-if="deleteError" class="mt-1 text-xs text-red-500">{{ deleteError }}</p>
        </div>

        <div class="flex justify-end gap-3">
          <button
            class="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            :disabled="isDeleting"
            @click="showDeleteModal = false"
          >
            Cancel
          </button>
          <button
            class="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
            :disabled="isDeleting || deleteConfirmation !== albumToDelete?.title"
            @click="handleDeleteAlbum"
          >
            {{ isDeleting ? 'Deleting...' : 'Delete Album' }}
          </button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
