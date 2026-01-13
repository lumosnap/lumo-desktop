<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Modal from '../components/ui/Modal.vue'
import Button from '../components/ui/Button.vue'
import NotesSidebar from '../components/NotesSidebar.vue'
import {
  ArrowLeft,
  Heart,
  RefreshCw,
  Share2,
  Copy,
  Check,
  ExternalLink,
  Link2,
  FolderOpen,
  MessageSquare,
  CheckCircle2,
  ChevronDown,
  Loader2
} from 'lucide-vue-next'
import PhotoSwipeLightbox from 'photoswipe/lightbox'
import 'photoswipe/style.css'

const route = useRoute()
const router = useRouter()
const albumId = route.params.id as string

interface Comment {
  clientName: string
  notes: string | null
  createdAt: string
}

interface Image {
  id: number
  originalFilename: string
  localFilePath: string
  fileSize: number
  width: number
  height: number
  uploadStatus: string
  isFavorite?: boolean
  favoriteCount?: number
  notesCount?: number
  comments?: Comment[]
  favoritedBy?: string[] // List of client names who favorited this image
}

interface Album {
  id: string
  title: string
  eventDate?: string | null
  totalImages?: number
}

const album = ref<Album | null>(null)
const images = ref<Image[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showFavoritesOnly = ref(false)
const gridLoading = ref(false)

// Client Name Filter State
const clientNames = ref<string[]>([])
const selectedClientName = ref<string>('')

// Share Link State
const showShareModal = ref(false)
const shareLink = ref('')
const isGeneratingLink = ref(false)
const shareError = ref<string | null>(null)
const copied = ref(false)

// Notes Sidebar State
const showNotesSidebar = ref(false)
const currentNotesImage = ref<Image | null>(null)

// Lightbox
let lightbox: PhotoSwipeLightbox | null = null

// Pagination State
const page = ref(1)
const PAGE_SIZE = 50
const loadMoreTrigger = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

// Computed
const filteredImages = computed(() => {
  if (!showFavoritesOnly.value) return images.value
  return images.value.filter((img) => img.isFavorite)
})

const displayedImages = computed(() => {
  return filteredImages.value.slice(0, page.value * PAGE_SIZE)
})

const favoritedPhotosCount = computed(() => {
  return images.value.filter((img) => img.isFavorite).length
})

const formattedEventDate = computed(() => {
  if (!album.value?.eventDate) return undefined
  return new Date(album.value.eventDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
})

// Setup Intersection Observer for Infinite Scroll
function setupObserver() {
  if (observer) observer.disconnect()
  
  observer = new IntersectionObserver((entries) => {
    const target = entries[0]
    if (target.isIntersecting) {
      if (displayedImages.value.length < filteredImages.value.length) {
        page.value++
      }
    }
  }, {
    root: null,
    rootMargin: '200px', // Load before reaching bottom
    threshold: 0.1
  })
  
  if (loadMoreTrigger.value) {
    observer.observe(loadMoreTrigger.value)
  }
}

// Watch for loading trigger visibility
watch(() => [loadMoreTrigger.value, filteredImages.value.length], () => {
    if(loadMoreTrigger.value) setupObserver()
}, { flush: 'post' })

// Reset page when filter changes
watch(() => [showFavoritesOnly.value, selectedClientName.value], () => {
  page.value = 1
  // Wait for DOM update then re-init lightbox
  nextTick(() => {
    initLightbox()
  })
})

// Get thumbnail path for an image (stored in .thumbnails subfolder)
// Falls back to original if thumbnail doesn't exist
function getThumbnailPath(localFilePath: string): string {
  // localFilePath: /path/to/album/image.webp
  // thumbnail:     /path/to/album/.thumbnails/image.webp
  const lastSlash = localFilePath.lastIndexOf('/')
  if (lastSlash === -1) return localFilePath
  
  const dir = localFilePath.substring(0, lastSlash)
  const filename = localFilePath.substring(lastSlash + 1)
  return `${dir}/.thumbnails/${filename}`
}

async function loadAlbumImages(): Promise<void> {
  loading.value = true
  error.value = null
  page.value = 1

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

    // Load client names for filter dropdown (fetch without filter first)
    await loadFavorites()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load album'
    error.value = message
  } finally {
    loading.value = false
    // Initialize lightbox after DOM update
    await nextTick()
    initLightbox()
    setupObserver()
  }
}

// Load favorites from API and update images with favoritedBy info
async function loadFavorites(clientNameFilter?: string): Promise<void> {
  try {
    const result = await window.api.api.getFavorites(albumId, clientNameFilter)
    if (result.success) {
      // Update clientNames if not filtering (to get all clients)
      if (!clientNameFilter && result.clientNames) {
        clientNames.value = result.clientNames
      }

      // Build a map of filename -> client names who favorited
      const favoritedByMap = new Map<string, string[]>()
      if (result.favorites) {
        for (const fav of result.favorites) {
          const baseName = getBaseName(fav.originalFilename)
          // Extract unique client names from comments
          const clients = fav.comments
            ?.map((c: Comment) => c.clientName)
            .filter((name: string, idx: number, arr: string[]) => arr.indexOf(name) === idx) || []
          favoritedByMap.set(baseName, clients)
        }
      }

      // Update images with favoritedBy info
      images.value = images.value.map((img) => {
        const imgBaseName = getBaseName(img.originalFilename)
        const favoritedBy = favoritedByMap.get(imgBaseName)
        return {
          ...img,
          favoritedBy: favoritedBy || img.favoritedBy
        }
      })
    }
  } catch (err) {
    console.error('Failed to load favorites:', err)
  }
}

// Helper to get base filename without extension
function getBaseName(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot > 0 ? filename.substring(0, lastDot) : filename
}

// Handle client filter change
async function onClientFilterChange(): Promise<void> {
  gridLoading.value = true
  await loadFavorites(selectedClientName.value || undefined)

  // Destroy and reinitialize lightbox
  if (lightbox) {
    lightbox.destroy()
    lightbox = null
  }

  await nextTick()
  initLightbox()
  gridLoading.value = false
}

async function toggleShowFavorites(): Promise<void> {
  showFavoritesOnly.value = !showFavoritesOnly.value
  gridLoading.value = true

  // Destroy and reinitialize lightbox
  if (lightbox) {
    lightbox.destroy()
    lightbox = null
  }

  await nextTick()
  initLightbox()
  gridLoading.value = false
}

async function generateShareLink(): Promise<void> {
  isGeneratingLink.value = true
  shareError.value = null
  copied.value = false

  // Check local storage first
  const storageKey = `shareLink_album_${albumId}`
  const cachedLink = localStorage.getItem(storageKey)
  
  if (cachedLink) {
    shareLink.value = cachedLink
    showShareModal.value = true
    isGeneratingLink.value = false
    return
  }

  try {
    const result = await window.api.api.generateShareLink(albumId)
    if (result.success && result.shareLink) {
      shareLink.value = result.shareLink.shareUrl
      localStorage.setItem(storageKey, result.shareLink.shareUrl)
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

async function showOriginalInFolder(imageId: number): Promise<void> {
  try {
    const result = await window.api.shell.showItemInFolder(albumId, imageId)
    if (!result.success) {
      console.error('Failed to show in folder:', result.error)
    }
  } catch (err) {
    console.error('Failed to show in folder:', err)
  }
}

function openNotesSidebar(image: Image): void {
  currentNotesImage.value = image
  showNotesSidebar.value = true
}

function closeNotesSidebar(): void {
  showNotesSidebar.value = false
  currentNotesImage.value = null
}

function initLightbox(): void {
  if (lightbox) {
    lightbox.destroy()
    lightbox = null
  }

  lightbox = new PhotoSwipeLightbox({
    gallery: '#gallery',
    children: 'a',
    pswpModule: () => import('photoswipe'),
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    bgOpacity: 0.95,
    showHideOpacity: true,
    arrowPrevSVG:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>',
    arrowNextSVG:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>',
    closeSVG:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    zoomSVG:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
  })

  // Add Notes Button to Lightbox
  lightbox.on('uiRegister', () => {
    lightbox!.pswp!.ui!.registerElement({
      name: 'notes-button',
      order: 9,
      isButton: true,
      tagName: 'button',
      html: '<div class="pswp-custom-icon pswp-notes-icon flex items-center justify-center w-full h-full"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>',
      onClick: (_event, _el, pswp) => {
        const currSlide = pswp.currSlide
        if (currSlide && currSlide.data.element) {
          const anchor = currSlide.data.element as HTMLAnchorElement
          const imageSrc = anchor.href
          const image = images.value.find(
            (img) => `file://${img.localFilePath}` === imageSrc || imageSrc.startsWith(`file://${img.localFilePath}`)
          )
          if (image) {
            openNotesSidebar(image)
          }
        }
      }
    })
  })

  lightbox.init()
}

const onAlbumStatusChanged = (
  _e: unknown,
  data: { albumId: string; needsSync: number }
): void => {
  if (data.albumId === albumId && data.needsSync) {
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
  if (lightbox) {
    lightbox.destroy()
    lightbox = null
  }
})
</script>

<template>
  <AppLayout>
    <div class="flex h-full flex-col overflow-hidden bg-slate-50 text-slate-900">
      <!-- Loading State (Skeleton) -->
      <div v-if="loading" class="flex-1 flex flex-col md:flex-row overflow-hidden animate-fade-in">
        <!-- Left Sidebar Skeleton -->
        <aside
          class="w-full md:w-80 lg:w-96 border-b md:border-b-0 md:border-r border-slate-200 bg-white p-6 flex flex-col gap-6 shrink-0"
        >
          <div>
            <div class="flex items-center justify-between mb-2">
              <div class="h-4 w-20 bg-slate-200 rounded animate-pulse"></div>
              <div class="h-6 w-16 bg-emerald-50 rounded-full animate-pulse"></div>
            </div>
            <div class="h-10 w-3/4 bg-slate-200 rounded mb-2 animate-pulse"></div>
            <div class="h-4 w-1/2 bg-slate-200 rounded animate-pulse"></div>
          </div>

          <div class="bg-slate-50 rounded-2xl p-5 border border-slate-100 shadow-inner">
            <div class="h-10 w-full bg-white rounded-xl border border-slate-200 animate-pulse"></div>
          </div>
        </aside>

        <!-- Right Grid Skeleton -->
        <main class="flex-1 overflow-hidden bg-slate-50 p-4 md:p-8">
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <div
              v-for="i in 10"
              :key="i"
              class="aspect-[4/5] rounded-xl bg-slate-200 animate-pulse"
            ></div>
          </div>
        </main>
      </div>

      <!-- Error State -->
      <div
        v-else-if="error"
        class="flex-1 flex flex-col items-center justify-center text-center max-w-md mx-auto px-4"
      >
        <div class="text-6xl mb-6">😕</div>
        <h1 class="text-3xl font-bold mb-4 text-slate-900">Failed to Load Album</h1>
        <p class="text-slate-500 mb-8 leading-relaxed">{{ error }}</p>
        <Button variant="primary" @click="loadAlbumImages">Try Again</Button>
      </div>

      <!-- Main Content Area (Split View) -->
      <div v-else class="flex-1 flex flex-col md:flex-row overflow-hidden animate-fade-in">
        <!-- Left Sidebar -->
        <aside
          class="w-full md:w-80 lg:w-96 border-b md:border-b-0 md:border-r border-slate-200 bg-white p-6 flex flex-col gap-6 shrink-0 overflow-y-auto z-10 shadow-sm md:shadow-none"
        >
          <!-- Back Button -->
          <button
            class="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors w-fit"
            @click="router.back()"
          >
            <ArrowLeft class="h-4 w-4" />
            Back to Albums
          </button>

          <!-- Album Info -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <div class="text-xs font-bold text-indigo-600 uppercase tracking-wider">Album</div>
              <div
                class="flex items-center gap-1.5 text-emerald-600 text-[10px] font-medium bg-emerald-50 px-2 py-1 rounded-full"
              >
                <CheckCircle2 class="h-3 w-3" />
                Synced
              </div>
            </div>
            <h1 class="text-3xl font-serif italic text-slate-900 mb-2">
              {{ album?.title || 'Album' }}
            </h1>
            <p class="text-sm text-slate-400 font-medium">
              <template v-if="formattedEventDate">{{ formattedEventDate }} • </template>
              {{ images.length }} Photos
            </p>
          </div>

          <!-- Actions Card -->
          <div class="bg-slate-50 rounded-2xl p-5 border border-slate-100 shadow-inner space-y-3">
            <!-- Favorites Toggle -->
            <button
              @click="toggleShowFavorites"
              class="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl shadow-sm border transition-all duration-200"
              :class="
                showFavoritesOnly
                  ? 'bg-rose-50 text-rose-600 border-rose-100 ring-2 ring-rose-100'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              "
            >
              <Heart class="h-4 w-4" :fill="showFavoritesOnly ? 'currentColor' : 'none'" />
              <span>{{
                showFavoritesOnly
                  ? 'Show All Images'
                  : `Show Favorites (${favoritedPhotosCount})`
              }}</span>
            </button>

            <!-- Client Filter Dropdown -->
            <div v-if="clientNames.length > 0" class="relative">
              <label class="text-xs font-medium text-slate-500 mb-1.5 block">Filter by Client</label>
              <div class="relative">
                <select
                  v-model="selectedClientName"
                  @change="onClientFilterChange"
                  class="w-full appearance-none bg-white border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 cursor-pointer transition-all"
                >
                  <option value="">All Clients ({{ clientNames.length }})</option>
                  <option v-for="name in clientNames" :key="name" :value="name">
                    {{ name }}
                  </option>
                </select>
                <ChevronDown class="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            <!-- Share Button -->
            <button
              class="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5"
              :disabled="isGeneratingLink"
              @click="generateShareLink"
            >
              <Share2 v-if="!isGeneratingLink" class="h-4 w-4" />
              <RefreshCw v-else class="h-4 w-4 animate-spin" />
              <span>Share Album</span>
            </button>

            <!-- Refresh Button -->
            <button
              class="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              :disabled="loading"
              @click="loadAlbumImages"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
              <span>Refresh</span>
            </button>
          </div>
        </aside>

        <!-- Right Grid Area -->
        <main class="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
          <!-- Grid Loading State -->
          <div
            v-if="gridLoading"
            class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
          >
            <div
              v-for="i in 10"
              :key="i"
              class="aspect-[4/5] rounded-xl bg-slate-200 animate-pulse"
            ></div>
          </div>

          <!-- Empty State -->
          <div
            v-else-if="filteredImages.length === 0"
            class="h-full flex flex-col items-center justify-center text-center p-8 opacity-60"
          >
            <div
              class="w-20 h-20 bg-slate-200 rounded-full flex items-center justify-center mb-6 text-4xl"
            >
              {{ showFavoritesOnly ? '💔' : '📷' }}
            </div>
            <h2 class="text-xl font-bold text-slate-900 mb-2">
              {{ showFavoritesOnly ? 'No Favorites Yet' : 'No Photos Found' }}
            </h2>
            <p class="text-slate-500 max-w-xs">
              {{
                showFavoritesOnly
                  ? 'Clients have not favorited any photos in this album yet.'
                  : 'This album seems to be empty.'
              }}
            </p>
            <button
              v-if="showFavoritesOnly"
              @click="toggleShowFavorites"
              class="mt-6 px-6 py-2 bg-white border border-slate-200 rounded-full text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
            >
              View All Photos
            </button>
          </div>

          <!-- Image Grid (Photoswipe) -->
          <div
            v-else
            id="gallery"
            class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
          >
            <a
              v-for="image in displayedImages"
              :key="image.id"
              :href="`file://${image.localFilePath}`"
              :data-pswp-width="image.width || 1920"
              :data-pswp-height="image.height || 1280"
              target="_blank"
              class="group relative aspect-[4/5] rounded-xl overflow-hidden bg-slate-200 cursor-pointer shadow-sm hover:shadow-md transition-all duration-300 block"
            >
              <img
              :src="`file://${getThumbnailPath(image.localFilePath)}`"
              :alt="image.originalFilename"
              loading="lazy"
              class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              @error="(e) => (e.target as HTMLImageElement).src = `file://${image.localFilePath}`"
            />

              <!-- Gradient Overlay -->
              <div
                class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              ></div>

              <!-- Favorite Badge (Top Right) -->
              <div
                v-if="image.isFavorite"
                class="absolute top-3 right-3 group/fav z-10"
              >
                <div class="h-8 rounded-full flex items-center justify-center px-2 gap-1.5 min-w-8 bg-rose-500 text-white shadow-lg">
                  <Heart class="h-3.5 w-3.5 shrink-0" fill="currentColor" />
                  <span v-if="(image.favoriteCount || 0) > 0" class="text-xs font-bold">{{
                    image.favoriteCount
                  }}</span>
                </div>
                <!-- Who favorited tooltip -->
                <div
                  v-if="image.favoritedBy && image.favoritedBy.length > 0"
                  class="absolute top-full right-0 mt-1.5 opacity-0 group-hover/fav:opacity-100 transition-opacity pointer-events-none"
                >
                  <div class="bg-slate-800/95 backdrop-blur-sm text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap">
                    <div class="font-medium text-slate-300 mb-1">Favorited by:</div>
                    <div v-for="name in image.favoritedBy" :key="name" class="text-white">{{ name }}</div>
                  </div>
                </div>
              </div>

              <!-- Notes Badge (Top Left) -->
              <button
                v-if="(image.notesCount || 0) > 0"
                @click.stop.prevent="openNotesSidebar(image)"
                class="absolute top-3 left-3 h-8 rounded-full flex items-center justify-center px-2 gap-1.5 min-w-8 bg-indigo-500 text-white shadow-md z-10 hover:bg-indigo-600 transition-colors"
              >
                <MessageSquare class="h-3.5 w-3.5 shrink-0" fill="currentColor" />
                <span class="text-xs font-bold">{{ image.notesCount }}</span>
              </button>

              <!-- Image Info (Bottom) - Show on hover -->
              <div
                class="absolute bottom-3 left-3 right-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              >
                <p class="text-white text-xs font-medium truncate flex-1 mr-2">
                  {{ image.originalFilename }}
                </p>
                <button
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-all hover:bg-white/40"
                  title="Show Original in Folder"
                  @click.stop.prevent="showOriginalInFolder(image.id)"
                >
                  <FolderOpen class="h-3.5 w-3.5" />
                </button>
              </div>

              <!-- Upload Status Badge -->
              <div
                v-if="image.uploadStatus !== 'complete'"
                class="absolute bottom-3 right-3 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm backdrop-blur-md z-10"
                :class="{
                  'bg-blue-500/80 text-white': image.uploadStatus === 'uploading',
                  'bg-amber-500/80 text-white': image.uploadStatus === 'compressing',
                  'bg-slate-500/80 text-white': image.uploadStatus === 'pending',
                  'bg-red-500/80 text-white': image.uploadStatus === 'failed'
                }"
              >
                {{ image.uploadStatus }}
              </div>
            </a>
          </div>
          
          <!-- Infinite Scroll Trigger -->
          <div ref="loadMoreTrigger" class="h-10 w-full flex items-center justify-center p-4">
            <Loader2 v-if="displayedImages.length < filteredImages.length" class="h-6 w-6 text-slate-400 animate-spin" />
          </div>
        </main>
      </div>

      <!-- Notes Sidebar -->
      <NotesSidebar
        :is-open="showNotesSidebar"
        :image="currentNotesImage"
        @close="closeNotesSidebar"
      />

      <!-- Share Link Modal -->
      <Modal :show="showShareModal" title="Share Album" @close="showShareModal = false">
        <div class="space-y-6">
          <!-- Header with icon -->
          <div class="flex flex-col items-center text-center">
            <div
              class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/30"
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
                    : 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl'
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
              class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-xl"
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
    </div>
  </AppLayout>
</template>

<style>
/* Animations */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in {
  animation: fadeIn 0.5s ease-out forwards;
}

/* Photoswipe UI Overrides */
.pswp__button {
  background: none !important;
  transition: all 0.2s ease;
  opacity: 0.8;
}

.pswp__button:hover {
  opacity: 1;
  transform: scale(1.1);
}

.pswp__button svg {
  stroke: white !important;
  fill: none !important;
  width: 24px !important;
  height: 24px !important;
}

.pswp__button--arrow--left,
.pswp__button--arrow--right {
  background: rgba(255, 255, 255, 0.1) !important;
  backdrop-filter: blur(10px);
  border-radius: 50%;
  width: 48px !important;
  height: 48px !important;
  margin-top: -24px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.pswp__button--arrow--left:hover,
.pswp__button--arrow--right:hover {
  background: rgba(255, 255, 255, 0.2) !important;
}

.pswp__button--close,
.pswp__button--zoom {
  background: rgba(255, 255, 255, 0.1) !important;
  backdrop-filter: blur(10px);
  border-radius: 12px;
  width: 44px !important;
  height: 44px !important;
  margin: 10px 10px 0 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
}

.pswp__button--close:hover,
.pswp__button--zoom:hover {
  background: rgba(255, 255, 255, 0.2) !important;
}

.pswp-custom-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.pswp__button--notes-button {
  background: rgba(255, 255, 255, 0.1) !important;
  backdrop-filter: blur(10px);
  border-radius: 12px;
  width: 44px !important;
  height: 44px !important;
  margin: 10px 10px 0 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.pswp__button--notes-button:hover {
  background: rgba(255, 255, 255, 0.2) !important;
}

.pswp__counter {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  opacity: 0.8;
  margin-top: 15px;
  margin-left: 20px;
}
</style>
