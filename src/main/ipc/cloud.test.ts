import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = mkdtempSync(join(tmpdir(), 'lumo-cloud-'))
const api = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  getAlbumWithImages: vi.fn(),
  getSets: vi.fn(),
  getPeople: vi.fn()
}))
vi.mock('../api-client', () => ({ albumsApi: api }))
vi.mock('../config', () => ({
  getConfig: () => ({ reattach: false, portableSnapshot: true }), // the flag doesn't gate this
  getStorageLocation: () => join(root, 'storage')
}))
vi.mock('../pipeline', () => ({
  uploadPipeline: { startPipeline: vi.fn(() => Promise.resolve()) }
}))
vi.mock('../watcher', () => ({ watcherService: { watch: vi.fn() } }))
// The real ./albums (its samePath), without what it pulls in from Electron
vi.mock('../drives', () => ({
  isNetworkDrive: () => false,
  isRemovableVolume: () => false,
  relinkAlbum: vi.fn()
}))
vi.mock('./sync', () => ({ checkSourceFolder: () => true, diffFolder: vi.fn() }))

import { initDatabase, closeDatabase, getAlbum, getAllAlbums, getAlbumImages } from '../database'
import { hashFile } from '../hash'
import { finishAdoption } from '../reattach'
import { attachCloud, listCloud } from './cloud'

let loadable = true
try {
  new Database(':memory:').close()
} catch {
  loadable = false
}

const img = (id: number, hash: string | null, name: string): object => ({
  id,
  sourceImageHash: hash,
  originalFilename: name,
  fileSize: 1,
  width: 1,
  height: 1,
  uploadOrder: id
})
let n = 0
const dir = (): string => {
  const d = join(root, `f${n++}`)
  mkdirSync(d)
  return d
}
const offline = (): Error => new Error('net::ERR_INTERNET_DISCONNECTED')

