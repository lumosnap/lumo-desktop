<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Modal from '../components/ui/Modal.vue'
import CreateAlbumModal from '../components/CreateAlbumModal.vue'
import SyncModal from '../components/SyncModal.vue'
import ShareLinkModal from '../components/ShareLinkModal.vue'
import UploadPill from '../components/UploadPill.vue'
import {
  RefreshCw,
  Plus,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  ImagePlus,
  RotateCw,
  Upload
} from 'lucide-vue-next'
import type { Album } from '../stores/album'
import type { IpcRendererEvent } from 'electron'
import type { SyncChanges } from '../../../main/ipc/sync'
import type { UploadProgress } from '../../../main/pipeline'
import { useAlbumStore } from '../stores/album'
import { useProfileStore } from '../stores/profile'
import { useNetworkStore } from '../stores/network'
import { toast } from '../composables/useToast'

const albumStore = useAlbumStore()
const profileStore = useProfileStore()
const networkStore = useNetworkStore()
const router = useRouter()

const albums = computed(() => albumStore.albums)
const totalPhotos = computed(() => albums.value.reduce((n, a) => n + (a.totalImages || 0), 0))
const nf = (n: number): string => n.toLocaleString('en-IN')

function albumDate(a: Album): string {
  const d = new Date(a.eventDate || a.createdAt)
  if (isNaN(d.getTime())) return ''
  if (d.toDateString() === new Date().toDateString()) return 'Today'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

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

const isRefreshing = ref(false)

function isUploading(album: Album): boolean {
  return currentUploadingAlbumId.value === album.id && !uploadDone.value
}

function openAlbum(album: Album): void {
  // Don't allow opening albums while they are processing
  if (isUploading(album)) return
  router.push(`/albums/${album.id}`)
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

function handleAlbumCreated(a: { id: string; title: string; sourceFolderPath: string }): void {
  showCreateModal.value = false
  loadAlbums()
  toast(`Made “${a.title}”.`, {
    label: 'Show in Finder',
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

onMounted(() => {
  loadAlbums()
  profileStore.fetchProfile()

  if (window.api && window.api.on) {
    window.api.on('upload:batch-start', onBatchStart)
    window.api.on('upload:progress', onProgress)
    window.api.on('upload:complete', onComplete)
    window.api.on('upload:error', onError)
    window.api.on('album:status-changed', onAlbumStatusChanged)
    window.api.on('albums:refresh', onAlbumsRefresh)
  }
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onDocKey)
  document.addEventListener('scroll', closeMenu, true)
})

onUnmounted(() => {
  if (loadDebounceTimer) clearTimeout(loadDebounceTimer)
  if (window.api && window.api.off) {
    window.api.off('upload:batch-start', onBatchStart)
    window.api.off('upload:progress', onProgress)
    window.api.off('upload:complete', onComplete)
    window.api.off('upload:error', onError)
    window.api.off('album:status-changed', onAlbumStatusChanged)
    window.api.off('albums:refresh', onAlbumsRefresh)
  }
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

      <div v-if="albumStore.status === 'loading'" class="grid-albums" aria-busy="true">
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

      <div v-else-if="albums.length === 0" class="card empty">
        <div class="art" aria-hidden="true"><span v-for="i in 9" :key="i"></span></div>
        <h2>No albums yet</h2>
        <p>
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
            <img v-if="album.thumbnail" :src="`file://${album.thumbnail}`" alt="" loading="lazy" />
            <div v-else class="empty-cover"><ImagePlus /></div>
            <div v-if="album.isOrphaned" class="flag">
              <span class="tag"><span class="dot bad"></span>Folder missing</span>
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
                {{ album.totalImages ? `${nf(album.totalImages)} photos` : 'Empty'
                }}{{ albumDate(album) ? ` · ${albumDate(album)}` : '' }}
              </div>
              <div v-if="album.isOrphaned" class="hint">
                Client link still works. The folder was moved or deleted on this computer.
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
    </div>

    <Teleport to="body">
      <div v-if="menuFor" ref="menuEl" class="menu" role="menu" :style="menuStyle">
        <button
          v-if="!menuFor.isOrphaned && menuFor.sourceFolderPath"
          role="menuitem"
          @click="openFolderInExplorer(menuFor)"
        >
          <FolderOpen />Show in Finder
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
        <hr
          v-if="
            (!menuFor.isOrphaned && menuFor.sourceFolderPath) ||
            menuFor.needsSync ||
            menuFor.server_missing
          "
        />
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
