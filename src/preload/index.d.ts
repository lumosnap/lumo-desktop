import { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcRendererEvent } from 'electron'
import type {
  ApiProfile,
  ApiBillingAddress,
  ApiPlan,
  ApiFavoriteImage,
  Booking
} from '../main/api-client'
import type { Album, AlbumSet, Image } from '../main/database'
import type { AppConfig } from '../main/config'
import type { SyncResult, ExecuteSyncResult, SyncChanges } from '../main/ipc/sync'
import type { FileStats } from '../main/storage'
import type { UploadProgress } from '../main/pipeline'
import type { TagConfig } from '../main/ipc/albums'
import type { PeopleConfig, PersonSummary, PickPhoto, ReviewFace } from '../main/people'
import type { LocalList, SelectionList } from '../main/lists'

type ListsResult = { success: true; lists: LocalList[] } | { success: false; error: string }
type NotesResult =
  | { success: true; notes: Record<number, string>; albumNote: string }
  | { success: false; error: string }

type SetsResult = { success: true; sets: AlbumSet[] } | { success: false; error: string }

type AuthUser = { id: string; email: string; name: string; image?: string }

type AlbumImageWithFavorites = Image & {
  isFavorite: boolean
  favoriteCount: number
  notesCount: number
  comments: Array<{ clientName: string; notes: string | null; createdAt: string }>
  // Browse grouping (null on albums not yet analysed)
  capturedAt: number | null // EXIF wall-clock encoded as UTC: format with timeZone 'UTC'
  cameraId: string | null
  rating: number | null
  phash: string | null
  sharpness: number | null
  thumbhash: string | null // base64
  burstId: string | null
  isBurstCover: boolean
  momentId: string | null
  tags: string[] // effective tags: manual adds first, then AI tags (by score) not removed
  people: string[] // ids of the people in this photo (reference or auto faces)
}

