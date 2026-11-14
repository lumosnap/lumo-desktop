import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

type Row = {
  id: number
  serverId: number | null
  originalFilename: string
  localFilePath: string
  sourceFileHash: string | null
  mtime: string
  fileSize: number
  uploadOrder: number
}
const db = vi.hoisted(() => ({
  album: null as null | Record<string, unknown>,
  images: [] as Row[]
}))

vi.mock('../database', () => ({
  getAlbum: () => db.album,
  getAlbumImages: () => db.images,
  getAllAlbums: () => (db.album ? [db.album] : []),
  updateAlbum: (_id: string, u: Record<string, unknown>) => Object.assign(db.album!, u),
  deleteImages: (ids: number[]) => (db.images = db.images.filter((i) => !ids.includes(i.id))),
  createImage: vi.fn(),
  updateImage: vi.fn(),
  getImageByHash: () => null,
  resetImageAnalysis: vi.fn(),
  deleteDatabase: vi.fn()
}))
const api = vi.hoisted(() => ({ deleteImages: vi.fn(), delete: vi.fn() }))
vi.mock('../api-client', () => ({ albumsApi: api, profileApi: { get: vi.fn() } }))
const watcher = vi.hoisted(() => ({ watch: vi.fn(), unwatch: vi.fn(), closeAll: vi.fn() }))
vi.mock('../watcher', () => ({ watcherService: watcher }))
vi.mock('../pipeline', () => ({ uploadPipeline: { startPipeline: vi.fn() } }))
vi.mock('../album-analysis', () => ({ forgetPushedVectors: vi.fn(), regroupAlbum: vi.fn() }))
vi.mock('../people', () => ({ peoplePhotosChanged: vi.fn() }))
vi.mock('../notifications', () => ({ notificationService: { syncComplete: vi.fn() } }))
vi.mock('../album-metadata', () => ({
  needsSync: () => true,
  updateMetadataAfterSync: vi.fn(),
  getFolderStats: () => ({ totalSize: 0 })
}))

import { detectAlbumChanges, executeAlbumSync, diffFolder } from './sync'
import { hashFile } from '../hash'
import { renameSync } from 'fs'
import { clearScanCache, scanImagesInFolder } from '../storage'

let root: string
const src = (): string => join(root, 'src')

function seed(n: number, onDisk: number): void {
  mkdirSync(src(), { recursive: true })
  db.album = {
    id: 'a',
    title: 'A',
    sourceFolderPath: src(),
    localFolderPath: join(root, 'local'),
    isOrphaned: 0,
    needsSync: 0,
    lastSyncedAt: null
  }
  db.images = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    serverId: 100 + i,
    originalFilename: `IMG_${i}.jpg`,
    localFilePath: join(root, 'local', `IMG_${i}.jpg`),
    sourceFileHash: null,
    mtime: new Date(0).toISOString(),
    fileSize: 1,
    uploadOrder: i
  }))
  for (let i = 0; i < onDisk; i++) writeFileSync(join(src(), `IMG_${i}.jpg`), 'x')
}

