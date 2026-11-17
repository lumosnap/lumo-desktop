<script setup lang="ts">
import { fileUrl } from '../utils/fileUrl'
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Modal from '../components/ui/Modal.vue'
import CreateAlbumModal from '../components/CreateAlbumModal.vue'
import SyncModal from '../components/SyncModal.vue'
import ShareLinkModal from '../components/ShareLinkModal.vue'
import UploadPill from '../components/UploadPill.vue'
import CloudAlbums from '../components/CloudAlbums.vue'
import {
  RefreshCw,
  Plus,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  ImagePlus,
  RotateCw,
  Upload,
  FolderInput
} from 'lucide-vue-next'
import type { Album } from '../stores/album'
import type { IpcRendererEvent } from 'electron'
import type { SyncChanges } from '../../../main/ipc/sync'
import type { RelinkPreview } from '../../../main/ipc/albums'
import type { UploadProgress } from '../../../main/pipeline'
import { useAlbumStore } from '../stores/album'
import { useProfileStore } from '../stores/profile'
import { useNetworkStore } from '../stores/network'
import { toast } from '../composables/useToast'
import { albumDay, fileManager, fileSize, nf } from '../utils/format'
import { relinkError as relinkWords } from '../utils/cloud'

const albumStore = useAlbumStore()
const profileStore = useProfileStore()
const networkStore = useNetworkStore()
const router = useRouter()

const albums = computed(() => albumStore.albums)
const totalPhotos = computed(() => albums.value.reduce((n, a) => n + (a.totalImages || 0), 0))
const albumDate = (a: Album): string => albumDay(a.eventDate, a.createdAt)
const showIn = `Show in ${fileManager()}`

const showCreateModal = ref(false)

// Upload state
const isProcessing = ref(false)
const currentUploadingAlbumId = ref<string | null>(null)
const uploadProgress = ref<UploadProgress | null>(null)
const uploadDone = ref(false)
const uploadAlbum = computed(() =>
  albums.value.find(
    (a) => a.id === (uploadProgress.value?.albumId || currentUploadingAlbumId.value)
  )
)
const failedCount = computed(() => {
  const p = uploadProgress.value
  return p ? (p.failed || 0) + (p.failed_compression || 0) + (p.failed_upload || 0) : 0
})

// Menu state (mock: fixed-position, opens upward near the bottom edge)
const menuFor = ref<Album | null>(null)
const menuStyle = ref<Record<string, string>>({})
const menuEl = ref<HTMLElement>()

// Delete state
const showDeleteModal = ref(false)
const albumToDelete = ref<Album | null>(null)
const deleteConfirmation = ref('')
const isDeleting = ref(false)
const deleteError = ref('')

// Sync state
const showSyncModal = ref(false)
const syncAlbum = ref<Album | null>(null)
const syncChanges = ref<SyncChanges | null>(null)
const isSyncLoading = ref(false)

// Share state
const shareAlbum = ref<Album | null>(null)

// Upload again: the server lost this album (e.g. its database was reset)
const reuploadAlbum = ref<Album | null>(null)
const isReuploading = ref(false)
const reuploadError = ref('')

// Choose folder: point a "Folder missing" album at where its photos are now
const relinkAlbum = ref<Album | null>(null)
const relinkPreview = ref<RelinkPreview | null>(null)
const relinkError = ref('')
// The folder can't be this album's (another album has it): the dialog offers another pick
const relinkRepick = ref(false)
const isRelinking = ref(false)
// Most photos aren't in the picked folder: the confirm button says "anyway"
const relinkMostlyMissing = computed(() => {
  const p = relinkPreview.value
  return !!p && p.missing * 2 > p.matched + p.missing + p.renamed
})

const isRefreshing = ref(false)

function isUploading(album: Album): boolean {
  return currentUploadingAlbumId.value === album.id && !uploadDone.value
}

function openAlbum(album: Album): void {
  // Don't allow opening albums while they are processing
  if (isUploading(album)) return
  if (album.isOrphaned) attachId.value = album.id
  else router.push(`/albums/${album.id}`)
}

