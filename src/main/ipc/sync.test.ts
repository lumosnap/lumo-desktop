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
  // 'other': an album whose own folder is gone (its card is the one mounted at this path now)
  getAlbum: (id: string) =>
    id === 'other' ? { id, sourceFolderPath: join(tmpdir(), 'lumo-gone-folder') } : db.album,
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
vi.mock('../volumes', () => ({ isNetworkDrive: () => false, isRemovableVolume: () => false }))
vi.mock('../portable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../portable')>()),
  scheduleManifest: vi.fn()
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

  it("another album's folder at the same path (its manifest names it) counts as missing", async () => {
    seed(10, 0) // this album's photos aren't in it
    mkdirSync(join(src(), '.lumosnap'))
    writeFileSync(join(src(), '.lumosnap', 'manifest.json'), '{"schema":1,"albumId":"other","imag')
    const r = await detectAlbumChanges('a') // album 'other' exists, its own folder doesn't
    expect(r.orphaned).toBe(true)
    expect(r.changes!.deleted).toHaveLength(0)
    expect(db.album!.isOrphaned).toBe(1)
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

  it('counts only this folder’s photos: online-only rows don’t dilute "most of it"', async () => {
    seed(20, 5) // 15 of 20 local photos gone
    const local = [...db.images]
    for (let i = 0; i < 200; i++)
      db.images.push({
        ...local[0],
        id: 1000 + i,
        serverId: 5000 + i,
        originalFilename: `r${i}.webp`,
        uploadStatus: 'remote'
      } as never)
    const r = await executeAlbumSync('a', asDeleted(local.slice(5)))
    expect(r).toMatchObject({ error: 'CONFIRM_MASS_DELETE', count: 15, total: 20 })
    expect(api.deleteImages).not.toHaveBeenCalled()
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

describe('one detection and one sync per album at a time', () => {
  it('a call during a detection waits for one fresh re-run, shared by every waiting caller', async () => {
    seed(2, 2)
    const first = detectAlbumChanges('a') // has listed the folder already
    writeFileSync(join(src(), 'NEW.jpg'), 'new photo')
    clearScanCache(src()) // as the watcher does on the event
    const second = detectAlbumChanges('a')
    const third = detectAlbumChanges('a')
    expect(third).toBe(second)
    expect((await first).changes!.new).toHaveLength(0)
    expect((await second).changes!.new.map((f) => f.filename)).toEqual(['NEW.jpg'])
  })

  it('the same rename from two checks at once is applied once', async () => {
    seed(1, 0)
    writeFileSync(join(src(), 'RENAMED.jpg'), 'x')
    const { updateImage } = await import('../database')
    vi.mocked(updateImage).mockImplementation((id, u) => {
      Object.assign(db.images.find((i) => i.id === id)!, u)
    })
    const renamed = [{ id: 1, oldFilename: 'IMG_0.jpg', newFilename: 'RENAMED.jpg' }]
    const changes = { renamed } as unknown as Parameters<typeof executeAlbumSync>[1]
    await Promise.all([executeAlbumSync('a', changes), executeAlbumSync('a', changes)])
    expect(updateImage).toHaveBeenCalledTimes(1)
    expect(db.images[0].originalFilename).toBe('RENAMED.jpg')
  })

  it('the same new photos from two syncs at once are added once (a double click)', async () => {
    seed(0, 0)
    writeFileSync(join(src(), 'NEW.jpg'), 'n')
    const { createImage } = await import('../database')
    vi.mocked(createImage).mockImplementation((img) => {
      db.images.push({ ...(img as unknown as Row), id: db.images.length + 1 })
      return 0 as never
    })
    const changes = {
      new: [{ filename: 'NEW.jpg', size: 1, mtime: new Date().toISOString() }]
    } as Parameters<typeof executeAlbumSync>[1]
    await Promise.all([executeAlbumSync('a', changes), executeAlbumSync('a', changes)])
    expect(createImage).toHaveBeenCalledTimes(1)
  })

  it('still adds a new photo named like an online-only one (it joins that row after upload)', async () => {
    seed(0, 0)
    writeFileSync(join(src(), 'NEW.jpg'), 'n')
    db.images.push({
      id: 9,
      serverId: 5,
      originalFilename: 'NEW.jpg',
      localFilePath: '',
      sourceFileHash: 'x',
      mtime: '',
      fileSize: 1,
      uploadOrder: 0,
      uploadStatus: 'remote'
    } as Row)
    const changes = {
      new: [{ filename: 'NEW.jpg', size: 1, mtime: new Date().toISOString() }]
    } as Parameters<typeof executeAlbumSync>[1]
    await executeAlbumSync('a', changes)
    const { createImage } = await import('../database')
    expect(createImage).toHaveBeenCalledTimes(1)
  })
})
