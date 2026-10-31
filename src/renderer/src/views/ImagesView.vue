<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Modal from '../components/ui/Modal.vue'
import NotesSidebar from '../components/NotesSidebar.vue'
import { toast } from '../composables/useToast'
import { useNetworkStore } from '../stores/network'
import {
  ArrowLeft,
  Heart,
  RefreshCw,
  RotateCw,
  Link,
  Copy,
  Check,
  X,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  MessageSquare,
  ImageOff
} from 'lucide-vue-next'
import PhotoSwipeLightbox from 'photoswipe/lightbox'
import type PhotoSwipe from 'photoswipe'
import 'photoswipe/style.css'

const route = useRoute()
const networkStore = useNetworkStore()
const albumId = route.params.id as string

const getDisplayStatus = (status: string): 'Processing' | 'Failed' | 'Success' => {
  if (['pending', 'compressing', 'uploading'].includes(status)) return 'Processing'
  if (['failed', 'failed_compression', 'failed_upload'].includes(status)) return 'Failed'
  return 'Success'
}

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
  favoritedBy?: string[] // client names who favorited this image
}

interface Album {
  id: string
  title: string
  eventDate?: string | null
  totalImages?: number
  sourceFolderPath?: string
  needsSync?: number
  isOrphaned?: number
}