// The drive as the person knows it: its label ("NO NAME"), else the /Volumes name or "G:"
// Only a real label is quoted; a bare "D:" or the fallback reads as words
const driveName = (a: Album): string =>
  a.volumeLabel ? `“${a.volumeLabel}”` : a.volumeName || 'the drive'

// Attach panel: an unplugged or missing album, opened. It waits for the drive and goes on into
// the album when the folder is back (album:reattached reloads the list, so does a refresh)
const attachId = ref<string | null>(null)
const attachAlbum = computed(() => albums.value.find((a) => a.id === attachId.value))
watch(attachAlbum, (a) => {
  if (!attachId.value || a?.isOrphaned) return
  attachId.value = null
  if (a) router.push(`/albums/${a.id}`)
})
// The visible "Waiting…" line comes in with the dialog, so a screen reader would not say it.
// This live region is in the dialog from the start and gets its text after the dialog opens
const attachSaid = ref('')
let attachSayTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => (attachId.value && attachAlbum.value?.unplugged ? attachId.value : null),
  (id) => {
    clearTimeout(attachSayTimer)
    attachSaid.value = ''
    // ponytail: a fixed wait for Chromium to see the region; tune if a reader misses it
    if (id) attachSayTimer = setTimeout(() => (attachSaid.value = 'Waiting for the drive…'), 300)
  }
)
function attachOpenAnyway(): void {
  const a = attachAlbum.value
  attachId.value = null
  if (a) router.push(`/albums/${a.id}`)
}
// The panel stays while the picker is up, so a cancelled pick leaves the person where they were
async function attachChoose(): Promise<void> {
  const a = attachAlbum.value
  if (!a) return
  const folder = await window.api.dialog.openDirectory()
  if (!folder || attachId.value !== a.id) return
  attachId.value = null
  openRelink(a, folder)
}

function openFolderInExplorer(album: Album): void {
  closeMenu()
  if (album.sourceFolderPath) window.api.shell.openFolder(album.sourceFolderPath)
}

let loadDebounceTimer: ReturnType<typeof setTimeout> | null = null
function loadAlbums(): void {
  if (loadDebounceTimer) clearTimeout(loadDebounceTimer)
  loadDebounceTimer = setTimeout(() => albumStore.load(), 100)
}

function retryAlbums(): void {
  albumStore.status = 'loading'
  albumStore.load()
}

// Force refresh - bypasses debounce and triggers instant file system analysis
async function handleForceRefresh(): Promise<void> {
  if (isRefreshing.value) return
  isRefreshing.value = true
  try {
    const res = await window.api.albums.forceRefresh()
    if (res && res.success === false) throw new Error(res.error || 'Refresh failed')
    await albumStore.load()
    const changed = albums.value.filter((a) => a.needsSync && !a.isOrphaned)
    const checked = `Checked ${albums.value.length} folder${albums.value.length === 1 ? '' : 's'}.`
    if (changed.length === 1) {
      const a = changed[0]
      toast(`${checked} ${a.title} has changes.`, { label: 'Review', run: () => openSyncModal(a) })
    } else if (changed.length > 1) toast(`${checked} ${changed.length} albums have changes.`)
    else toast(`${checked} No changes.`)
  } catch (error) {
    console.error('Failed to force refresh albums:', error)
    toast(`Couldn't check folders: ${error instanceof Error ? error.message : error}`)
  } finally {
    isRefreshing.value = false
  }
}

function handleAlbumCreated(a: {
  id: string
  title: string
  sourceFolderPath: string
  note?: string
}): void {
  showCreateModal.value = false
  loadAlbums()
  toast(a.note ?? `Made “${a.title}”.`, {
    label: showIn,
    run: () => window.api.shell.openFolder(a.sourceFolderPath)
  })
}

