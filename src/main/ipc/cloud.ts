/**
 * Account albums that aren't on this computer, and attaching a folder to one: the re-attach
 * engine (reattach.ts) without needing the folder's .lumosnap to name the album.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { existsSync, rmSync } from 'fs'
import { albumsApi } from '../api-client'
import { deleteAlbum, getAlbum, getAllAlbums } from '../database'
import { createLogger, getErrorMessage } from '../logger'
import { legacyAlbumId, readManifest } from '../portable'
import { driveAlbums } from '../drives'
import { adopt, adoptionRunning, AdoptionGoneError, finishAdoption } from '../reattach'
import { samePath } from './albums'

const logger = createLogger('IPC:Cloud')

export interface CloudAlbum {
  id: string
  title: string
  eventDate: string | null
  totalImages: number
  thumbnailUrl: string | null
  /** Its folder on a plugged-in drive, from that drive's index; its manifest names this album */
  found?: { folder: string; drive: string | null }
}

/** FAILED: anything else (disk, a bad reply); its message is in the main log */
type Failure = 'OFFLINE' | 'AUTH' | 'SERVER' | 'FAILED'

export type ListCloudResult =
  | { success: true; albums: CloudAlbum[] }
  | { success: false; error: Failure }

export type AttachCloudResult =
  | {
      success: true
      albumId: string
      title: string
      matched: number
      remote: number
      total: number
    }
  | {
      success: false
      error:
        | 'LOCAL'
        | 'IN_USE'
        | 'OTHER_ALBUM'
        | 'NOT_FOUND'
        | 'OFFLINE'
        | 'NO_FOLDER'
        | 'BUSY'
        | Failure
    }

const status = (error: unknown): number | undefined => (error as { status?: number }).status
/** 'AUTH' (signed out), 'SERVER' (5xx, or a reply that isn't JSON), 'OFFLINE' (Electron's
 * net::ERR_* and apiFetch's timeout: the server never answered), else 'FAILED'. Logged here:
 * expected ones as a warning, the rest as an error */
const failure = (what: string, error: unknown): Failure => {
  const s = status(error)
  const message = getErrorMessage(error)
  const code: Failure =
    s === 401
      ? 'AUTH'
      : (s != null && s >= 500) || message.startsWith('Failed to parse API response')
        ? 'SERVER'
        : s == null && /net::|timed out/i.test(message)
          ? 'OFFLINE'
          : 'FAILED'
  if (code === 'FAILED') logger.error(`${what} failed:`, message)
  else logger.warn(`${what}: ${code} (${message})`)
  return code
}
const gone = (error: unknown): boolean => status(error) === 404 || status(error) === 403

export async function listCloud(): Promise<ListCloudResult> {
  try {
    // ponytail: the server returns only its newest 50 albums, so an older one isn't offered
    // here. Add paging to the worker's GET /albums (and a "more" row) when accounts outgrow it.
    // Found on a plugged-in drive: offered with its folder. A failure here only loses the hint
    const onDrives = driveAlbums().catch((error) => {
      logger.warn('Drive albums not read:', getErrorMessage(error))
      return new Map<string, { folder: string; drive: string | null }>()
    })
    const albums: CloudAlbum[] = (await albumsApi.list())
      // An attach cut short (adopting) isn't on this computer yet
      .filter((a) => !getAlbum(a.id) || getAlbum(a.id)!.adopting)
      .map((a) => ({
        id: a.id,
        title: a.title,
        eventDate: a.eventDate,
        totalImages: a.totalImages,
        thumbnailUrl: a.preview_link
      }))
    const found = await onDrives
    for (const a of albums) {
      const f = found.get(a.id)
      if (f) a.found = f
    }
    return { success: true, albums }
  } catch (error) {
    return { success: false, error: failure('albums:listCloud', error) }
  }
}

// Attaches under way: a second one for the same album or folder would adopt twice
const attaching: Array<{ albumId: string; folder: string }> = []