type PeopleResult = { success: boolean; error?: string }

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      auth: {
        getStoredAuth: () => Promise<{
          success: boolean
          token: string | null
          user: { id: string; email: string; name: string; image?: string } | null
        }>
        startAuth: () => Promise<{
          success: boolean
          user?: { id: string; email: string; name: string; image?: string }
          error?: string
        }>
        requestDeviceCode: () => Promise<{
          success: boolean
          device_code?: string
          user_code?: string
          verification_uri?: string
          verification_uri_complete?: string
          expires_in?: number
          interval?: number
          error?: string
        }>
        pollDeviceToken: (deviceCode: string) => Promise<{
          success: boolean
          pending?: boolean
          error?: string
          error_description?: string
          interval?: number
          user?: { id: string; email: string; name: string; image?: string }
        }>
        logout: () => Promise<{ success: boolean }>
      }
      config: {
        isConfigured: () => Promise<boolean>
        getStorageLocation: () => Promise<string | null>
        setStorageLocation: (path: string) => Promise<{ success: boolean; error?: string }>
        getFreeSpace: (
          path: string
        ) => Promise<{ bytes: number; formatted: string; error?: string }>
        getConfig: () => Promise<AppConfig>
        getAppVersion: () => Promise<string>
        getCurrentStorageInfo: () => Promise<{
          success: boolean
          path: string | null
          freeSpace: number
          freeSpaceFormatted: string
          isLowStorage: boolean
          error?: string
        }>
        resetAllData: () => Promise<{ success: boolean; error?: string }>
      }
      albums: {
        create: (data: {
          title: string
          eventDate: string | null
          sourceFolderPath: string
          albumType?: 'watch_folder' | 'standalone'
          eventType?: string // an EventType id; default 'wedding'
        }) => Promise<{ success: true; album: Album } | { success: false; error: string }>
        list: () => Promise<any>
        get: (
          albumId: string
        ) => Promise<{ success: true; album: Album } | { success: false; error: string }>
        delete: (albumId: string) => Promise<{ success: boolean; error?: string }>
        getImages: (
          albumId: string
        ) => Promise<{ success: boolean; images: AlbumImageWithFavorites[]; error?: string }>
        onAnalyzed: (callback: (albumId: string) => void) => () => void
        deleteImage: (
          albumId: string,
          imageId: number
        ) => Promise<{ success: boolean; error?: string }>
        deleteImages: (
          albumId: string,
          imageIds: number[]
        ) => Promise<{ success: boolean; deletedCount?: number; error?: string }>
        copyImages: (
          albumId: string,
          imageIds: number[]
        ) => Promise<{
          success: boolean
          count?: number
          errorCount?: number
          destinationDir?: string
          error?: string
        }>
        scanSourceFolder: (
          path: string
        ) => Promise<{ success: boolean; count: number; images: FileStats[]; error?: string }>
        startUpload: (albumId: string) => Promise<{ success: boolean; error?: string }>
        getProgress: (
          albumId: string
        ) => Promise<{ success: boolean; progress?: UploadProgress; error?: string }>
        retryFailed: (albumId: string) => Promise<{ success: boolean; error?: string }>
        forceRefresh: () => Promise<{ success: boolean; error?: string }>
      }
      sets: {
        list: (albumId: string) => Promise<SetsResult>
        create: (albumId: string, name: string, imageIds?: number[]) => Promise<SetsResult>
        rename: (setId: string, name: string) => Promise<SetsResult>
        delete: (setId: string) => Promise<SetsResult>
        reorder: (albumId: string, orderedIds: string[]) => Promise<SetsResult>
        addImages: (setId: string, imageIds: number[]) => Promise<SetsResult>
        removeImages: (setId: string, imageIds: number[]) => Promise<SetsResult>
        setCover: (setId: string, imageId: number | null) => Promise<SetsResult>
        fromMoment: (albumId: string, momentId: string, name: string) => Promise<SetsResult>
        onSetsChanged: (callback: (albumId: string) => void) => () => void
      }
      tags: {
        getAlbumConfig: (albumId: string) => Promise<TagConfig>
        // Re-scores the album's AI tags from stored embeddings; null = the event type's pack
        setAlbumConfig: (albumId: string, enabled: string[] | null) => Promise<TagConfig>
        // Clears the tag set back to the new event type's pack and re-scores
        setEventType: (albumId: string, eventType: string) => Promise<TagConfig>
        // Manual per-photo overrides (any slug matching /^[a-z0-9-]{1,40}$/); survive re-scoring
        add: (
          albumId: string,
          imageIds: number[],
          tag: string
        ) => Promise<{ success: boolean; error?: string }>
        remove: (
          albumId: string,
          imageIds: number[],
          tag: string
        ) => Promise<{ success: boolean; error?: string }>
      }
      // People (opt-in per album). A person = faces the photographer confirmed (references);
      // other faces match them: auto (sure), review ("Is this X?") or no one. Mutations re-match,
      // emit album:peopleChanged (also sent per scan batch) and push to the server.
      people: {
        getConfig: (albumId: string) => Promise<PeopleConfig>
        // Off deletes every face, person and client link of the album, locally and on the server
        setEnabled: (albumId: string, enabled: boolean) => Promise<PeopleConfig>
        // Every person (all named), by name
        list: (albumId: string) => Promise<PersonSummary[]>
        // Scanned photos good for picking people: many large, clear faces first
        pickPhotos: (albumId: string, limit?: number) => Promise<PickPhoto[]>
        // "Is this X?" candidates, best first
        reviewQueue: (albumId: string, personId: string, limit?: number) => Promise<ReviewFace[]>
        // yes = becomes a reference of the person, no = never this person; remaining = queue left
        review: (
          albumId: string,
          personId: string,
          decisions: Array<{ faceId: number; yes: boolean }>
        ) => Promise<PeopleResult & { remaining: number }>
        // Empty name fails: every person has a name
        rename: (albumId: string, personId: string, name: string | null) => Promise<PeopleResult>
        // References, auto faces, rejections and client links move to intoId
        merge: (albumId: string, intoId: string, fromIds: string[]) => Promise<PeopleResult>
        // Deletes the person; its references become plain faces
        remove: (albumId: string, personId: string) => Promise<PeopleResult>
        setHidden: (albumId: string, personId: string, hidden: boolean) => Promise<PeopleResult>
        // faceId must be one of the person's faces
        setCover: (albumId: string, personId: string, faceId: number) => Promise<PeopleResult>
        facesInImage: (
          albumId: string,
          imageId: number
        ) => Promise<
          Array<{
            faceId: number
            box: [number, number, number, number] // normalized x, y, w, h
            personId: string | null
            name: string | null
            source: 'ref' | 'auto' | null // ref = confirmed by the photographer
          }>
        >
        // personId/newName: this face is a reference of that person (newName reuses a person of
        // the same name, case-insensitive). none: not its current person (remembered).
        // Resolves with the person the face is now a reference of
        assignFace: (
          albumId: string,
          faceId: number,
          target: { personId: string } | { newName: string } | { none: true }
        ) => Promise<PeopleResult & { personId?: string | null }>
        // Saved on the server first; fails (and changes nothing) when offline
        linkClient: (
          albumId: string,
          clientName: string,
          personId: string | null
        ) => Promise<PeopleResult>
        clientLinks: (albumId: string) => Promise<Record<string, string>>
        onPeopleChanged: (callback: (albumId: string) => void) => () => void
      }
      lists: {
        get: (albumId: string) => Promise<ListsResult>
        save: (albumId: string, lists: SelectionList[]) => Promise<ListsResult>
        reopen: (albumId: string, listId: string, clientName: string) => Promise<ListsResult>
      }
      notes: {
        get: (albumId: string) => Promise<NotesResult>
        set: (
          albumId: string,
          imageId: number,
          body: string
        ) => Promise<{ success: boolean; error?: string }>
        setAlbum: (albumId: string, body: string) => Promise<{ success: boolean; error?: string }>
      }
      sync: {
        detectChanges: (albumId: string) => Promise<SyncResult>
        execute: (albumId: string, changes: Partial<SyncChanges>) => Promise<ExecuteSyncResult>
      }
      dialog: {
        openDirectory: () => Promise<string | null>
      }
      api: {
        generateShareLink: (albumId: string) => Promise<{
          success: boolean
          shareLink?: { shareLinkToken: string | null; shareUrl: string; expiresAt: null }
          error?: string
        }>
        getFavorites: (
          albumId: string,
          clientName?: string
        ) => Promise<{
          success: boolean
          favorites: ApiFavoriteImage[]
          clientNames: string[]
          error?: string
        }>
      }
      plans: {
        list: () => Promise<{
          success: boolean
          data?: Array<ApiPlan>
          error?: string
        }>
        requestUpgrade: (planId: number) => Promise<{
          success: boolean
          error?: string
        }>
      }
      profile: {
        get: () => Promise<{
          success: boolean
          data?: ApiProfile
          error?: string
        }>
        update: (data: { businessName?: string; phone?: string }) => Promise<{
          success: boolean
          data?: ApiProfile
          error?: string
        }>
        getBookingUrl: () => Promise<{
          success: boolean
          bookingUrl?: string
          error?: string
        }>
        getBookings: () => Promise<{
          success: boolean
          data?: Booking[]
          error?: string
        }>
        getBillingAddresses: () => Promise<{
          success: boolean
          data?: Array<ApiBillingAddress>
          error?: string
        }>
        createBillingAddress: (data: {
          street: string
          city: string
          state: string
          zip: string
          country: string
          isDefault?: boolean
        }) => Promise<{
          success: boolean
          data?: ApiBillingAddress
          error?: string
        }>
        updateBillingAddress: (
          addressId: number,
          data: {
            street?: string
            city?: string
            state?: string
            zip?: string
            country?: string
            isDefault?: boolean
          }
        ) => Promise<{
          success: boolean
          data?: ApiBillingAddress
          error?: string
        }>
      }
      shell: {
        showItemInFolder: (
          albumId: string,
          imageId: number
        ) => Promise<{ success: boolean; error?: string }>
        openFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>
      }
      settings: {
        getAutoStart: () => Promise<{
          success: boolean
          enabled: boolean
          openAsHidden: boolean
          error?: string
        }>
        setAutoStart: (enabled: boolean) => Promise<{
          success: boolean
          enabled?: boolean
          error?: string
        }>
        getMinimizeToTray: () => Promise<{
          success: boolean
          enabled: boolean
          error?: string
        }>
        setMinimizeToTray: (enabled: boolean) => Promise<{
          success: boolean
          enabled?: boolean
          error?: string
        }>
        getAll: () => Promise<{
          success: boolean
          settings?: {
            autoStart: boolean
            autoStartHidden: boolean
            minimizeToTray: boolean
          }
          error?: string
        }>
      }
      power: {
        reportBattery: (level: number) => void
      }
      network: {
        getStatus: () => Promise<{ online: boolean }>
        checkConnectivity: () => Promise<{ online: boolean }>
        onStatusChange: (callback: (online: boolean) => void) => () => void
      }
      onUploadProgress: (
        callback: (event: IpcRendererEvent, progress: UploadProgress) => void
      ) => void
      offUploadProgress: (
        callback: (event: IpcRendererEvent, progress: UploadProgress) => void
      ) => void
      on: <A extends unknown[]>(
        channel: string,
        callback: (event: IpcRendererEvent, ...args: A) => void
      ) => void
      off: <A extends unknown[]>(
        channel: string,
        callback: (event: IpcRendererEvent, ...args: A) => void
      ) => void
    }
  }
}