describe.skipIf(!loadable)('attach a cloud album to a folder', () => {
  let folder: string
  let h: string
  beforeEach(async () => {
    vi.clearAllMocks()
    initDatabase(':memory:')
    folder = dir()
    writeFileSync(join(folder, 'a.jpg'), 'photo a')
    writeFileSync(join(folder, 'new.jpg'), 'photo new')
    h = await hashFile(join(folder, 'a.jpg'))
    api.getAlbumWithImages.mockResolvedValue({
      id: 'SRV',
      title: 'Wedding',
      eventDate: null,
      images: [img(1, h, 'a.webp'), img(2, 'only-online', 'z.webp')]
    })
    api.getSets.mockResolvedValue({ sets: [], version: 0 })
    api.getPeople.mockResolvedValue({ people: [], version: 0 })
  })
  afterEach(() => closeDatabase())
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('refuses a folder that is not there', async () => {
    expect(await attachCloud('SRV', join(root, 'nope'), null)).toEqual({
      success: false,
      error: 'NO_FOLDER'
    })
  })

  it('matches by hash with no manifest and makes no second album', async () => {
    const r = await attachCloud('SRV', folder, null)
    expect(r).toMatchObject({ success: true, albumId: 'SRV', matched: 1, remote: 1, total: 2 })
    expect(api.create).not.toHaveBeenCalled()
    expect(getAllAlbums().map((a) => [a.id, a.albumType])).toEqual([['SRV', 'standalone']])
    const rows = new Map(getAlbumImages('SRV').map((i) => [i.originalFilename, i]))
    expect(rows.get('a.jpg')?.serverId).toBe(1)
    expect(rows.get('new.jpg')).toMatchObject({ serverId: null, uploadStatus: 'pending' })
    expect(rows.get('z.webp')?.uploadStatus).toBe('remote')
  })

  it('once local: refused as LOCAL, and hidden from the list', async () => {
    await attachCloud('SRV', folder, null)
    expect(await attachCloud('SRV', folder, null)).toEqual({ success: false, error: 'LOCAL' })
    api.list.mockResolvedValueOnce([
      { id: 'SRV', title: 'Wedding', eventDate: null, totalImages: 2, preview_link: null },
      { id: 'B', title: 'Party', eventDate: '2026-01-01', totalImages: 3, preview_link: 'u' }
    ])
    expect(await listCloud()).toEqual({
      success: true,
      albums: [
        { id: 'B', title: 'Party', eventDate: '2026-01-01', totalImages: 3, thumbnailUrl: 'u' }
      ]
    })
  })

  it('refuses a folder whose manifest names another album as OTHER_ALBUM, asked with a short wait', async () => {
    await attachCloud('SRV', folder, null)
    const other = dir()
    mkdirSync(join(other, '.lumosnap'))
    const body = {
      schema: 1,
      albumId: 'SRV',
      writtenAt: '',
      app: '',
      images: [],
      sets: [],
      setsVersion: 0,
      people: [],
      peopleVersion: 0
    }
    const checksum = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    writeFileSync(join(other, '.lumosnap', 'manifest.json'), JSON.stringify({ ...body, checksum }))
    expect(await attachCloud('B', other, null)).toEqual({ success: false, error: 'OTHER_ALBUM' })
    expect(getAllAlbums()).toHaveLength(1)

    // Named album not here: asked online with the short timeout; a timeout is OFFLINE
    body.albumId = 'ELSEWHERE'
    const sum2 = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    writeFileSync(
      join(other, '.lumosnap', 'manifest.json'),
      JSON.stringify({ ...body, checksum: sum2 })
    )
    api.getAlbumWithImages.mockRejectedValueOnce(new Error('Request timed out: GET /albums/x'))
    expect(await attachCloud('B', other, null)).toEqual({ success: false, error: 'OFFLINE' })
    expect(api.getAlbumWithImages).toHaveBeenLastCalledWith('ELSEWHERE', 15_000)
  })

  it('maps list failures to OFFLINE, AUTH, SERVER and FAILED', async () => {
    api.list.mockRejectedValueOnce(offline())
    expect(await listCloud()).toEqual({ success: false, error: 'OFFLINE' })
    api.list.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }))
    expect(await listCloud()).toEqual({ success: false, error: 'AUTH' })
    api.list.mockRejectedValueOnce(Object.assign(new Error('Bad gateway'), { status: 502 }))
    expect(await listCloud()).toEqual({ success: false, error: 'SERVER' })
    api.list.mockRejectedValueOnce(Object.assign(new Error('Teapot'), { status: 418 }))
    expect(await listCloud()).toEqual({ success: false, error: 'FAILED' })
  })

  it('a second attach while the first waits on the server: BUSY, for the album or the folder', async () => {
    let answer: (v: unknown) => void = () => {}
    api.getAlbumWithImages.mockImplementationOnce(() => new Promise((_r, j) => (answer = j)))
    const first = attachCloud('B', folder, null)
    expect(await attachCloud('B', dir(), null)).toEqual({ success: false, error: 'BUSY' })
    expect(await attachCloud('C', folder, null)).toEqual({ success: false, error: 'BUSY' })
    answer(Object.assign(new Error('Not found'), { status: 404 }))
    expect(await first).toEqual({ success: false, error: 'NOT_FOUND' })
  })

  it('an attach cut short resumes when the same folder is picked again', async () => {
    api.getSets.mockRejectedValueOnce(offline())
    expect(await attachCloud('SRV', folder, null)).toEqual({ success: false, error: 'OFFLINE' })
    expect(getAlbum('SRV')?.adopting).toBe(1)
    // Spelled in another case: the same folder on Windows and macOS
    const again = process.platform === 'linux' ? folder : folder.toUpperCase()
    expect(await attachCloud('SRV', again, null)).toMatchObject({ success: true, matched: 1 })
    expect(getAlbum('SRV')).toMatchObject({ adopting: 0, sourceFolderPath: folder })
  })

  it('an attach cut short is replaced by a fresh one in a different folder', async () => {
    api.getSets.mockRejectedValueOnce(offline())
    await attachCloud('SRV', folder, null)
    const other = dir()
    writeFileSync(join(other, 'a.jpg'), 'photo a')
    const r = await attachCloud('SRV', other, null)
    expect(r).toMatchObject({ success: true, matched: 1, remote: 1 })
    expect(getAllAlbums().map((a) => [a.id, a.sourceFolderPath, a.adopting])).toEqual([
      ['SRV', other, 0]
    ])
    expect(getAlbumImages('SRV').map((i) => i.originalFilename)).not.toContain('new.jpg')
  })

  it('refuses BUSY while that album is still matching for another folder', async () => {
    api.getSets.mockRejectedValueOnce(offline())
    await attachCloud('SRV', folder, null)
    let release: (v: unknown) => void = () => {}
    api.getSets.mockImplementationOnce(() => new Promise((r) => (release = r)))
    const resumed = finishAdoption('SRV', null) // startup resume, still on the server
    expect(await attachCloud('SRV', dir(), null)).toEqual({ success: false, error: 'BUSY' })
    release({ sets: [], version: 0 })
    await resumed
    expect(getAlbum('SRV')).toMatchObject({ adopting: 0, sourceFolderPath: folder })
  })
})