export async function attachCloud(
  albumId: string,
  folder: string,
  mainWindow: BrowserWindow | null
): Promise<AttachCloudResult> {
  if (attaching.some((a) => a.albumId === albumId || samePath(a.folder, folder)))
    return { success: false, error: 'BUSY' }
  const entry = { albumId, folder }
  attaching.push(entry)
  try {
    return await attachOnce(albumId, folder, mainWindow)
  } finally {
    attaching.splice(attaching.indexOf(entry), 1)
  }
}

/** LOCAL / IN_USE, or null. An attach cut short to another folder doesn't count: it is replaced */
function refusal(albumId: string, folder: string): 'LOCAL' | 'IN_USE' | null {
  const local = getAlbum(albumId)
  if (local && !(local.adopting && !samePath(local.sourceFolderPath, folder))) return 'LOCAL'
  if (getAllAlbums().some((a) => a.id !== albumId && samePath(a.sourceFolderPath, folder)))
    return 'IN_USE'
  return null
}

async function attachOnce(
  albumId: string,
  folder: string,
  mainWindow: BrowserWindow | null
): Promise<AttachCloudResult> {
  try {
    if (!existsSync(folder)) return { success: false, error: 'NO_FOLDER' }
    const local = getAlbum(albumId)
    if (local?.adopting && samePath(local.sourceFolderPath, folder)) {
      // An attach cut short (offline, quit): the same pick finishes it
      return {
        success: true,
        albumId,
        title: local.title,
        ...(await finishAdoption(albumId, mainWindow))
      }
    }
    if (local?.adopting && adoptionRunning(albumId)) return { success: false, error: 'BUSY' }
    const refused = refusal(albumId, folder)
    if (refused) return { success: false, error: refused }

    // The folder already names another album: the user picked the wrong folder. A stale name
    // (that album is gone online) doesn't count; adoption rewrites the manifest. Another
    // account's (403) is refused: its folder isn't this account's to take.
    const named = readManifest(folder)?.manifest.albumId ?? legacyAlbumId(folder)
    if (named && named !== albumId) {
      if (getAlbum(named)) return { success: false, error: 'OTHER_ALBUM' }
      try {
        // Only asking whether it exists: a short wait, a timeout is OFFLINE. ponytail: this
        // lists the photos too (no lighter album route); a huge album on a slow link may time out
        await albumsApi.getAlbumWithImages(named, 15_000)
        return { success: false, error: 'OTHER_ALBUM' }
      } catch (error) {
        if (status(error) === 403) return { success: false, error: 'OTHER_ALBUM' }
        if (status(error) !== 404)
          return { success: false, error: failure('albums:attachCloud', error) }
      }
    }

    let server
    try {
      server = await albumsApi.getAlbumWithImages(albumId)
    } catch (error) {
      return {
        success: false,
        error: gone(error) ? 'NOT_FOUND' : failure('albums:attachCloud', error)
      }
    }
    // Again: an album:create or relink may have taken it while we waited on the server
    const again = refusal(albumId, folder)
    if (again) return { success: false, error: again }
    const stale = getAlbum(albumId)
    if (stale) {
      if (adoptionRunning(albumId)) return { success: false, error: 'BUSY' }
      // An attach cut short, into another folder: it never finished, so start over in this one
      deleteAlbum(albumId) // its rows go with it (cascade)
      rmSync(stale.localFolderPath, { recursive: true, force: true })
      logger.info(`Unfinished attach of ${albumId} to ${stale.sourceFolderPath} replaced`)
    }
    // 'standalone': what CreateAlbumModal sends for a picked folder
    return { success: true, ...(await adopt(folder, server, 'standalone', mainWindow)) }
  } catch (error) {
    if (error instanceof AdoptionGoneError) {
      logger.info(`albums:attachCloud: ${albumId} is gone online`)
      return { success: false, error: 'NOT_FOUND' }
    }
    return { success: false, error: failure('albums:attachCloud', error) }
  }
}

export function registerCloudHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('albums:listCloud', () => listCloud())
  ipcMain.handle('albums:attachCloud', (_event, albumId: string, folder: string) =>
    attachCloud(albumId, folder, mainWindow)
  )
}
