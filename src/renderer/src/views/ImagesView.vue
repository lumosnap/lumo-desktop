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
  Layers,
  Plus,
  Minus,
  MoreHorizontal,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon
} from 'lucide-vue-next'
import PhotoTile from '../components/PhotoTile.vue'
import PhotoSwipeLightbox from 'photoswipe/lightbox'
import type PhotoSwipe from 'photoswipe'
import type { SlideData } from 'photoswipe'
import 'photoswipe/style.css'
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/vue-virtual'
import {
  columnsForWidth,
  flattenRows,
  orderForGrouping,
  inSet,
  moved,
  momentSetName,
  GRID_GAP,
  type GroupableImage,
  type Row,
  type Tile
} from '../utils/grid'
import { tagLabel, tagCounts, withTags, searchTags } from '../utils/tags'

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

interface Image extends GroupableImage {
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
  tags?: string[]
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

// Lightbox: slides come from this array, since tiles may be virtualized away
let lightbox: PhotoSwipeLightbox | null = null
let lbItems: Image[] = []
let lbFromGrid = false // false while browsing one burst's frames
const galleryEl = ref<HTMLElement | null>(null)

// "Picked by" tooltip
const tip = ref<{ left: number; top: number; names: string[] } | null>(null)

// Virtualized rows, scrolled by AppLayout's #main
const scrollEl = ref<HTMLElement | null>(null)
const columns = ref(4)
const galleryWidth = ref(0)
const scrollMargin = ref(0)
const stackBursts = ref(true)

// Selection
const selectedImageIds = ref<Set<number>>(new Set())
const isSelectionMode = computed(() => selectedImageIds.value.size > 0)
const copying = ref(false)

// A stacked burst selects and deselects as a whole
const tileIds = (tile: Tile<Image>): number[] => (tile.burst ?? [tile.image]).map((i) => i.id)
const isTileSelected = (tile: Tile<Image>): boolean =>
  tileIds(tile).every((id) => selectedImageIds.value.has(id))

function toggleTile(tile: Tile<Image>): void {
  const on = isTileSelected(tile)
  const next = new Set(selectedImageIds.value)
  for (const id of tileIds(tile)) {
    if (on) next.delete(id)
    else next.add(id)
  }
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

// Sets: photographer-defined groups. The grid shows one set (or all photos), then picks on top.
type SetsResult = Awaited<ReturnType<typeof window.api.sets.list>>
type AlbumSet = Extract<SetsResult, { success: true }>['sets'][number]
const sets = ref<AlbumSet[]>([])
const activeSetId = ref<string | null>(null)
const activeSet = computed(() => sets.value.find((s) => s.id === activeSetId.value) ?? null)

function applySets(result: SetsResult): boolean {
  if (!result.success) {
    toast(`Couldn't update sets: ${result.error}`)
    return false
  }
  sets.value = result.sets
  if (activeSetId.value && !activeSet.value) activeSetId.value = null
  return true
}

async function setsCall(call: Promise<SetsResult>, done?: string): Promise<boolean> {
  try {
    const ok = applySets(await call)
    if (ok && done) toast(done)
    return ok
  } catch (err) {
    toast(`Couldn't update sets: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

const loadSets = (): Promise<boolean> => setsCall(window.api.sets.list(albumId))

function viewSet(id: string | null): void {
  activeSetId.value = id
  closePop()
}

// One popover at a time: a set's menu, "Add to set", or a name prompt
type Pop =
  | { kind: 'set'; set: AlbumSet }
  | { kind: 'add' }
  | { kind: 'name'; label: string; name: string; submit: (name: string) => Promise<boolean> }
const pop = ref<Pop | null>(null)
const popStyle = ref<Record<string, string>>({})
const popEl = ref<HTMLElement>()
const popBusy = ref(false)

async function openPop(p: Pop, e?: Event): Promise<void> {
  if (e) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const up = r.bottom + 240 > innerHeight
    popStyle.value = {
      left: `${Math.max(8, Math.min(r.left, innerWidth - 288))}px`,
      ...(up ? { bottom: `${innerHeight - r.top + 6}px` } : { top: `${r.bottom + 6}px` })
    }
  }
  pop.value = p
  await nextTick()
  ;(popEl.value?.querySelector('input') ?? popEl.value?.querySelector('button'))?.focus()
}

function closePop(): void {
  pop.value = null
}

// Without an event the prompt takes the place of the popover that's open
function promptName(
  label: string,
  name: string,
  submit: (name: string) => Promise<boolean>,
  e?: Event
): void {
  openPop({ kind: 'name', label, name, submit }, e)
}

async function submitName(): Promise<void> {
  const p = pop.value
  if (p?.kind !== 'name' || !p.name.trim() || popBusy.value) return
  popBusy.value = true
  try {
    if (await p.submit(p.name.trim())) closePop()
  } finally {
    popBusy.value = false
  }
}

function onDocPointer(e: PointerEvent): void {
  const t = e.target as HTMLElement
  if (pop.value && !t.closest?.('.menu, [aria-haspopup]')) closePop()
}
function onDocKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closePop()
}

function newSet(e: Event): void {
  promptName(
    'New set',
    '',
    (name) =>
      setsCall(
        window.api.sets.create(albumId, name),
        `Created “${name}”. Select photos and choose Add to set.`
      ),
    e
  )
}

function renameSet(set: AlbumSet): void {
  promptName('Rename set', set.name, (name) => setsCall(window.api.sets.rename(set.id, name)))
}

async function moveSet(set: AlbumSet, delta: number): Promise<void> {
  closePop()
  const order = moved(
    sets.value.map((s) => s.id),
    set.id,
    delta
  )
  await setsCall(window.api.sets.reorder(albumId, order))
}

const selectedIds = (): number[] => Array.from(selectedImageIds.value)
const photos = (n: number): string => `${nf(n)} ${n === 1 ? 'photo' : 'photos'}`

async function addSelectedTo(set: AlbumSet): Promise<void> {
  closePop()
  const ids = selectedIds()
  if (
    await setsCall(
      window.api.sets.addImages(set.id, ids),
      `Added ${photos(ids.length)} to “${set.name}”`
    )
  )
    clearSelection()
}

function newSetFromSelection(): void {
  const ids = selectedIds()
  promptName('New set', '', async (name) => {
    const ok = await setsCall(
      window.api.sets.create(albumId, name, ids),
      `Added ${photos(ids.length)} to “${name}”`
    )
    if (ok) clearSelection()
    return ok
  })
}

async function removeSelectedFromSet(): Promise<void> {
  const set = activeSet.value
  if (!set) return
  const ids = selectedIds()
  if (
    await setsCall(
      window.api.sets.removeImages(set.id, ids),
      `Removed ${photos(ids.length)} from “${set.name}”`
    )
  )
    clearSelection()
}

async function useAsCover(): Promise<void> {
  const set = activeSet.value
  if (!set) return
  if (
    await setsCall(
      window.api.sets.setCover(set.id, selectedIds()[0]),
      `Cover for “${set.name}” set`
    )
  )
    clearSelection()
}

function makeSetFromMoment(row: Extract<Row<Image>, { kind: 'header' }>, e: Event): void {
  promptName(
    'Make a set from this moment',
    momentSetName(row.label),
    (name) =>
      setsCall(
        window.api.sets.fromMoment(albumId, String(row.momentId), name),
        `Created “${name}”`
      ),
    e
  )
}

// Delete confirmation
const setToDelete = ref<AlbumSet | null>(null)
const deletingSet = ref(false)
function askDeleteSet(set: AlbumSet): void {
  closePop()
  setToDelete.value = set
}
async function confirmDeleteSet(): Promise<void> {
  const set = setToDelete.value
  if (!set || deletingSet.value) return
  deletingSet.value = true
  if (await setsCall(window.api.sets.delete(set.id), `Deleted “${set.name}”`))
    setToDelete.value = null
  deletingSet.value = false
}

// Capture-time order when the album has moments, else upload order
const orderedImages = computed(() => orderForGrouping(images.value))
// Set, then picks: the scope tag chips count over
const scopedImages = computed(() => {
  const inView = inSet(orderedImages.value, activeSet.value?.imageIds ?? null)
  if (!showFavoritesOnly.value) return inView
  return inView.filter((img) => img.isFavorite)
})
const filteredImages = computed(() => withTags(scopedImages.value, activeTags.value))

// Tag filter: chips for the most frequent tags in scope, all of them while searching
const activeTags = ref<string[]>([])
const tagQuery = ref('')
const hasTags = computed(() => images.value.some((img) => img.tags?.length))
const tagChips = computed(() => {
  const counts = tagCounts(scopedImages.value)
  const shown = tagQuery.value ? searchTags(counts, tagQuery.value) : counts.slice(0, 10)
  // Active tags stay visible first, even when out of scope or not matching the search
  const n = new Map(counts)
  return [
    ...activeTags.value.map((t) => [t, n.get(t) ?? 0] as const),
    ...shown.filter(([t]) => !activeTags.value.includes(t))
  ]
})
function toggleTag(slug: string): void {
  const on = activeTags.value.includes(slug)
  activeTags.value = on ? activeTags.value.filter((t) => t !== slug) : [...activeTags.value, slug]
}
function clearTags(): void {
  activeTags.value = []
  tagQuery.value = ''
}

const grid = computed(() =>
  flattenRows(filteredImages.value, { columns: columns.value, stackBursts: stackBursts.value })
)
const hasBursts = computed(() => images.value.some((img) => img.burstId != null))
const HEADER_H = 44

const tileH = (): number =>
  galleryWidth.value
    ? (((galleryWidth.value - GRID_GAP * (columns.value - 1)) / columns.value) * 2) / 3
    : 160

// The moment header at or above the first visible row stays rendered so it can stick.
// Set inside rangeExtractor, read by virtualRows after the virtualizer notifies.
let activeHeader: number | null = null

const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: grid.value.rows.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: (i: number) => (grid.value.rows[i]?.kind === 'header' ? HEADER_H : tileH()),
    gap: GRID_GAP,
    overscan: 3,
    scrollMargin: scrollMargin.value,
    getItemKey: (i: number) => grid.value.rows[i]?.key ?? i,
    rangeExtractor: (range: Range) => {
      activeHeader = null
      for (const h of grid.value.headers) {
        if (h.row > range.startIndex) break
        activeHeader = h.row
      }
      const next = defaultRangeExtractor(range).filter((i) => i !== activeHeader)
      return activeHeader === null ? next : [activeHeader, ...next]
    }
  }))
)

const virtualRows = computed(() =>
  rowVirtualizer.value.getVirtualItems().map((v) => ({
    v,
    row: grid.value.rows[v.index],
    sticky: v.index === activeHeader
  }))
)

// Column count, row height and the gallery's offset in the scroller, kept in step with layout
function updateGridLayout(): void {
  const el = galleryEl.value
  if (!el) return
  scrollEl.value = el.closest('.main') as HTMLElement | null
  columns.value = columnsForWidth(el.clientWidth, window.innerWidth)
  galleryWidth.value = el.clientWidth
  if (scrollEl.value)
    scrollMargin.value =
      el.getBoundingClientRect().top -
      scrollEl.value.getBoundingClientRect().top +
      scrollEl.value.scrollTop
  rowVirtualizer.value.measure()
}

const resizeObserver = new ResizeObserver(() => updateGridLayout())
// AppLayout's offline / low-storage banners come and go above the gallery and shift it
const bannerObserver = new MutationObserver(() => updateGridLayout())
watch(
  galleryEl,
  (el) => {
    resizeObserver.disconnect()
    bannerObserver.disconnect()
    if (el) {
      resizeObserver.observe(el)
      updateGridLayout()
      if (scrollEl.value) bannerObserver.observe(scrollEl.value, { childList: true })
    }
  },
  { flush: 'post' }
)
// The selection bar is a little taller than the title bar, which moves the grid
watch(isSelectionMode, () => nextTick(updateGridLayout))
// So does the tag row appearing once photos are analysed
watch(hasTags, () => nextTick(updateGridLayout))

const currentHeader = computed(() => virtualRows.value.find((r) => r.sticky)?.v.index ?? null)

function scrollToMoment(row: number): void {
  rowVirtualizer.value.scrollToIndex(row, { align: 'start' })
}

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
  const base = activeSet.value?.name
  if (!showFavoritesOnly.value) return base ?? 'All photos'
  const picks = selectedClientName.value
    ? `${firstName(selectedClientName.value)}'s picks`
    : 'Client picks'
  return base ? `${base} · ${picks}` : picks
})

const formattedEventDate = computed(() => {
  if (!album.value?.eventDate) return undefined
  return new Date(album.value.eventDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
})

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
  }
}

// Grouping changed in main: swap in the new fields in place, keeping picks and scroll position
let offAnalyzed: (() => void) | null = null
let offSetsChanged: (() => void) | null = null
async function refreshGrouping(): Promise<void> {
  const result = await window.api.albums.getImages(albumId)
  if (!result.success || !result.images) return
  const prev = new Map(images.value.map((img) => [img.id, img]))
  const top = scrollEl.value?.scrollTop
  images.value = result.images.map((img) => {
    const old = prev.get(img.id)
    return old
      ? {
          ...img,
          isFavorite: old.isFavorite,
          favoritedBy: old.favoritedBy,
          favoriteCount: old.favoriteCount,
          comments: old.comments,
          notesCount: old.notesCount
        }
      : img
  })
  await nextTick()
  if (scrollEl.value && top !== undefined) scrollEl.value.scrollTop = top
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
  if (selectedClientName.value) {
    selectedClientName.value = ''
    await onClientFilterChange()
  }
}

async function viewFav(): Promise<void> {
  await waitForFavorites()
  showFavoritesOnly.value = true
}

async function pickClient(name: string): Promise<void> {
  selectedClientName.value = selectedClientName.value === name ? '' : name
  showFavoritesOnly.value = true
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

function toSlide(image: Image): SlideData {
  return {
    src: `file://${image.localFilePath}`,
    msrc:
      getDisplayStatus(image.uploadStatus) === 'Failed'
        ? undefined
        : `file://${getThumbnailPath(image.localFilePath)}`,
    width: image.width || 1920,
    height: image.height || 1280,
    alt: image.originalFilename
  }
}

// In selection mode a click selects instead of opening the lightbox.
// A stacked burst opens over just its own frames.
function handleImageClick(event: MouseEvent, tile: Tile<Image>): void {
  if (isSelectionMode.value) {
    event.preventDefault()
    toggleTile(tile)
    return
  }
  // Modifier clicks keep the link's default, as PhotoSwipe's own handler did
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !lightbox) return
  event.preventDefault()
  lbFromGrid = !tile.burst
  lbItems = tile.burst ?? grid.value.tiles.map((t) => t.image)
  const start = tile.burst ? tile.burst.indexOf(tile.image) : tile.index
  lightbox.loadAndOpen(Math.max(0, start), lbItems.map(toSlide), {
    x: event.clientX,
    y: event.clientY
  })
}

const ICON = (paths: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

// The image behind the current PhotoSwipe slide
function slideImage(pswp: PhotoSwipe): Image | undefined {
  const id = lbItems[pswp.currIndex]?.id
  // Prefer the live copy, which picks up client picks merged in after opening
  return images.value.find((img) => img.id === id) ?? lbItems[pswp.currIndex]
}

function initLightbox(): void {
  if (lightbox) {
    lightbox.destroy()
    lightbox = null
  }

  lightbox = new PhotoSwipeLightbox({
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

    // AI tags, a quiet line along the bottom
    ui.registerElement({
      name: 'lb-tags',
      order: 10,
      appendTo: 'root',
      onInit: (el, pswp) => {
        pswp.on('change', () => {
          const tags = slideImage(pswp)?.tags || []
          el.hidden = tags.length === 0
          el.textContent = tags.map(tagLabel).join(' · ')
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

  // Zoom from the tile while it's mounted; null falls back to a fade
  lightbox.addFilter('thumbEl', (_el, _data, index) => {
    const at = lbFromGrid ? index : grid.value.tiles.findIndex((t) => t.image.id === lbItems[0]?.id)
    return document.querySelector(`#gallery [data-pswp-index="${at}"] img`) as HTMLElement // null falls back to a fade
  })

  // Keep the current slide's row rendered so closing animates back to it
  const scrollToCurrent = (): void => {
    const index = lightbox?.pswp?.currIndex
    if (!lbFromGrid || index === undefined) return
    const row = grid.value.tileRow[index]
    if (row !== undefined) rowVirtualizer.value.scrollToIndex(row)
  }
  lightbox.on('change', scrollToCurrent)
  lightbox.on('close', scrollToCurrent)

  lightbox.init()
}

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
  initLightbox()
  window.addEventListener('keydown', onKeydown, true)
  if (window.api && window.api.on) window.api.on('album:status-changed', onAlbumStatusChanged)
  offAnalyzed = window.api.albums.onAnalyzed((id) => {
    if (id === albumId && !loading.value) refreshGrouping()
  })
  loadSets()
  offSetsChanged = window.api.sets.onSetsChanged((id) => {
    if (id === albumId) loadSets()
  })
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onDocKey)
  document.addEventListener('scroll', closePop, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (window.api && window.api.off) window.api.off('album:status-changed', onAlbumStatusChanged)
  resizeObserver.disconnect()
  bannerObserver.disconnect()
  offAnalyzed?.()
  offSetsChanged?.()
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onDocKey)
  document.removeEventListener('scroll', closePop, true)
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
          <template v-if="activeSet">
            <button v-if="selectedImageIds.size === 1" class="btn sm ghost" @click="useAsCover">
              <ImageIcon />Use as cover
            </button>
            <button class="btn sm ghost" @click="removeSelectedFromSet">
              <Minus />Remove from set
            </button>
          </template>
          <button
            class="btn sm ghost"
            aria-haspopup="menu"
            :aria-expanded="pop?.kind === 'add'"
            @click="openPop({ kind: 'add' }, $event)"
          >
            <Plus />Add to set…
          </button>
          <button class="btn sm primary" :disabled="copying" @click="copySelectedImages">
            <span v-if="copying" class="spin"></span><Copy v-else />Copy
            {{ nf(selectedImageIds.size) }} to folder…
          </button>
        </div>
        <div v-else class="g-bar">
          <span class="t">{{ barTitle }}</span>
          <span class="m num">{{ nf(filteredImages.length) }}</span>
          <button
            v-if="hasBursts"
            class="btn sm ghost stack-toggle"
            style="margin-left: auto"
            :aria-pressed="stackBursts"
            @click="stackBursts = !stackBursts"
          >
            <Layers />Stack bursts
          </button>
        </div>

        <div v-if="images.length" class="set-bar" role="toolbar" aria-label="Sets">
          <button class="btn sm ghost" :aria-pressed="!activeSet" @click="viewSet(null)">
            All photos <span class="n num">{{ nf(images.length) }}</span>
          </button>
          <template v-for="s in sets" :key="s.id">
            <button
              class="btn sm ghost"
              :aria-pressed="activeSetId === s.id"
              @click="viewSet(s.id)"
              @contextmenu.prevent="openPop({ kind: 'set', set: s }, $event)"
            >
              {{ s.name }} <span class="n num">{{ nf(s.imageIds.length) }}</span>
            </button>
            <button
              v-if="activeSetId === s.id"
              class="icon-btn sm plain"
              aria-haspopup="menu"
              :aria-expanded="pop?.kind === 'set'"
              :aria-label="`Options for ${s.name}`"
              :title="`Options for ${s.name}`"
              @click="openPop({ kind: 'set', set: s }, $event)"
            >
              <MoreHorizontal />
            </button>
          </template>
          <button class="btn sm ghost" aria-haspopup="dialog" @click="newSet">
            <Plus />New set
          </button>
        </div>

        <div v-if="hasTags" class="set-bar" role="toolbar" aria-label="Tags">
          <input
            v-model="tagQuery"
            class="input tag-search"
            type="search"
            placeholder="Find a tag"
            aria-label="Find a tag"
            autocomplete="off"
            spellcheck="false"
          />
          <button
            v-for="[slug, n] in tagChips"
            :key="slug"
            class="btn sm ghost"
            :aria-pressed="activeTags.includes(slug)"
            @click="toggleTag(slug)"
          >
            {{ tagLabel(slug) }} <span class="n num">{{ nf(n) }}</span>
          </button>
          <span v-if="tagQuery && !tagChips.length" class="n">No tags match</span>
          <button
            v-if="activeTags.length || tagQuery"
            class="icon-btn sm plain"
            aria-label="Clear tag filters"
            title="Clear tag filters"
            @click="clearTags"
          >
            <X />
          </button>
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

        <div v-else-if="filteredImages.length === 0 && activeTags.length" class="empty">
          <h2>No photos tagged {{ activeTags.map(tagLabel).join(' + ') }}</h2>
          <p>Try fewer tags{{ activeSet || showFavoritesOnly ? ', or a wider view' : '' }}.</p>
          <button class="btn ghost" @click="clearTags">Clear tags</button>
        </div>

        <div
          v-else-if="filteredImages.length === 0 && activeSet && !showFavoritesOnly"
          class="empty"
        >
          <h2>“{{ activeSet.name }}” is empty</h2>
          <p>Select photos in All photos, then choose Add to set.</p>
          <button class="btn ghost" @click="viewSet(null)">View all photos</button>
        </div>

        <div v-else-if="filteredImages.length === 0" class="empty">
          <h2>No picks yet</h2>
          <p>When your client hearts a photo on their link, it shows up here</p>
          <button class="btn ghost" @click="viewAll">View all photos</button>
        </div>

        <template v-else>
          <div class="g-browse">
            <div id="gallery" ref="galleryEl" :class="{ selecting: isSelectionMode }">
              <div
                style="position: relative"
                :style="{ height: `${rowVirtualizer.getTotalSize()}px` }"
              >
                <template v-for="{ v, row, sticky } in virtualRows" :key="v.key">
                  <div
                    v-if="row.kind === 'header'"
                    class="g-moment"
                    :class="{ sticky }"
                    :style="
                      sticky ? undefined : { transform: `translateY(${v.start - scrollMargin}px)` }
                    "
                  >
                    {{ row.label }}
                    <button
                      v-if="row.momentId != null && !activeSet && !showFavoritesOnly"
                      class="btn sm ghost g-make-set"
                      aria-haspopup="dialog"
                      @click="makeSetFromMoment(row, $event)"
                    >
                      <Plus />Make set
                    </button>
                  </div>
                  <div
                    v-else
                    class="photos g-row"
                    :style="{
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                      transform: `translateY(${v.start - scrollMargin}px)`
                    }"
                  >
                    <PhotoTile
                      v-for="tile in row.tiles"
                      :key="tile.image.id"
                      :image="tile.image"
                      :burst="tile.burst"
                      :index="tile.index"
                      :status="getDisplayStatus(tile.image.uploadStatus)"
                      :thumb="`file://${getThumbnailPath(tile.image.localFilePath)}`"
                      :selected="isTileSelected(tile)"
                      @open="handleImageClick($event, tile)"
                      @toggle="toggleTile(tile)"
                      @tip="showTip"
                      @untip="tip = null"
                      @notes="openNotesSidebar(tile.image)"
                      @reveal="showOriginalInFolder(tile.image)"
                    />
                  </div>
                </template>
              </div>
            </div>
            <nav v-if="grid.headers.length > 1" class="g-scrub" aria-label="Moments">
              <button
                v-for="h in grid.headers"
                :key="h.row"
                :aria-label="h.label"
                :title="h.label"
                :aria-current="h.row === currentHeader || undefined"
                @click="scrollToMoment(h.row)"
              >
                {{ h.label.split(' · ')[1] }}
              </button>
            </nav>
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

    <Teleport to="body">
      <div
        v-if="pop"
        ref="popEl"
        class="menu"
        :role="pop.kind === 'name' ? 'dialog' : 'menu'"
        :aria-label="pop.kind === 'name' ? pop.label : undefined"
        :style="popStyle"
      >
        <form v-if="pop.kind === 'name'" class="set-name" @submit.prevent="submitName">
          <label for="set-name-in">{{ pop.label }}</label>
          <div class="input-row">
            <input
              id="set-name-in"
              v-model="pop.name"
              class="input"
              maxlength="120"
              autocomplete="off"
              placeholder="Set name"
            />
            <button class="btn primary" :disabled="!pop.name.trim() || popBusy">
              <span v-if="popBusy" class="spin"></span>Save
            </button>
          </div>
        </form>
        <template v-else-if="pop.kind === 'add'">
          <button v-for="s in sets" :key="s.id" role="menuitem" @click="addSelectedTo(s)">
            {{ s.name }}<span class="n num">{{ nf(s.imageIds.length) }}</span>
          </button>
          <hr v-if="sets.length" />
          <button role="menuitem" @click="newSetFromSelection"><Plus />New set…</button>
        </template>
        <template v-else>
          <button role="menuitem" @click="renameSet(pop.set)"><Pencil />Rename…</button>
          <button
            role="menuitem"
            :disabled="sets[0]?.id === pop.set.id"
            @click="moveSet(pop.set, -1)"
          >
            <ChevronLeft />Move left
          </button>
          <button
            role="menuitem"
            :disabled="sets[sets.length - 1]?.id === pop.set.id"
            @click="moveSet(pop.set, 1)"
          >
            <ChevronRight />Move right
          </button>
          <hr />
          <button role="menuitem" class="bad" @click="askDeleteSet(pop.set)">
            <Trash2 />Delete set…
          </button>
        </template>
      </div>
    </Teleport>

    <Modal
      :show="!!setToDelete"
      :title="`Delete “${setToDelete?.name || ''}”?`"
      @close="!deletingSet && (setToDelete = null)"
    >
      <p>
        The {{ photos(setToDelete?.imageIds.length || 0) }} stay in the album. Only the set goes
        away, here and on your client's link.
      </p>
      <template #footer>
        <button class="btn ghost" :disabled="deletingSet" @click="setToDelete = null">
          Cancel
        </button>
        <button class="btn danger" :disabled="deletingSet" autofocus @click="confirmDeleteSet">
          <span v-if="deletingSet" class="spin"></span>Delete set
        </button>
      </template>
    </Modal>

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

<style scoped>
.g-row,
.g-moment {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
.g-moment {
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 13px;
  color: var(--ink-2);
  background: var(--card);
}
.g-moment.sticky {
  position: sticky;
  z-index: 2;
}
.stack-toggle[aria-pressed='true'],
.set-bar .btn[aria-pressed='true'] {
  background: var(--brand-wash);
  border-color: var(--brand-soft);
}
/* One line that scrolls sideways, so the gallery's offset never changes */
.set-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 12px 12px;
  overflow-x: auto;
  scrollbar-width: none;
}
.set-bar > * {
  flex: none;
}
.tag-search {
  width: 160px;
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
}
.set-bar .n,
.menu .n {
  color: var(--ink-3);
  font-size: 12px;
}
.menu .n {
  margin-left: auto;
}
.set-name {
  display: grid;
  gap: 8px;
  width: 272px;
  padding: 4px;
  font-size: 13px;
  color: var(--ink-2);
}
.set-name .btn {
  width: auto;
  flex: none;
  height: 40px;
  padding: 0 16px;
}
.menu button:disabled {
  opacity: 0.4;
  background: none;
}
.g-make-set {
  margin-left: auto;
  height: 28px;
  opacity: 0;
  transition: opacity 0.12s;
}
.g-moment:hover .g-make-set,
.g-make-set:focus-visible {
  opacity: 1;
}
/* The scrubber takes its own column, so the grid's width (and column count) leaves room for it */
.g-browse {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
#gallery {
  flex: 1;
  min-width: 0;
}
.g-scrub {
  position: sticky;
  top: 50vh;
  transform: translateY(-50%);
  flex: none;
  z-index: 5;
  display: grid;
  gap: 2px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 4px;
  background: var(--card);
  border-radius: var(--r-inset);
  box-shadow: var(--lift);
}
.g-scrub button {
  border: 0;
  background: none;
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--ink-3);
  text-align: right;
  white-space: nowrap;
}
.g-scrub button:hover {
  background: var(--inset);
  color: var(--ink);
}
.g-scrub button[aria-current='true'] {
  background: var(--brand-wash);
  color: var(--ink);
}
</style>

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
.pswp__lb-tags {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  max-width: calc(100% - 160px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: oklch(70% 0 0);
  pointer-events: none;
}
.pswp__lb-tags[hidden] {
  display: none;
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