// Menu
async function toggleMenu(album: Album, e: MouseEvent): Promise<void> {
  if (menuFor.value?.id === album.id) return closeMenu()
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const up = r.bottom + 170 > innerHeight
  menuStyle.value = {
    position: 'fixed',
    left: `${r.right - 196}px`,
    ...(up ? { bottom: `${innerHeight - r.top + 6}px` } : { top: `${r.bottom + 6}px` })
  }
  menuFor.value = album
  await nextTick()
  menuEl.value?.querySelector('button')?.focus()
}

function closeMenu(): void {
  menuFor.value = null
}

function onDocPointer(e: PointerEvent): void {
  const t = e.target as HTMLElement
  if (menuFor.value && !t.closest?.('.menu, [aria-haspopup="menu"]')) closeMenu()
}
function onDocKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeMenu()
}

// Delete
function openDeleteModal(album: Album): void {
  closeMenu()
  albumToDelete.value = album
  deleteConfirmation.value = ''
  deleteError.value = ''
  showDeleteModal.value = true
}

async function handleDeleteAlbum(): Promise<void> {
  const album = albumToDelete.value
  if (!album) return

  if (deleteConfirmation.value.trim() !== album.title) {
    deleteError.value = 'Album name does not match'
    return
  }

  isDeleting.value = true
  deleteError.value = ''

  try {
    const result = await window.api.albums.delete(album.id)
    if (result.success) {
      showDeleteModal.value = false
      albumToDelete.value = null
      loadAlbums()
      toast(`Deleted “${album.title}”`)
    } else {
      deleteError.value = result.error || 'Failed to delete album'
    }
  } catch (error: unknown) {
    deleteError.value = error instanceof Error ? error.message : 'An unexpected error occurred'
  } finally {
    isDeleting.value = false
  }
}

function closeDeleteModal(): void {
  if (!isDeleting.value) showDeleteModal.value = false
}

// Sync
async function openSyncModal(album: Album): Promise<void> {
  closeMenu()
  syncAlbum.value = album
  syncChanges.value = null
  isSyncLoading.value = true
  showSyncModal.value = true

  try {
    const result = await window.api.sync.detectChanges(album.id)
    if (!result.success) throw new Error(result.error || 'Could not compare the folder')
    if (result.orphaned) {
      showSyncModal.value = false
      loadAlbums()
      toast(`The folder for “${album.title}” is not available, so nothing was synced.`)
      return
    }
    syncChanges.value = result.changes ?? null
  } catch (error) {
    console.error('Failed to detect sync changes:', error)
    showSyncModal.value = false
    toast(
      `Couldn't compare “${album.title}” with its folder: ${error instanceof Error ? error.message : error}`
    )
  } finally {
    isSyncLoading.value = false
  }
}

function handleSyncComplete(): void {
  loadAlbums()
}

function handleSyncMissing(): void {
  showSyncModal.value = false
  loadAlbums()
}

// Upload again
function openReupload(album: Album): void {
  closeMenu()
  reuploadError.value = ''
  reuploadAlbum.value = album
}

async function handleReupload(): Promise<void> {
  const album = reuploadAlbum.value
  if (!album) return
  isReuploading.value = true
  reuploadError.value = ''
  try {
    const result = await window.api.albums.reupload(album.id)
    if (!result.success) throw new Error(result.error || 'Could not upload the album again')
    reuploadAlbum.value = null
    loadAlbums() // the album has a new id now
  } catch (error) {
    reuploadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    isReuploading.value = false
  }
}

function closeReupload(): void {
  if (!isReuploading.value) reuploadAlbum.value = null
}

// Choose folder
// Each preview request wins only if it is still the latest (Cancel, then reopen, can overlap)
let relinkReq = 0
async function openRelink(album: Album, picked?: string): Promise<void> {
  closeMenu()
  const folder = picked ?? (await window.api.dialog.openDirectory())
  if (!folder) return
  const req = ++relinkReq
  relinkAlbum.value = album
  relinkPreview.value = null
  relinkError.value = ''
  relinkRepick.value = false
  isRelinking.value = true
  try {
    const res = await window.api.albums.relinkPreview(album.id, folder)
    if (req !== relinkReq) return
    if (res.success && res.preview) relinkPreview.value = res.preview
    else showRelinkError(res.error)
  } catch (error) {
    if (req === relinkReq) showRelinkError(error instanceof Error ? error.message : String(error))
  } finally {
    if (req === relinkReq) isRelinking.value = false
  }
}