const asDeleted = (rows: Row[]): Parameters<typeof executeAlbumSync>[1] => ({
  deleted: rows.map((r) => ({
    id: r.id,
    serverId: r.serverId,
    originalFilename: r.originalFilename,
    localFilePath: r.localFilePath
  }))
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumo-sync-'))
  clearScanCache()
  vi.clearAllMocks()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('missing source folder', () => {
  it('detectAlbumChanges deletes nothing and flags the album orphaned', async () => {
    seed(10, 10)
    rmSync(src(), { recursive: true })
    const r = await detectAlbumChanges('a')
    expect(r.orphaned).toBe(true)
    expect(r.changes!.deleted).toHaveLength(0)
    expect(db.album!.isOrphaned).toBe(1)
    expect(watcher.unwatch).toHaveBeenCalledWith('a')
  })

  it('clears the flag and re-watches when the folder is back', async () => {
    seed(2, 2)
    db.album!.isOrphaned = 1
    await detectAlbumChanges('a')
    expect(db.album!.isOrphaned).toBe(0)
    expect(watcher.watch).toHaveBeenCalledWith('a', src())
  })

  it('watches a present folder that watcher.initialize skipped (drive mounted late)', async () => {
    seed(1, 1)
    await detectAlbumChanges('a')
    expect(watcher.watch).toHaveBeenCalledWith('a', src())
  })

  it('executeAlbumSync refuses when the folder vanished after review', async () => {
    seed(3, 0)
    const changes = asDeleted(db.images)
    rmSync(src(), { recursive: true })
    const r = await executeAlbumSync('a', changes)
    expect(r.error).toBe('FOLDER_MISSING')
    expect(api.deleteImages).not.toHaveBeenCalled()
  })
})

describe('mass-delete gate', () => {
  it('holds back 10 of 10 deletions without confirmation', async () => {
    seed(10, 0)
    const r = await executeAlbumSync('a', asDeleted(db.images))
    expect(r).toMatchObject({ error: 'CONFIRM_MASS_DELETE', count: 10, total: 10 })
    expect(api.deleteImages).not.toHaveBeenCalled()
    expect(db.images).toHaveLength(10)
  })

  it('deletes them once confirmed', async () => {
    seed(10, 0)
    const serverIds = db.images.map((i) => i.serverId)
    const r = await executeAlbumSync('a', asDeleted(db.images), null, true)
    expect(r.success).toBe(true)
    expect(api.deleteImages).toHaveBeenCalledWith('a', serverIds)
    expect(db.images).toHaveLength(0)
  })

  it('does not ask for a small deletion from a non-empty folder', async () => {
    seed(4, 2) // IMG_2, IMG_3 gone: 50% but fewer than 10
    const r = await executeAlbumSync('a', asDeleted(db.images.slice(2)))
    expect(r.success).toBe(true)
    expect(api.deleteImages).toHaveBeenCalledWith('a', [102, 103])
  })

  it('asks when the folder is empty, however few photos', async () => {
    seed(1, 0)
    const r = await executeAlbumSync('a', asDeleted(db.images))
    expect(r.error).toBe('CONFIRM_MASS_DELETE')
  })

  it('skips rows from a stale list whose file is back, and ids from other albums', async () => {
    seed(4, 3) // only IMG_3 is really gone
    const changes = asDeleted(db.images) // stale: lists all four
    changes.deleted!.push({ id: 999, serverId: 5, originalFilename: 'x.jpg', localFilePath: '' })
    const r = await executeAlbumSync('a', changes)
    expect(r.success).toBe(true)
    expect(api.deleteImages).toHaveBeenCalledWith('a', [103])
    expect(db.images.map((i) => i.id)).toEqual([1, 2, 3])
  })
})

describe('diffFolder (relink preview)', () => {
  it('matches renamed files by content: 2 of 10 renamed, none missing', async () => {
    seed(10, 10)
    for (const row of db.images) {
      writeFileSync(join(src(), row.originalFilename), `photo ${row.id}`)
      row.sourceFileHash = await hashFile(join(src(), row.originalFilename))
    }
    renameSync(join(src(), 'IMG_0.jpg'), join(src(), 'Ceremony 1.jpg'))
    renameSync(join(src(), 'IMG_1.jpg'), join(src(), 'Ceremony 2.jpg'))
    const changes = await diffFolder(
      db.album as never,
      src(),
      scanImagesInFolder(src(), false),
      db.images as never
    )
    expect(changes.renamed).toHaveLength(2)
    expect(changes.deleted).toHaveLength(0)
    expect(changes.new).toHaveLength(0)
  })
})

describe('diffFolder duplicates', () => {
  it('skips a copy of a photo still in the folder', async () => {
    seed(1, 1)
    writeFileSync(join(src(), 'IMG_0.jpg'), 'same')
    db.images[0].sourceFileHash = await hashFile(join(src(), 'IMG_0.jpg'))
    writeFileSync(join(src(), 'IMG_0 copy.jpg'), 'same')
    const changes = await diffFolder(
      db.album as never,
      src(),
      scanImagesInFolder(src(), false),
      db.images as never
    )
    expect(changes.skipped.map((f) => f.filename)).toEqual(['IMG_0 copy.jpg'])
    expect(changes.new).toHaveLength(0)
  })
})

describe('reset all data', () => {
  it('removes only <storage>/Lumosnap, not the folder the user picked', async () => {
    vi.resetModules()
    const handlers: Record<string, () => Promise<unknown>> = {}
    vi.doMock('electron', () => ({
      ipcMain: { handle: (ch: string, fn: () => Promise<unknown>) => (handlers[ch] = fn) },
      shell: {},
      app: {}
    }))
    vi.doMock('../config', () => ({
      getStorageLocation: () => root,
      getConfigPath: () => join(root, 'no-config.json'),
      resetConfig: vi.fn(),
      isConfigured: vi.fn(),
      setStorageLocation: vi.fn(),
      getConfig: vi.fn()
    }))
    vi.doMock('../auth-storage', () => ({ clearAuth: vi.fn() }))
    db.album = null
    mkdirSync(join(root, 'Lumosnap', 'albums'), { recursive: true })
    writeFileSync(join(root, 'mine.txt'), 'keep me')
    const { registerConfigHandlers } = await import('./config')
    registerConfigHandlers()
    expect(await handlers['config:resetAllData']()).toEqual({ success: true })
    expect(existsSync(join(root, 'Lumosnap'))).toBe(false)
    expect(existsSync(join(root, 'mine.txt'))).toBe(true)
  })
})

describe('expired sign-in', () => {
  it('clears auth once across parallel 401s, and never for /auth or a newer token', async () => {
    vi.resetModules()
    let token: string | null = 'old'
    const clearAuth = vi.fn(() => (token = null))
    const send = vi.fn()
    vi.doMock('../auth-storage', () => ({ getToken: () => token, clearAuth }))
    vi.doMock('electron', () => ({
      net: {},
      BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] }
    }))
    vi.doUnmock('../api-client')
    const { handleUnauthorized } = await import('../api-client')
    for (let i = 0; i < 3; i++) handleUnauthorized('/albums', 'old')
    expect(clearAuth).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('auth:expired')

    token = 'fresh' // signed in again; a late 401 for the old token must not undo it
    handleUnauthorized('/albums', 'old')
    handleUnauthorized('/auth/session', 'fresh')
    expect(clearAuth).toHaveBeenCalledTimes(1)
  })
})