const nf = (n: number): string => n.toLocaleString()
const firstName = (s: string): string => s.split(' ')[0]
const initials = (s: string): string =>
  s
    .split(/\s|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')

const album = ref<Album | null>(null)
const images = ref<Image[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showFavoritesOnly = ref(false)
const gridLoading = ref(false)

// Client filter ("Picked by")
const clientNames = ref<string[]>([])
const selectedClientName = ref<string>('')
const isFavoritesLoaded = ref(false)
const isLoadingFavorites = ref(false)

// Share link
const showShareModal = ref(false)
const shareLink = ref('')
const isGeneratingLink = ref(false)
const copied = ref(false)
const showShareNext = ref(false)

// Notes panel
const showNotesSidebar = ref(false)
const currentNotesImage = ref<Image | null>(null)
let notesReturnFocus: HTMLElement | null = null

// Lightbox
let lightbox: PhotoSwipeLightbox | null = null
const galleryEl = ref<HTMLElement | null>(null)

// "Picked by" tooltip
const tip = ref<{ left: number; top: number; names: string[] } | null>(null)

// Pagination
const page = ref(1)
const PAGE_SIZE = 50
const loadMoreTrigger = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

// Selection
const selectedImageIds = ref<Set<number>>(new Set())
const isSelectionMode = computed(() => selectedImageIds.value.size > 0)
const copying = ref(false)

function toggleSelection(imageId: number): void {
  const next = new Set(selectedImageIds.value)
  if (next.has(imageId)) next.delete(imageId)
  else next.add(imageId)
  selectedImageIds.value = next
}

function selectAll(): void {
  selectedImageIds.value = new Set([
    ...selectedImageIds.value,
    ...filteredImages.value.map((img) => img.id)
  ])
}

function clearSelection(): void {
  selectedImageIds.value = new Set()
}

async function copySelectedImages(): Promise<void> {
  if (selectedImageIds.value.size === 0 || copying.value) return
  copying.value = true
  try {
    const result = await window.api.albums.copyImages(albumId, Array.from(selectedImageIds.value))
    if (result.success) {
      const missing = result.errorCount
        ? ` ${nf(result.errorCount)} originals weren't found in the album folder.`
        : ''
      const dir = result.destinationDir
      toast(
        `Copied ${nf(result.count || 0)} photos.${missing}`,
        dir ? { label: 'Show in Finder', run: () => window.api.shell.openFolder(dir) } : undefined
      )
      clearSelection()
    } else if (result.error !== 'Operation canceled') {
      toast(`Couldn't copy the photos: ${result.error}`)
    }
  } catch (err) {
    toast(`Couldn't copy the photos: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    copying.value = false
  }
}

const filteredImages = computed(() => {
  if (!showFavoritesOnly.value) return images.value
  return images.value.filter((img) => img.isFavorite)
})

const displayedImages = computed(() => filteredImages.value.slice(0, page.value * PAGE_SIZE))

const favoritedPhotosCount = computed(() => images.value.filter((img) => img.isFavorite).length)

// Per-client pick counts, taken from the unfiltered favorites response
const clientCounts = ref<Record<string, number>>({})

const processingCount = computed(
  () => images.value.filter((img) => getDisplayStatus(img.uploadStatus) === 'Processing').length
)

const statusLine = computed(() => {
  if (processingCount.value)
    return { dot: 'brand', text: `Adding ${nf(processingCount.value)} new` }
  if (album.value?.isOrphaned) return { dot: 'bad', text: 'Folder missing' }
  if (album.value?.needsSync) return { dot: 'warn', text: 'Folder changed' }
  return { dot: 'ok', text: 'Synced' }
})

const barTitle = computed(() => {
  if (!showFavoritesOnly.value) return 'All photos'
  return selectedClientName.value
    ? `${firstName(selectedClientName.value)}'s picks`
    : 'Client picks'
})

const formattedEventDate = computed(() => {
  if (!album.value?.eventDate) return undefined
  return new Date(album.value.eventDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
})

// Infinite scroll
function setupObserver(): void {
  if (observer) observer.disconnect()
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && displayedImages.value.length < filteredImages.value.length) {
        page.value++
      }
    },
    { root: null, rootMargin: '200px', threshold: 0.1 }
  )
  if (loadMoreTrigger.value) observer.observe(loadMoreTrigger.value)
}

// Re-observe after each page so a trigger that stays in view keeps loading
watch(
  () => [loadMoreTrigger.value, filteredImages.value.length, displayedImages.value.length],
  () => {
    if (loadMoreTrigger.value) setupObserver()
  },
  { flush: 'post' }
)

// Thumbnail lives in a .thumbnails subfolder; falls back to the original on error
function getThumbnailPath(localFilePath: string): string {
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
  isFavoritesLoaded.value = false

  try {
    const albumResult = await window.api.albums.get(albumId)
    if (albumResult.success) album.value = albumResult.album

    const imagesResult = await window.api.albums.getImages(albumId)
    if (imagesResult.success) {
      images.value = imagesResult.images || []
    } else {
      error.value = imagesResult.error || 'Failed to load images'
    }

    // Non-blocking: let the grid render before fetching picks
    setTimeout(() => {
      loadFavorites()
    }, 100)
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Failed to load album'
  } finally {
    loading.value = false
    await nextTick()
    setupObserver()
  }
}

// Fetch picks and merge who-picked, notes and comments into the images
async function loadFavorites(clientNameFilter?: string): Promise<void> {
  if (isLoadingFavorites.value) return
  isLoadingFavorites.value = true

  try {
    const result = await window.api.api.getFavorites(albumId, clientNameFilter)
    if (result.success) {
      // Only the unfiltered response carries every client
      if (!clientNameFilter) {
        if (result.clientNames) clientNames.value = result.clientNames
        const counts: Record<string, number> = {}
        for (const fav of result.favorites || [])
          for (const name of new Set((fav.comments || []).map((c) => c.clientName)))
            counts[name] = (counts[name] || 0) + 1
        clientCounts.value = counts
      }

      const favMap = new Map<string, { by: string[]; comments: Comment[]; notesCount: number }>()
      for (const fav of result.favorites || []) {
        const comments = fav.comments || []
        favMap.set(getBaseName(fav.originalFilename), {
          by: [...new Set(comments.map((c) => c.clientName))],
          comments,
          notesCount: fav.notesCount || comments.filter((c) => c.notes?.trim()).length
        })
      }

      images.value = images.value.map((img) => {
        const fav = favMap.get(getBaseName(img.originalFilename))
        return {
          ...img,
          isFavorite: !!fav && fav.by.length > 0,
          favoritedBy: fav?.by || [],
          favoriteCount: fav?.by.length || 0,
          comments: fav?.comments || img.comments || [],
          notesCount: fav?.notesCount || img.notesCount || 0
        }
      })

      isFavoritesLoaded.value = true
    } else if (result.error) {
      toast(`Couldn't load client picks: ${result.error}`)
    }
  } catch (err) {
    toast(`Couldn't load client picks: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    isLoadingFavorites.value = false
  }
}

function getBaseName(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot > 0 ? filename.substring(0, lastDot) : filename
}

async function waitForFavorites(): Promise<void> {
  if (isFavoritesLoaded.value) return
  gridLoading.value = true
  if (!isLoadingFavorites.value) {
    await loadFavorites()
  } else {
    await new Promise<void>((resolve) => {
      const unwatch = watch(isLoadingFavorites, (v) => {
        if (!v) {
          unwatch()
          resolve()
        }
      })
    })
  }
  gridLoading.value = false
}

// Server-side client filter, as before: refetch favorites for that client
async function onClientFilterChange(): Promise<void> {
  gridLoading.value = true
  await loadFavorites(selectedClientName.value || undefined)
  gridLoading.value = false
}

async function viewAll(): Promise<void> {
  showFavoritesOnly.value = false
  page.value = 1
  if (selectedClientName.value) {
    selectedClientName.value = ''
    await onClientFilterChange()
  }
}

async function viewFav(): Promise<void> {
  await waitForFavorites()
  showFavoritesOnly.value = true
  page.value = 1
}

async function pickClient(name: string): Promise<void> {
  selectedClientName.value = selectedClientName.value === name ? '' : name
  showFavoritesOnly.value = true
  page.value = 1
  clearSelection()
  await onClientFilterChange()
}

async function generateShareLink(): Promise<void> {
  isGeneratingLink.value = true
  copied.value = false
  showShareNext.value = false

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
      toast(result.error || 'Failed to generate share link')
    }
  } catch (err: unknown) {
    toast(err instanceof Error ? err.message : 'Failed to generate share link')
  } finally {
    isGeneratingLink.value = false
  }
}

async function copyShareLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareLink.value)
  } catch {
    const textArea = document.createElement('textarea')
    textArea.value = shareLink.value
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
  copied.value = true
  showShareNext.value = true
  setTimeout(() => {
    copied.value = false
  }, 1800)
}

function openShareLink(): void {
  window.open(shareLink.value, '_blank')
}

async function showOriginalInFolder(image: Image): Promise<void> {
  try {
    const result = await window.api.shell.showItemInFolder(albumId, image.id)
    if (!result.success) toast(`Couldn't show ${image.originalFilename}: ${result.error}`)
  } catch (err) {
    toast(
      `Couldn't show ${image.originalFilename}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

async function showAlbumFolder(): Promise<void> {
  if (!album.value?.sourceFolderPath) return
  const result = await window.api.shell.openFolder(album.value.sourceFolderPath)
  if (!result.success) toast(`Couldn't open the folder: ${result.error}`)
}

function openNotesSidebar(image: Image): void {
  notesReturnFocus = document.activeElement as HTMLElement | null
  currentNotesImage.value = image
  showNotesSidebar.value = true
}

function closeNotesSidebar(): void {
  showNotesSidebar.value = false
  currentNotesImage.value = null
  notesReturnFocus?.focus()
}

// In selection mode a click selects instead of opening the lightbox
function handleImageClick(event: MouseEvent, image: Image): void {
  if (isSelectionMode.value) {
    event.preventDefault()
    event.stopPropagation() // keep PhotoSwipe's gallery click handler from opening
    toggleSelection(image.id)
  }
}

const ICON = (paths: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

// The image behind the current PhotoSwipe slide
function slideImage(pswp: PhotoSwipe): Image | undefined {
  const anchor = pswp.currSlide?.data.element as HTMLAnchorElement | undefined
  if (!anchor) return undefined
  const imageSrc = anchor.href
  return images.value.find(
    (img) =>
      `file://${img.localFilePath}` === imageSrc ||
      imageSrc.startsWith(`file://${img.localFilePath}`)
  )
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
    counter: false, // replaced by the filename + counter element below
    arrowPrevSVG: ICON('<path d="m15 18-6-6 6-6"/>'),
    arrowNextSVG: ICON('<path d="m9 18 6-6-6-6"/>'),
    closeSVG: ICON('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    zoomSVG: ICON(
      '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>'
    )
  })

  lightbox.on('uiRegister', () => {
    const ui = lightbox!.pswp!.ui!

    // Filename + "N / total", top left
    ui.registerElement({
      name: 'lb-info',
      order: 5,
      appendTo: 'bar',
      onInit: (el, pswp) => {
        const f = document.createElement('span')
        f.className = 'f'
        const c = document.createElement('span')
        c.className = 'c num'
        el.append(f, c)
        pswp.on('change', () => {
          f.textContent = slideImage(pswp)?.originalFilename || ''
          c.textContent = `${pswp.currIndex + 1} / ${nf(pswp.getNumItems())}`
        })
      }
    })

    // Who picked this photo
    ui.registerElement({
      name: 'lb-picked',
      order: 8,
      appendTo: 'bar',
      onInit: (el, pswp) => {
        el.className += ' status'
        pswp.on('change', () => {
          const by = slideImage(pswp)?.favoritedBy || []
          el.hidden = by.length === 0
          el.innerHTML = ICON(
            '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>'
          )
          el.append(by.map(firstName).join(', '))
        })
      }
    })

    // Notes button opens the notes panel
    ui.registerElement({
      name: 'notes-button',
      order: 9,
      isButton: true,
      tagName: 'button',
      title: 'Client notes',
      ariaLabel: 'Client notes',
      html: ICON('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
      onClick: (_event, _el, pswp) => {
        const image = slideImage(pswp)
        if (image) openNotesSidebar(image)
      }
    })
  })

  lightbox.init()
}

// Re-init whenever the #gallery element is (re)created
watch(
  galleryEl,
  (el) => {
    if (el) initLightbox()
  },
  { flush: 'post' }
)

function showTip(e: Event, names: string[]): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tip.value = {
    left: Math.max(8, Math.min(r.right - 150, innerWidth - 216)),
    top: r.bottom + 6,
    names
  }
}

// Capture phase, ahead of PhotoSwipe's own keys: while the notes panel is open,
// Esc closes the panel only and the lightbox underneath doesn't move
function onKeydown(e: KeyboardEvent): void {
  if (!showNotesSidebar.value) return
  if (!['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'z'].includes(e.key)) return
  e.stopImmediatePropagation()
  if (e.key === 'Escape') closeNotesSidebar()
}

const onAlbumStatusChanged = (_e: unknown, data: { albumId: string; needsSync: number }): void => {
  if (data.albumId === albumId && data.needsSync) {
    window.api.albums.get(albumId).then((result) => {
      if (result.success) album.value = result.album
    })
  }
}

onMounted(() => {
  loadAlbumImages()
  window.addEventListener('keydown', onKeydown, true)
  if (window.api && window.api.on) window.api.on('album:status-changed', onAlbumStatusChanged)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (window.api && window.api.off) window.api.off('album:status-changed', onAlbumStatusChanged)
  observer?.disconnect()
  if (lightbox) {
    lightbox.destroy()
    lightbox = null
  }
})
</script>

<template>
  <AppLayout>
    <!-- Loading -->
    <div v-if="loading" class="gallery">
      <div class="g-side">
        <div class="card">
          <div class="skel" style="height: 12px; width: 40%; border-radius: 6px"></div>
          <div
            class="skel"
            style="height: 28px; width: 80%; border-radius: 8px; margin: 16px 0"
          ></div>
          <div class="skel" style="height: 36px; border-radius: 99px"></div>
        </div>
      </div>
      <div class="g-main">
        <div class="photos" aria-busy="true">
          <div v-for="i in 18" :key="i" class="ph skel"></div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="page">
      <div style="padding: 16px 8px 0">
        <RouterLink class="back" to="/albums"><ArrowLeft />Albums</RouterLink>
      </div>
      <div class="card empty">
        <h2>Couldn't load {{ album?.title || 'this album' }}</h2>
        <p>{{ error }} The photos on this computer are fine.</p>
        <button class="btn primary" @click="loadAlbumImages"><RotateCw />Try again</button>
      </div>
    </div>

    <div v-else class="gallery">
      <div class="g-side">
        <div class="card">
          <RouterLink class="back" to="/albums"><ArrowLeft />Albums</RouterLink>
          <div class="label">
            <span>Album</span>
            <span class="status"
              ><span class="dot" :class="statusLine.dot"></span>{{ statusLine.text }}</span
            >
          </div>
          <h1>{{ album?.title || 'Album' }}</h1>
          <div style="color: var(--ink-3); font-size: 14px" class="num">
            <template v-if="formattedEventDate">{{ formattedEventDate }} · </template
            >{{ nf(images.length) }} photos
          </div>
          <div style="display: flex; gap: 8px; margin-top: 20px">
            <button
              class="btn primary"
              style="flex: 1"
              :disabled="!networkStore.isOnline || isGeneratingLink"
              @click="generateShareLink"
            >
              <span v-if="isGeneratingLink" class="spin"></span><Link v-else />Share with client
            </button>
            <button
              class="icon-btn"
              aria-label="Reload photos"
              title="Reload photos"
              @click="loadAlbumImages"
            >
              <RefreshCw />
            </button>
          </div>
        </div>

        <div class="card" :style="clientNames.length ? 'padding-bottom:8px' : ''">
          <div class="seg" role="group" aria-label="Show" style="width: 100%">
            <button style="flex: 1" :aria-pressed="!showFavoritesOnly" @click="viewAll">
              All <span class="n num">{{ nf(images.length) }}</span>
            </button>
            <button style="flex: 1" :aria-pressed="showFavoritesOnly" @click="viewFav">
              <Heart style="width: 16px; height: 16px" />Picks
              <span
                v-if="isLoadingFavorites && !isFavoritesLoaded"
                class="spin"
                style="width: 12px; height: 12px"
              ></span>
              <span v-else class="n num">{{ nf(favoritedPhotosCount) }}</span>
            </button>
          </div>
          <template v-if="clientNames.length">
            <div style="margin: 16px 0 8px; font-size: 13px; color: var(--ink-3)">Picked by</div>
            <div class="people">
              <button
                v-for="name in clientNames"
                :key="name"
                class="person"
                :aria-pressed="selectedClientName === name"
                @click="pickClient(name)"
              >
                <span class="avatar">{{ initials(name) }}</span
                >{{ name }}
                <span class="n num">{{ nf(clientCounts[name] || 0) }}</span>
              </button>
            </div>
          </template>
        </div>
      </div>

      <section class="g-main" aria-label="Photos">
        <div v-if="isSelectionMode" class="g-bar sel" role="toolbar" aria-label="Selection">
          <button class="icon-btn sm" aria-label="Clear selection" @click="clearSelection">
            <X />
          </button>
          <span class="t num">{{ nf(selectedImageIds.size) }} selected</span>
          <button class="btn sm ghost" style="margin-left: auto" @click="selectAll">
            Select all {{ nf(filteredImages.length) }}
          </button>
          <button class="btn sm primary" :disabled="copying" @click="copySelectedImages">
            <span v-if="copying" class="spin"></span><Copy v-else />Copy
            {{ nf(selectedImageIds.size) }} to folder…
          </button>
        </div>
        <div v-else class="g-bar">
          <span class="t">{{ barTitle }}</span>
          <span class="m num">{{ nf(filteredImages.length) }}</span>
        </div>

        <div v-if="gridLoading" class="photos" aria-busy="true">
          <div v-for="i in 18" :key="i" class="ph skel"></div>
        </div>

        <div v-else-if="images.length === 0" class="empty">
          <h2>No photos in this album</h2>
          <p>
            Drop photos into <b>{{ album?.sourceFolderPath || 'its folder' }}</b
            >. They upload on their own.
          </p>
          <button v-if="album?.sourceFolderPath" class="btn ghost" @click="showAlbumFolder">
            <FolderOpen />Show in Finder
          </button>
        </div>

        <div v-else-if="filteredImages.length === 0" class="empty">
          <h2>No picks yet</h2>
          <p>When your client hearts a photo on their link, it shows up here</p>
          <button class="btn ghost" @click="viewAll">View all photos</button>
        </div>

        <template v-else>
          <div id="gallery" ref="galleryEl" class="photos" :class="{ selecting: isSelectionMode }">
            <div
              v-for="image in displayedImages"
              :key="image.id"
              class="ph"
              :class="{
                on: selectedImageIds.has(image.id),
                failed: getDisplayStatus(image.uploadStatus) === 'Failed'
              }"
            >
              <a
                :href="`file://${image.localFilePath}`"
                :data-pswp-width="image.width || 1920"
                :data-pswp-height="image.height || 1280"
                target="_blank"
                :aria-label="
                  image.originalFilename +
                  (image.favoritedBy?.length
                    ? ', picked by ' + image.favoritedBy.map(firstName).join(', ')
                    : '')
                "
                style="
                  display: grid;
                  place-items: center;
                  width: 100%;
                  height: 100%;
                  color: inherit;
                  text-decoration: none;
                "
                @click.capture="handleImageClick($event, image)"
              >
                <span v-if="getDisplayStatus(image.uploadStatus) === 'Failed'"
                  ><ImageOff /><br />{{ image.originalFilename }}<br />couldn't be read</span
                >
                <img
                  v-else
                  :src="`file://${getThumbnailPath(image.localFilePath)}`"
                  :alt="image.originalFilename"
                  loading="lazy"
                  @error="
                    (e) => ((e.target as HTMLImageElement).src = `file://${image.localFilePath}`)
                  "
                />
              </a>
              <span v-if="getDisplayStatus(image.uploadStatus) === 'Failed'" class="chip"
                >Failed</span
              >
              <button
                class="sel-ctl"
                :aria-pressed="selectedImageIds.has(image.id)"
                :aria-label="`Select ${image.originalFilename}`"
                @click.stop="toggleSelection(image.id)"
              >
                <Check />
              </button>
              <div class="chips">
                <span
                  v-if="image.favoritedBy?.length"
                  class="chip fav"
                  tabindex="0"
                  :aria-label="`Picked by ${image.favoritedBy.join(', ')}`"
                  @pointerenter="showTip($event, image.favoritedBy)"
                  @pointerleave="tip = null"
                  @focus="showTip($event, image.favoritedBy)"
                  @blur="tip = null"
                >
                  <Heart />{{ image.favoritedBy.length }}
                </span>
                <button
                  v-if="(image.notesCount || 0) > 0"
                  class="chip"
                  :aria-label="`${image.notesCount} client notes`"
                  @click.stop="openNotesSidebar(image)"
                >
                  <MessageSquare />{{ image.notesCount }}
                </button>
              </div>
              <span v-if="getDisplayStatus(image.uploadStatus) === 'Processing'" class="chip proc">
                <span
                  class="spin brand"
                  style="width: 12px; height: 12px; border-width: 1.5px"
                ></span
                >Processing
              </span>
              <div class="fname">
                <span>{{ image.originalFilename }}</span>
                <button
                  aria-label="Show original in Finder"
                  title="Show original in Finder"
                  @click.stop="showOriginalInFolder(image)"
                >
                  <FolderSearch />
                </button>
              </div>
            </div>
          </div>
          <div
            v-if="displayedImages.length < filteredImages.length"
            ref="loadMoreTrigger"
            class="loadmore"
          >
            <span class="spin"></span>Loading more photos
          </div>
        </template>
      </section>
    </div>

    <Teleport to="body">
      <div v-if="tip" class="tip" :style="{ left: `${tip.left}px`, top: `${tip.top}px` }">
        <b>Picked by</b>
        <template v-for="(n, i) in tip.names" :key="n"><br v-if="i" />{{ n }}</template>
      </div>
    </Teleport>

    <NotesSidebar
      :is-open="showNotesSidebar"
      :image="currentNotesImage"
      @close="closeNotesSidebar"
    />

    <Modal
      :show="showShareModal"
      title="Client link"
      :sub="album?.title"
      @close="showShareModal = false"
    >
      <p>
        Send this to your client. They can view the photos, heart their picks and leave notes. No
        account needed.
      </p>
      <div class="input-row">
        <input class="input mono" readonly :value="shareLink" aria-label="Client link" />
        <button class="btn primary" @click="copyShareLink">
          <Check v-if="copied" /><Copy v-else />{{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <p v-if="showShareNext" style="font-size: 14px">
        <Check style="width: 16px; height: 16px; color: var(--ok); vertical-align: -3px" /> Copied.
        Paste it in WhatsApp or email. Their hearts and notes appear in this album as they pick.
      </p>
      <template #footer>
        <button class="btn ghost" @click="openShareLink"><ExternalLink />Open in browser</button>
        <button class="btn primary" @click="showShareModal = false">Done</button>
      </template>
    </Modal>
  </AppLayout>
</template>

<style>
/* PhotoSwipe chrome in the mock's lightbox look (.lb) */
.pswp {
  --pswp-bg: oklch(15% 0.005 255);
  --pswp-root-z-index: 60; /* under the notes panel (70) */
  font-family: inherit;
}
.pswp__top-bar {
  height: auto;
  padding: 16px;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.pswp__lb-info {
  margin-right: auto;
  display: flex;
  gap: 8px;
  min-width: 0;
}
.pswp__lb-info .f {
  color: oklch(85% 0 0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pswp__lb-info .c {
  color: oklch(62% 0 0);
  margin-left: 8px;
}
.pswp__lb-picked {
  color: oklch(80% 0 0);
  margin-right: 8px;
}
.pswp__lb-picked[hidden] {
  display: none;
}
.pswp__lb-picked svg {
  width: 16px;
  height: 16px;
  fill: white;
  stroke: white;
}
.pswp__button,
.pswp__button:hover,
.pswp__button:focus,
.pswp__button:active {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: oklch(25% 0.005 255);
  color: oklch(90% 0 0);
  opacity: 1;
}
.pswp__button:hover {
  background: oklch(32% 0.005 255);
  color: white;
}
.pswp__button svg {
  width: 18px;
  height: 18px;
}
.pswp--zoomed-in .pswp__button--zoom {
  background: white;
  color: var(--ink);
}
.pswp__button--arrow {
  margin-top: -18px;
}
.pswp__button--arrow--prev {
  left: 20px;
}
.pswp__button--arrow--next {
  right: 20px;
}
</style>