// Every code gets a line; IN_USE with the other album's name shows that name instead.
// ADOPTING is this album, still being matched with its account album: another folder won't help
function showRelinkError(code: string | undefined): void {
  relinkRepick.value = code === 'IN_USE'
  if (!(code === 'IN_USE' && relinkPreview.value?.usedBy)) relinkError.value = relinkWords(code)
}

async function handleRelink(): Promise<void> {
  const album = relinkAlbum.value
  const p = relinkPreview.value
  if (!album || !p) return
  isRelinking.value = true
  relinkError.value = ''
  relinkRepick.value = false
  try {
    // Accept exactly the missing photos the person saw; more missing by now means ask again
    const res = await window.api.albums.relink(
      album.id,
      p.folder,
      relinkMostlyMissing.value ? p.missing : undefined
    )
    // The folder changed since the preview: show the fresh counts and ask again
    if (res.preview) relinkPreview.value = res.preview
    if (!res.success) return showRelinkError(res.error)
    relinkAlbum.value = null
    loadAlbums()
    toast(`“${album.title}” uses this folder now.`)
  } catch (error) {
    showRelinkError(error instanceof Error ? error.message : String(error))
  } finally {
    isRelinking.value = false
  }
}

// Cancel works while the preview loads; only the relink itself can't be left mid-way
function closeRelink(): void {
  if (isRelinking.value && relinkPreview.value) return
  relinkReq++ // a preview still loading is dropped
  relinkAlbum.value = null
}

// Between the fields of an album's line: the dot stays at the end of a line, never starts one
const sep = '\u00a0· '
const photoCount = (n: number): string => `${nf(n)} photo${n === 1 ? '' : 's'}`

// Upload pill
function dismissUpload(): void {
  uploadDone.value = false
  uploadProgress.value = null
  currentUploadingAlbumId.value = null
}

function shareUploaded(): void {
  const a = uploadAlbum.value
  dismissUpload()
  if (a) shareAlbum.value = a
}

function showFailedFiles(): void {
  const id = uploadProgress.value?.albumId || currentUploadingAlbumId.value
  if (uploadDone.value) dismissUpload()
  if (id) router.push(`/albums/${id}`)
}

// Event handlers
const onBatchStart = (): void => {
  isProcessing.value = true
}

const onProgress = (_e: IpcRendererEvent, data: UploadProgress): void => {
  isProcessing.value = true
  uploadDone.value = false
  uploadProgress.value = data
  if (data.albumId) currentUploadingAlbumId.value = data.albumId
}

const onComplete = (_e: IpcRendererEvent, data?: { albumId?: string }): void => {
  isProcessing.value = false
  if (data?.albumId) currentUploadingAlbumId.value = data.albumId
  // Keep the pill as "Ready to share" only if we saw this upload run
  uploadDone.value = !!uploadProgress.value
  if (!uploadDone.value) currentUploadingAlbumId.value = null
  loadAlbums()
}

const onError = (_e: IpcRendererEvent, data?: { error?: string }): void => {
  isProcessing.value = false
  toast(`Upload stopped${data?.error ? `: ${data.error}` : ''}`)
}

const onAlbumStatusChanged = (
  _e: IpcRendererEvent,
  data: { albumId: string; needsSync: number; serverMissing?: number }
): void => {
  const album = albumStore.albums.find((a) => a.id === data.albumId)
  if (!album) return
  album.needsSync = data.needsSync
  if (data.serverMissing) album.server_missing = 1
}

const onAlbumsRefresh = (): void => {
  loadAlbums()
}

