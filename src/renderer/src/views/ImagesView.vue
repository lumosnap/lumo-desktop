<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Modal from '../components/ui/Modal.vue'
import Button from '../components/ui/Button.vue'
import {
  ArrowLeft,
  Star,
  RefreshCw,
  Grid,
  List,
  Share2,
  Copy,
  Check,
  ExternalLink,
  Link2
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const albumId = route.params.id as string

interface Image {
  id: number
  originalFilename: string
  localFilePath: string
  fileSize: number
  uploadStatus: string
  isFavorite?: boolean
}

interface Album {
  id: string
  title: string
}

const album = ref<Album | null>(null)
const images = ref<Image[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showFavoritesOnly = ref(false)
const viewMode = ref<'grid' | 'list'>('grid')

// Share Link State
const showShareModal = ref(false)
const shareLink = ref('')
const isGeneratingLink = ref(false)
const shareError = ref<string | null>(null)
const copied = ref(false)

const filteredImages = computed(() => {
  if (!showFavoritesOnly.value) return images.value
  return images.value.filter((img) => img.isFavorite)
})

async function loadAlbumImages(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    // Load album details
    const albumResult = await window.api.albums.get(albumId)
    if (albumResult.success) {
      album.value = albumResult.album
    }

    // Load images with favorites
    const imagesResult = await window.api.albums.getImages(albumId)
    if (imagesResult.success) {
      images.value = imagesResult.images || []
    } else {
      error.value = imagesResult.error || 'Failed to load images'
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load album'
    error.value = message
  } finally {
    loading.value = false
  }
}

async function generateShareLink(): Promise<void> {
  isGeneratingLink.value = true
  shareError.value = null
  copied.value = false

  try {
    const result = await window.api.api.generateShareLink(albumId)
    if (result.success && result.shareLink) {
      shareLink.value = result.shareLink.shareUrl
      showShareModal.value = true
    } else {
      shareError.value = result.error || 'Failed to generate share link'
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to generate share link'
    shareError.value = message
  } finally {
    isGeneratingLink.value = false
  }
}

async function copyShareLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareLink.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Fallback for older browsers
    const textArea = document.createElement('textarea')
    textArea.value = shareLink.value
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  }
}

function openShareLink(): void {
  window.open(shareLink.value, '_blank')
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const onAlbumStatusChanged = (_e: any, data: { albumId: string; needsSync: number }): void => {
  if (data.albumId === albumId && data.needsSync) {
    // Reload album details to show sync status if we had a UI for it, 
    // or just show a banner/toast.
    // For now, let's reload the album info to ensure we have latest metadata
    // But mainly we want to inform user they might need to sync.
    // Since this view doesn't have a "Sync" button in the header (only in AlbumView),
    // maybe we should add one or just rely on the user going back.
    // Actually, let's just reload the album to get the updated 'needsSync' flag if we use it.
    // But wait, 'album' ref is just { id, title }.
    // Let's re-fetch album details.
    window.api.albums.get(albumId).then((result) => {
      if (result.success) {
        album.value = result.album
      }
    })
  }
}

onMounted(() => {
  loadAlbumImages()

  if (window.api && window.api.on) {
    window.api.on('album:status-changed', onAlbumStatusChanged)
  }
})

onUnmounted(() => {
  if (window.api && window.api.off) {
    window.api.off('album:status-changed', onAlbumStatusChanged)
  }
})
</script>

<template>
  <AppLayout>
    <div class="flex h-full flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-8 py-6 border-b border-black/5">
        <div class="flex items-center gap-4">
          <button
            class="rounded-lg p-2 text-[var(--color-text-on-light-muted)] hover:bg-black/5 transition-colors"
            @click="router.back()"
          >
            <ArrowLeft class="h-5 w-5" />
          </button>

          <div>
            <div
              class="flex items-center gap-2 text-xs font-medium text-[var(--color-text-on-light-muted)] mb-1"
            >
              <span>Albums</span>
              <span>/</span>
              <span>{{ album?.title || 'Loading...' }}</span>
            </div>
            <h1 class="text-2xl font-bold text-[var(--color-text-on-light)]">
              {{ album?.title || 'Album Images' }}
            </h1>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <!-- View Toggle -->
          <div class="view-toggle">
            <button
              class="view-toggle-btn"
              :class="{ active: viewMode === 'grid' }"
              @click="viewMode = 'grid'"
            >
              <Grid class="h-4 w-4" />
            </button>
            <button
              class="view-toggle-btn"
              :class="{ active: viewMode === 'list' }"
              @click="viewMode = 'list'"
            >
              <List class="h-4 w-4" />
            </button>
          </div>

          <!-- Favorites filter -->
          <button
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all"
            :class="
              showFavoritesOnly
                ? 'bg-[var(--color-turquoise)] text-white shadow-lg shadow-teal-500/20'
                : 'bg-black/5 text-[var(--color-text-on-light-muted)] hover:bg-black/10'
            "
            @click="showFavoritesOnly = !showFavoritesOnly"
          >
            <Star class="h-4 w-4" :class="{ 'fill-current': showFavoritesOnly }" />
            <span>Favorites</span>
          </button>

          <!-- Share Button -->
          <button
            class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[var(--color-turquoise)] to-teal-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-teal-500/25 transition-all hover:shadow-xl hover:shadow-teal-500/30 hover:-translate-y-0.5"
            :disabled="isGeneratingLink"
            @click="generateShareLink"
          >
            <Share2 v-if="!isGeneratingLink" class="h-4 w-4" />
            <RefreshCw v-else class="h-4 w-4 animate-spin" />
            <span>Share Album</span>
          </button>

          <Button variant="secondary" size="sm" :disabled="loading" @click="loadAlbumImages">
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
          </Button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="content-scrollable flex-1 overflow-y-auto p-8">
        <!-- Loading state -->
        <div v-if="loading" class="flex flex-col items-center justify-center py-24">
          <RefreshCw class="h-12 w-12 text-[var(--color-turquoise)] animate-spin mb-4" />
          <p class="text-[var(--color-text-on-light-muted)]">Loading images...</p>
        </div>

        <!-- Error state -->
        <div v-else-if="error" class="rounded-2xl bg-red-50 border border-red-100 p-8 text-center">
          <p class="text-red-600 mb-4">{{ error }}</p>
          <Button variant="secondary" size="sm" @click="loadAlbumImages">Try Again</Button>
        </div>

        <!-- Empty state -->
        <div
          v-else-if="filteredImages.length === 0"
          class="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-black/5 bg-black/[0.02] p-16 text-center"
        >
          <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-black/5">
            <Star class="h-8 w-8 text-gray-400" />
          </div>
          <h2 class="text-xl font-bold text-[var(--color-text-on-light)] mb-2">
            {{ showFavoritesOnly ? 'No Favorites Yet' : 'No Images' }}
          </h2>
          <p class="text-[var(--color-text-on-light-muted)] max-w-xs mx-auto">
            {{
              showFavoritesOnly
                ? 'Images favorited by clients will appear here'
                : 'Upload some images to get started'
            }}
          </p>
        </div>

        <!-- Grid View -->
        <div
          v-else-if="viewMode === 'grid'"
          class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6"
        >
          <div
            v-for="img in filteredImages"
            :key="img.id"
            class="group relative aspect-square overflow-hidden rounded-2xl bg-gray-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
          >
            <!-- Image -->
            <img
              :src="`file://${img.localFilePath}?t=${Date.now()}`"
              :alt="img.originalFilename"
              class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
            />

            <!-- Overlay -->
            <div
              class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 flex flex-col justify-end p-4"
            >
              <p class="truncate text-sm font-medium text-white">{{ img.originalFilename }}</p>
              <p class="text-xs text-white/70">{{ formatFileSize(img.fileSize) }}</p>
            </div>

            <!-- Favorite star -->
            <div
              v-if="img.isFavorite"
              class="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-yellow-400 shadow-lg"
            >
              <Star class="h-4 w-4 fill-current text-yellow-900" />
            </div>

            <!-- Upload status badge -->
            <div
              v-if="img.uploadStatus !== 'complete'"
              class="absolute right-3 top-3 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm backdrop-blur-md"
              :class="{
                'bg-blue-500/80 text-white': img.uploadStatus === 'uploading',
                'bg-amber-500/80 text-white': img.uploadStatus === 'compressing',
                'bg-gray-500/80 text-white': img.uploadStatus === 'pending',
                'bg-red-500/80 text-white': img.uploadStatus === 'failed'
              }"
            >
              {{ img.uploadStatus }}
            </div>
          </div>
        </div>

        <!-- List View -->
        <div v-else class="space-y-2">
          <div
            v-for="img in filteredImages"
            :key="img.id"
            class="flex items-center gap-4 rounded-xl border border-black/5 bg-white p-3 hover:bg-gray-50"
          >
            <img
              :src="`file://${img.localFilePath}?t=${Date.now()}`"
              class="h-12 w-12 rounded-lg object-cover"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-[var(--color-text-on-light)]">
                {{ img.originalFilename }}
              </p>
              <p class="text-xs text-[var(--color-text-on-light-muted)]">
                {{ formatFileSize(img.fileSize) }}
              </p>
            </div>
            <div v-if="img.isFavorite">
              <Star class="h-4 w-4 fill-yellow-400 text-yellow-400" />
            </div>
            <div
              v-if="img.uploadStatus !== 'complete'"
              class="rounded-full px-2 py-1 text-[10px] font-bold uppercase"
              :class="{
                'bg-blue-100 text-blue-600': img.uploadStatus === 'uploading',
                'bg-amber-100 text-amber-600': img.uploadStatus === 'compressing',
                'bg-gray-100 text-gray-600': img.uploadStatus === 'pending',
                'bg-red-100 text-red-600': img.uploadStatus === 'failed'
              }"
            >
              {{ img.uploadStatus }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Share Link Modal -->
    <Modal :show="showShareModal" title="Share Album" @close="showShareModal = false">
      <div class="space-y-6">
        <!-- Header with icon -->
        <div class="flex flex-col items-center text-center">
          <div
            class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-turquoise)] to-teal-400 shadow-lg shadow-teal-500/30"
          >
            <Link2 class="h-8 w-8 text-white" />
          </div>
          <h3 class="text-lg font-semibold text-gray-900">Your share link is ready!</h3>
          <p class="mt-1 text-sm text-gray-500">
            Share this link with your clients to let them view and favorite photos
          </p>
        </div>

        <!-- Link Display -->
        <div class="rounded-xl bg-gray-50 p-4">
          <div class="flex items-center gap-3">
            <div
              class="flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              <p class="truncate text-sm font-medium text-gray-700">{{ shareLink }}</p>
            </div>
            <button
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-all"
              :class="
                copied
                  ? 'bg-green-500 text-white shadow-lg shadow-green-500/30'
                  : 'bg-[var(--color-turquoise)] text-white shadow-lg shadow-teal-500/30 hover:shadow-xl'
              "
              @click="copyShareLink"
            >
              <Check v-if="copied" class="h-5 w-5" />
              <Copy v-else class="h-5 w-5" />
            </button>
          </div>
          <p v-if="copied" class="mt-2 text-center text-sm font-medium text-green-600">
            ✓ Copied to clipboard!
          </p>
        </div>

        <!-- Actions -->
        <div class="flex gap-3">
          <button
            class="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            @click="openShareLink"
          >
            <ExternalLink class="h-4 w-4" />
            Open in Browser
          </button>
          <button
            class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--color-turquoise)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-500/25 transition-all hover:shadow-xl"
            @click="showShareModal = false"
          >
            Done
          </button>
        </div>

        <!-- Share Error -->
        <div
          v-if="shareError"
          class="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600"
        >
          {{ shareError }}
        </div>
      </div>
    </Modal>
  </AppLayout>
</template>
