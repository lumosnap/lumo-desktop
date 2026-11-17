interface AlbumImage {
  id: number
  albumId: string
  originalFilename: string
  localFilePath: string
  fileSize: number
  width?: number
  height?: number
  uploadStatus: string
  serverId?: number
  isFavorite?: boolean
  favoriteData?: unknown
}

export interface Album {
  id: string
  userId: number
  title: string
  eventDate: string | null
  startTime: string | null
  endTime: string | null
  totalImages: number
  totalSize: number
  shareLinkToken: string | null
  expiresAt: string | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
  needsSync?: number // 0 or 1 (SQLite boolean) - indicates if album needs sync with source folder
  isOrphaned?: number // 0 or 1 (SQLite boolean) - indicates if source folder was deleted
  server_missing?: number // 1 = the server answered "Album not found" (e.g. its database was reset)
  unplugged?: boolean // folder missing because its whole drive is gone (album:list's guess)
  volumeName?: string // that drive: the /Volumes name on macOS, "D:" on Windows
  volumeLabel?: string | null // the drive's label ("NO NAME"), kept from when it was last seen
  cloudSize?: number | null // bytes of its copies in the cloud (the server's count); null = not known yet
  albumType?: 'watch_folder' | 'standalone' // watch_folder = in master folder, standalone = custom path
  // For backward compatibility with frontend
  photoCount?: number
  coverPhoto?: string
  photos?: AlbumImage[]
  thumbnail?: string
  localFolderPath?: string
  sourceFolderPath?: string
}

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AttachCloudResult, CloudAlbum } from '../../../main/ipc/cloud'
import type { RowCode } from '../utils/cloud'

// Shared so the sidebar (counts, print stack) and the Albums view read one list.
export const useAlbumStore = defineStore('album', () => {
  const albums = ref<Album[]>([])
  // The online size of each local album from the last account list. Patched into the list in
  // place: listing again would pick new random covers and check every folder again
  let sizes: Record<string, number | null> = {}
  function applySizes(): void {
    for (const a of albums.value) if (a.id in sizes) a.cloudSize = sizes[a.id]
  }
  const status = ref<'loading' | 'ready' | 'error'>('loading')

  async function load(): Promise<void> {
    try {
      const result = await window.api.albums.list()
      if (!result.success) throw new Error(result.error || 'album:list failed')
      albums.value = result.albums || []
      // An album:list asked before the sizes were written can answer after them
      applySizes()
      status.value = 'ready'
    } catch (e) {
      console.error('Failed to load albums:', e)
      status.value = 'error'
    }
  }

  // Account albums not on this computer. null: not asked yet (or asking); [] also when the
  // server can't be reached: this list is a convenience, never an error on the page
  const cloud = ref<CloudAlbum[] | null>(null)
  // The last ask failed (not signed out: that goes to sign-in): an empty library says so
  const cloudFailed = ref(false)
  let cloudReq = 0
  /** keep: a failed ask leaves the list as it was (a drive event, not the page asking).
   * true when this ask's answer is the list now */
  async function loadCloud(opts?: { keep?: boolean }): Promise<boolean> {
    const req = ++cloudReq
    const res = await window.api.albums
      .listCloud()
      .catch((e) => (console.error(e), { success: false as const, error: 'FAILED' as const }))
    if (req !== cloudReq) return false
    if (!res.success && res.error !== 'OFFLINE')
      console.error('Failed to list account albums:', res.error)
    if (opts?.keep && !res.success && res.error !== 'AUTH') return false
    cloud.value = res.success ? ordered(res.albums) : []
    if (res.success) {
      sizes = res.sizes ?? {}
      applySizes()
    }
    cloudFailed.value = !res.success && res.error !== 'AUTH'
    // The drive is back: its old "isn't there any more" line would hide where it is now
    if (res.success)
      for (const c of res.albums)
        if (c.found && attachErrors.value[c.id] === 'NO_FOLDER') delete attachErrors.value[c.id]
    return res.success
  }
  // Albums whose folder is on a plugged-in drive come first: the drive in hand is why the
  // person is here. The rest keep the server's order (newest first). While a match runs the
  // rows stay where they are (new ones at the end), so nothing moves under the pointer
  function ordered(list: CloudAlbum[]): CloudAlbum[] {
    const was = attaching.value ? (cloud.value ?? []).map((c) => c.id) : null
    const pos = (c: CloudAlbum): number =>
      was ? was.indexOf(c.id) + 1 || was.length + 1 : Number(!c.found)
    return [...list].sort((a, b) => pos(a) - pos(b))
  }
  // The one being matched with its folder, with its progress (album:attach-progress), and the
  // last error per album. Kept here, not in the view, so leaving the page neither hides them
  // (the album is in neither list while it matches) nor lets a second attach start
  const attaching = ref<{
    album: CloudAlbum
    folder: string
    done?: number
    total?: number
  } | null>(null)
  const attachErrors = ref<Record<string, RowCode>>({})
  let attachSeq = 0
  /** null: the account changed while it matched, so the answer is not this person's */
  async function attach(album: CloudAlbum, folder: string): Promise<AttachCloudResult | null> {
    const seq = ++attachSeq
    attaching.value = { album, folder }
    delete attachErrors.value[album.id]
    const off = window.api.on(
      'album:attach-progress',
      (_e, p: { albumId: string; done: number; total: number }) => {
        if (seq === attachSeq && attaching.value?.album.id === p.albumId)
          attaching.value = { ...attaching.value, done: p.done, total: p.total }
      }
    )
    try {
      const res = await window.api.albums
        .attachCloud(album.id, folder)
        .catch((e) => (console.error(e), { success: false as const, error: 'FAILED' as const }))
      if (seq !== attachSeq) return null
      if (res.success || res.error === 'NOT_FOUND') dropCloud(album.id)
      if (res.success || res.error === 'LOCAL') await load()
      // The row stays: an attach cut short is offered here again
      else if (res.error !== 'NOT_FOUND') attachErrors.value[album.id] = res.error
      return res
    } finally {
      off()
      if (seq === attachSeq) attaching.value = null
    }
  }
  // An album that came here another way (New album from its folder) leaves this list at once
  const cloudShown = computed(() => {
    const list = (cloud.value ?? []).filter((c) => !albums.value.some((a) => a.id === c.id))
    const a = attaching.value?.album
    const hidden = a && !list.some((c) => c.id === a.id) && !albums.value.some((x) => x.id === a.id)
    return hidden ? [a, ...list] : list
  })
  function dropCloud(id: string): void {
    cloud.value = cloud.value?.filter((c) => c.id !== id) ?? null
  }
  /** Signed out or expired: the next account must not see this one's albums or answers */
  function resetCloud(): void {
    cloudReq++
    attachSeq++
    cloud.value = null
    cloudFailed.value = false
    sizes = {}
    attaching.value = null
    attachErrors.value = {}
  }

  return {
    albums,
    status,
    load,
    cloud,
    cloudFailed,
    cloudShown,
    attaching,
    attachErrors,
    attach,
    loadCloud,
    dropCloud,
    resetCloud
  }
})