// Unsubscribes for the IPC listeners below
let offIpc: Array<() => void> = []

onMounted(() => {
  // On a first visit AppLayout is loading the list already
  if (albumStore.status === 'ready') loadAlbums()
  profileStore.fetchProfile()
  if (networkStore.isOnline) albumStore.loadCloud()

  offIpc = [
    window.api.on('upload:batch-start', onBatchStart),
    window.api.on('upload:progress', onProgress),
    window.api.on('upload:complete', onComplete),
    window.api.on('upload:error', onError),
    window.api.on('album:status-changed', onAlbumStatusChanged),
    window.api.on('albums:refresh', onAlbumsRefresh)
  ]
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onDocKey)
  document.addEventListener('scroll', closeMenu, true)
})

// The skeleton shows while it asks again
function retryCloud(): void {
  albumStore.cloud = null
  albumStore.loadCloud()
}

// Offline, the account list is not asked for; back online, it is, with the skeleton on an
// empty library so "No albums yet" doesn't show before the list
watch(
  () => networkStore.isOnline,
  (on) => on && retryCloud()
)

onUnmounted(() => {
  if (loadDebounceTimer) clearTimeout(loadDebounceTimer)
  clearTimeout(attachSayTimer)
  offIpc.forEach((off) => off())
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onDocKey)
  document.removeEventListener('scroll', closeMenu, true)
})
</script>

<template>
  <AppLayout>
    <div class="page">
      <header class="head">
        <div>
          <div class="label">Library</div>
          <h1>Albums</h1>
        </div>
        <span class="meta num">{{
          albumStore.status === 'ready' ? `${nf(totalPhotos)} photos` : ''
        }}</span>
        <div class="actions">
          <UploadPill
            v-if="uploadProgress"
            :progress="uploadProgress"
            :album="uploadAlbum"
            :done="uploadDone"
            :failed="failedCount"
            :offline="!networkStore.isOnline"
            @dismiss="dismissUpload"
            @share="shareUploaded"
            @show-failed="showFailedFiles"
          />
          <button
            class="icon-btn"
            title="Check folders for changes"
            aria-label="Check folders for changes"
            :disabled="isRefreshing"
            @click="handleForceRefresh"
          >
            <span v-if="isRefreshing" class="spin"></span>
            <RefreshCw v-else />
          </button>
          <button
            class="btn primary"
            :disabled="!networkStore.isOnline"
            :title="!networkStore.isOnline ? 'New albums need a connection' : ''"
            @click="showCreateModal = true"
          >
            <Plus />{{ networkStore.isOnline ? 'New album' : 'Offline' }}
          </button>
        </div>
      </header>

      <div
        v-if="
          albumStore.status === 'loading' ||
          (albumStore.status === 'ready' &&
            !albums.length &&
            networkStore.isOnline &&
            albumStore.cloud === null)
        "
        class="grid-albums"
        aria-busy="true"
      >
        <div v-for="i in 8" :key="i" class="album">
          <div class="cover skel"></div>
          <div style="padding: 16px 8px 8px">
            <div class="skel" style="height: 14px; width: 60%; border-radius: 6px"></div>
            <div
              class="skel"
              style="height: 12px; width: 35%; border-radius: 6px; margin-top: 8px"
            ></div>
          </div>
        </div>
      </div>

      <div v-else-if="albumStore.status === 'error'" class="card empty">
        <h2>Couldn't read your albums</h2>
        <p>
          LumoSnap couldn't open its library on this computer. Your photos and folders are safe.
        </p>
        <button class="btn primary" @click="retryAlbums"><RotateCw />Try again</button>
      </div>

      <CloudAlbums
        v-else-if="albums.length === 0 && networkStore.isOnline && albumStore.cloudShown.length"
        alone
      />

      <div v-else-if="albums.length === 0" class="card empty">
        <div class="art" aria-hidden="true"><span v-for="i in 9" :key="i"></span></div>
        <h2>No albums yet</h2>
        <p v-if="!networkStore.isOnline">
          You’re offline. Albums already on your account show here when you’re back online.
        </p>
        <p v-else-if="albumStore.cloudFailed">
          LumoSnap couldn’t reach your account, so albums already on it don’t show yet.
          <button class="link" @click="retryCloud">Try again</button>
        </p>
        <p v-else>
          An album is a folder of photos you share with one client. Make one from a folder you
          already have.
        </p>
        <button
          class="btn primary"
          :disabled="!networkStore.isOnline"
          @click="showCreateModal = true"
        >
          <Plus />{{ networkStore.isOnline ? 'Create your first album' : 'Offline' }}
        </button>
      </div>

      <div v-else class="grid-albums">
        <div
          v-for="album in albums"
          :key="album.id"
          class="album"
          :data-id="album.id"
          :aria-disabled="isUploading(album) ? 'true' : undefined"
          tabindex="0"
          role="link"
          :aria-label="album.title"
          @click="openAlbum(album)"
          @keydown.enter.self.prevent="openAlbum(album)"
          @keydown.space.self.prevent="openAlbum(album)"
        >
          <div class="cover" :class="{ muted: album.isOrphaned || album.server_missing }">
            <img v-if="album.thumbnail" :src="fileUrl(album.thumbnail)" alt="" loading="lazy" />
            <div v-else class="empty-cover"><ImagePlus /></div>
            <div v-if="album.isOrphaned" class="flag">
              <span class="tag"
                ><span class="dot bad"></span
                >{{ album.unplugged ? 'Drive unplugged' : 'Folder missing' }}</span
              >
            </div>
            <div v-else-if="album.server_missing" class="flag">
              <span class="tag"><span class="dot bad"></span>Not on LumoSnap</span>
            </div>
            <div v-else-if="album.needsSync" class="flag">
              <span class="tag"><span class="dot warn"></span>Folder changed</span>
            </div>
            <div v-if="isUploading(album) && uploadProgress" class="uploading">
              <div class="row">
                <span>{{ networkStore.isOnline ? 'Uploading' : 'Paused' }}</span>
                <span class="num"
                  >{{ nf(uploadProgress.complete) }} / {{ nf(uploadProgress.total) }}</span
                >
              </div>
              <div class="bar lg" aria-hidden="true">
                <span
                  :style="{
                    '--p': uploadProgress.total ? uploadProgress.complete / uploadProgress.total : 0
                  }"
                ></span>
                <span
                  class="pending"
                  :style="{
                    '--p': uploadProgress.total
                      ? (uploadProgress.complete + uploadProgress.uploading) / uploadProgress.total
                      : 0
                  }"
                ></span>
              </div>
            </div>
          </div>
          <div class="info">
            <div>
              <div class="t">{{ album.title }}</div>
              <div class="m num">
                <span>{{ album.totalImages ? `${nf(album.totalImages)} photos` : 'Empty' }}</span>
                <template v-if="albumDate(album)"
                  >{{ sep }}<span>{{ albumDate(album) }}</span></template
                >
                <template v-if="album.cloudSize && !album.server_missing"
                  >{{ sep
                  }}<span :title="`${fileSize(album.cloudSize)} of photos online`">{{
                    fileSize(album.cloudSize)
                  }}</span></template
                >
              </div>
              <div v-if="album.isOrphaned" class="hint">
                {{
                  album.unplugged
                    ? `Plug in ${driveName(album)} to sync. Nothing online was changed.`
                    : album.volumeName
                      ? 'The folder was moved or renamed. Choose it again; nothing online was changed.'
                      : 'Plug in the drive or choose the folder again. Nothing online was changed.'
                }}
              </div>
              <div v-else-if="album.server_missing" class="hint">
                The client link stopped working. Your photos here are safe.
              </div>
              <div v-else-if="!album.totalImages && !isUploading(album)" class="hint">
                Drop photos into its folder to fill it
              </div>
            </div>
            <button
              class="icon-btn sm plain"
              :aria-label="`More for ${album.title}`"
              aria-haspopup="menu"
              :aria-expanded="menuFor?.id === album.id"
              :disabled="isUploading(album)"
              @click.stop="toggleMenu(album, $event)"
            >
              <MoreHorizontal />
            </button>
          </div>
        </div>
      </div>

      <CloudAlbums v-if="albumStore.status === 'ready' && albums.length && networkStore.isOnline" />
    </div>

    <Teleport to="body">
      <div v-if="menuFor" ref="menuEl" class="menu" role="menu" :style="menuStyle">
        <button
          v-if="!menuFor.isOrphaned && menuFor.sourceFolderPath"
          role="menuitem"
          @click="openFolderInExplorer(menuFor)"
        >
          <FolderOpen />{{ showIn }}
        </button>
        <button v-if="menuFor.isOrphaned" role="menuitem" @click="openRelink(menuFor)">
          <FolderInput />Choose folder…
        </button>
        <button v-if="menuFor.needsSync" role="menuitem" @click="openSyncModal(menuFor)">
          <RefreshCw />Review folder changes
        </button>
        <button
          v-if="menuFor.server_missing && !menuFor.isOrphaned"
          role="menuitem"
          @click="openReupload(menuFor)"
        >
          <Upload />Upload again…
        </button>
        <hr v-if="menuFor.sourceFolderPath || menuFor.needsSync || menuFor.server_missing" />
        <button role="menuitem" class="bad" @click="openDeleteModal(menuFor)">
          <Trash2 />Delete album…
        </button>
      </div>
    </Teleport>

    <CreateAlbumModal
      :show="showCreateModal"
      @close="showCreateModal = false"
      @created="handleAlbumCreated"
    />

    <SyncModal
      :show="showSyncModal"
      :album-id="syncAlbum?.id || ''"
      :album-title="syncAlbum?.title || ''"
      :folder="syncAlbum?.sourceFolderPath"
      :changes="syncChanges"
      :is-loading="isSyncLoading"
      @close="showSyncModal = false"
      @sync="handleSyncComplete"
      @missing="handleSyncMissing"
    />

    <ShareLinkModal
      :show="!!shareAlbum"
      :album-id="shareAlbum?.id || ''"
      :album-title="shareAlbum?.title || ''"
      @close="shareAlbum = null"
    />

    <Modal
      :show="!!reuploadAlbum"
      :title="`Upload “${reuploadAlbum?.title || ''}” again?`"
      @close="closeReupload"
    >
      <p>
        LumoSnap no longer has this album. This makes a new one and uploads its
        {{ nf(reuploadAlbum?.totalImages || 0) }} photos again, with their sets, people and tags.
        Your client gets a new link; picks made on the old link can’t be brought back. Nothing in
        your folder changes.
      </p>
      <p v-if="reuploadError" class="err"><span class="dot bad"></span>{{ reuploadError }}</p>
      <template #footer>
        <button class="btn ghost" :disabled="isReuploading" @click="closeReupload">Cancel</button>
        <button
          class="btn primary"
          :disabled="isReuploading || !networkStore.isOnline"
          @click="handleReupload"
        >
          <span v-if="isReuploading" class="spin"></span
          >{{ !networkStore.isOnline ? 'Offline' : isReuploading ? 'Starting…' : 'Upload again' }}
        </button>
      </template>
    </Modal>

    <Modal
      :show="!!attachAlbum"
      :title="
        attachAlbum?.unplugged
          ? `Plug in ${driveName(attachAlbum)}`
          : `Find the folder for “${attachAlbum?.title || ''}”`
      "
      :sub="attachAlbum?.unplugged ? attachAlbum.title : undefined"
      @close="attachId = null"
    >
      <template v-if="attachAlbum?.unplugged">
        <div class="wait" aria-hidden="true">
          <span class="spin now"></span>Waiting for the drive…
        </div>
        <p class="vh" role="status">{{ attachSaid }}</p>
        <p>
          The album opens when LumoSnap finds its folder on the drive, even under a new name or
          drive letter.
        </p>
        <p>Photos on a different drive now? Choose the folder they’re in.</p>
      </template>
      <p v-else-if="attachAlbum?.volumeName">
        The folder was moved or renamed. Choose it again; nothing online was changed.
      </p>
      <p v-else>Plug in the drive or choose the folder again. Nothing online was changed.</p>
      <template #footer>
        <button class="btn ghost" @click="attachOpenAnyway">Open album</button>
        <button class="btn primary" autofocus @click="attachChoose">
          <FolderInput />Choose folder…
        </button>
      </template>
    </Modal>

    <Modal
      :show="!!relinkAlbum"
      :title="`Use this folder for “${relinkAlbum?.title || ''}”?`"
      @close="closeRelink"
    >
      <div v-if="!relinkPreview && isRelinking" class="wait">
        <span class="spin"></span>Comparing the folder with the album…
      </div>
      <template v-else-if="relinkPreview">
        <p class="mono" style="overflow-wrap: anywhere">{{ relinkPreview.folder }}</p>
        <p v-if="relinkPreview.usedBy">
          That folder is already used by “{{ relinkPreview.usedBy }}”. Choose a different one.
        </p>
        <template v-else>
          <p>
            {{ photoCount(relinkPreview.matched + relinkPreview.renamed) }} found<template
              v-if="relinkPreview.missing"
              >, {{ nf(relinkPreview.missing) }} missing</template
            ><template v-if="relinkPreview.extra">, {{ nf(relinkPreview.extra) }} new</template>.
          </p>
          <p v-if="relinkMostlyMissing">
            Most of this album’s photos aren’t in this folder. Check that it’s the right one.
          </p>
          <p v-if="relinkPreview.missing">Missing photos stay online until you remove them.</p>
        </template>
      </template>
      <p v-if="relinkError" class="err"><span class="dot bad"></span>{{ relinkError }}</p>
      <template #footer>
        <button class="btn ghost" :disabled="isRelinking && !!relinkPreview" @click="closeRelink">
          Cancel
        </button>
        <button
          v-if="relinkAlbum && (relinkPreview?.usedBy || relinkRepick)"
          class="btn primary"
          @click="openRelink(relinkAlbum)"
        >
          Choose another folder…
        </button>
        <button
          v-else-if="relinkPreview"
          class="btn primary"
          :disabled="isRelinking"
          @click="handleRelink"
        >
          <span v-if="isRelinking" class="spin"></span
          >{{ relinkMostlyMissing ? 'Use folder anyway' : 'Use folder' }}
        </button>
      </template>
    </Modal>

    <Modal
      :show="showDeleteModal"
      :title="`Delete “${albumToDelete?.title || ''}”?`"
      @close="closeDeleteModal"
    >
      <p>
        This removes {{ nf(albumToDelete?.totalImages || 0) }} photos from LumoSnap and from this
        computer's cache. Your client's link stops working. Your original folder stays untouched.
        This can't be undone.
      </p>
      <form class="field" @submit.prevent="handleDeleteAlbum">
        <label for="del-in"
          >Type <b>{{ albumToDelete?.title }}</b> to confirm</label
        >
        <input
          id="del-in"
          v-model="deleteConfirmation"
          class="input"
          autocomplete="off"
          :disabled="isDeleting"
          autofocus
        />
      </form>
      <p v-if="deleteError" class="err"><span class="dot bad"></span>{{ deleteError }}</p>
      <template #footer>
        <button class="btn ghost" :disabled="isDeleting" @click="closeDeleteModal">Cancel</button>
        <button
          class="btn danger"
          :disabled="isDeleting || deleteConfirmation.trim() !== albumToDelete?.title"
          @click="handleDeleteAlbum"
        >
          <span v-if="isDeleting" class="spin"></span
          >{{ isDeleting ? 'Deleting…' : 'Delete album' }}
        </button>
      </template>
    </Modal>
  </AppLayout>
</template>
