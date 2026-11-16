import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = mkdtempSync(join(tmpdir(), 'lumo-reattach-'))
const api = vi.hoisted(() => ({
  create: vi.fn(),
  getAlbumWithImages: vi.fn(),
  getSets: vi.fn(),
  getPeople: vi.fn()
}))
vi.mock('./api-client', () => ({ albumsApi: api }))
vi.mock('./config', () => ({
  getConfig: () => ({ reattach: true, portableSnapshot: true }),
  getStorageLocation: () => join(root, 'storage')
}))
vi.mock('./pipeline', () => ({ uploadPipeline: { startPipeline: vi.fn(() => Promise.resolve()) } }))
vi.mock('./watcher', () => ({ watcherService: { watch: vi.fn() } }))
// portable.ts asks drives.ts about the volume; the real one pulls in Electron's Notification
vi.mock('./drives', () => ({ isNetworkDrive: () => false, isRemovableVolume: () => false }))

import {
  initDatabase,
  closeDatabase,
  getAlbum,
  getAlbumImages,
  listSets,
  getRemotePeople
} from './database'
import { adopt, matchFolder, finishAdoption, AdoptionGoneError } from './reattach'
import { hashFile } from './hash'
import type { ServerAlbum } from './api-client'

let loadable = true
try {
  new Database(':memory:').close()
} catch {
  loadable = false
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const img = (
  id: number,
  hash: string | null,
  name: string,
  uploadOrder = id
): ServerAlbum['images'][number] => ({
  id,
  sourceImageHash: hash,
  originalFilename: name,
  fileSize: 1,
  width: 1,
  height: 1,
  uploadOrder
})

let n = 0
/** A folder with these files and a .lumosnap manifest naming albumId */
function folderWith(
  albumId: string,
  files: string[],
  images: Array<{ path: string; hash: string; serverId: number; tags: string[] }> = []
): string {
  const folder = join(root, `f${n++}`)
  mkdirSync(join(folder, '.lumosnap', 'previews'), { recursive: true })
  mkdirSync(join(folder, '.lumosnap', 'thumbs'), { recursive: true })
  for (const f of files) writeFileSync(join(folder, f), `photo ${f}`)
  const body = {
    schema: 1,
    albumId,
    writtenAt: '',
    app: 'test',
    images,
    sets: [],
    setsVersion: 0,
    people: [],
    peopleVersion: 0
  }
  writeFileSync(
    join(folder, '.lumosnap', 'manifest.json'),
    JSON.stringify({ ...body, checksum: sha(JSON.stringify(body)) })
  )
  return folder
}
/** The file's preview and thumbnail in the folder's snapshot; returns its hash */
async function withPreview(folder: string, file: string): Promise<string> {
  const h = await hashFile(join(folder, file))
  writeFileSync(join(folder, '.lumosnap', 'previews', `${h}.webp`), `preview ${file}`)
  writeFileSync(join(folder, '.lumosnap', 'thumbs', `${h}.webp`), `thumb ${file}`)
  return h
}
function serve(id: string, images: ServerAlbum['images']): ServerAlbum {
  const server = { id, title: id, eventDate: null, images }
  api.getAlbumWithImages.mockResolvedValue(server)
  return server
}
const rowsOf = (id: string): Map<string, ReturnType<typeof getAlbumImages>[number]> =>
  new Map(getAlbumImages(id).map((i) => [i.originalFilename, i]))

describe.skipIf(!loadable)('re-attach on a second computer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initDatabase(':memory:')
    api.getSets.mockResolvedValue({ sets: [], version: 0 })
    api.getPeople.mockResolvedValue({ people: [], version: 0 })
  })
  afterEach(() => closeDatabase())
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('matches by hash, by the manifest path, and by name; never creates a new album', async () => {
    const folder = folderWith(
      'SRV',
      ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'],
      [{ path: 'c.jpg', hash: 'edited-since', serverId: 3, tags: [] }]
    )
    const h = {
      a: await withPreview(folder, 'a.jpg'), // a has its preview in the folder; b doesn't
      b: await hashFile(join(folder, 'b.jpg')),
      d: await withPreview(folder, 'd.jpg')
    }
    serve('SRV', [
      img(1, h.a, 'a.webp'),
      img(2, h.b, 'b.webp'),
      img(3, 'edited-since', 'c.webp'), // hash changed: matched by the manifest's path
      img(4, null, 'd.webp'), // no hash (old upload), its preview here: matched by name
      img(5, 'only-online', 'z.webp')
    ])
    const match = await matchFolder(folder)
    expect(match.kind).toBe('adopt')
    if (match.kind !== 'adopt') return
    const r = await adopt(folder, match.server, 'standalone', null)

    expect(api.create).not.toHaveBeenCalled()
    expect(r).toMatchObject({ albumId: 'SRV', matched: 4, remote: 1, total: 5 })
    const rows = rowsOf('SRV')
    expect(rows.get('a.jpg')).toMatchObject({ serverId: 1, uploadStatus: 'complete' })
    expect(rows.get('b.jpg')).toMatchObject({ serverId: 2, uploadStatus: 'pending' }) // no preview
    expect(rows.get('c.jpg')?.serverId).toBe(3)
    expect(rows.get('d.jpg')).toMatchObject({ serverId: 4, uploadStatus: 'complete' })
    expect(rows.get('e.jpg')).toMatchObject({ serverId: null, uploadStatus: 'pending' })
    expect(rows.get('z.webp')).toMatchObject({ serverId: 5, uploadStatus: 'remote' })
    // The same folder again: it's this computer's album now, never a second one
    expect((await matchFolder(folder)).kind).toBe('copy')
  })

  it('pulls sets and people with their versions, read before the photos', async () => {
    const folder = folderWith('SP', ['a.jpg'])
    const h = await withPreview(folder, 'a.jpg')
    const server = serve('SP', [img(1, h, 'a.webp'), img(5, 'only-online', 'z.webp')])
    api.getSets.mockResolvedValue({
      sets: [{ id: 'set1', name: 'Ceremony', position: 0, coverImageId: 5, imageIds: [1, 5] }],
      version: 4
    })
    api.getPeople.mockResolvedValue({
      people: [{ id: 'p1', name: 'Pat', position: 0, coverImageId: 1, box: null, imageIds: [1] }],
      version: 6
    })
    await adopt(folder, server, 'standalone', null)

    const last = (f: typeof api.getSets): number => f.mock.invocationCallOrder.at(-1)!
    expect(last(api.getSets)).toBeLessThan(last(api.getAlbumWithImages))
    expect(last(api.getPeople)).toBeLessThan(last(api.getAlbumWithImages))
    expect(getAlbum('SP')).toMatchObject({
      adopting: 0,
      sets_version: 4,
      people_version: 6,
      sets_need_push: 0
    })
    const rows = rowsOf('SP')
    const set = listSets('SP')[0]
    expect(set.imageIds).toEqual([rows.get('a.jpg')!.id, rows.get('z.webp')!.id]) // online-only stays
    expect(set.coverImageId).toBe(rows.get('z.webp')!.id)
    expect(getRemotePeople('SP').map((p) => p.name)).toEqual(['Pat'])
  })

  it('a manifest naming another album: matched by hash only, never by its paths or names', async () => {
    const folder = folderWith(
      'OTHER',
      ['a.jpg', 'c.jpg', 'd.jpg'],
      [{ path: 'c.jpg', hash: 'edited-since', serverId: 3, tags: [] }]
    )
    const a = await withPreview(folder, 'a.jpg')
    await withPreview(folder, 'd.jpg')
    const server = serve('FOR', [
      img(1, a, 'a.webp'),
      img(3, 'edited-since', 'c.webp'),
      img(4, null, 'd.webp')
    ])
    expect(await adopt(folder, server, 'standalone', null)).toMatchObject({ matched: 1, remote: 2 })
    const rows = rowsOf('FOR')
    expect(rows.get('a.jpg')?.serverId).toBe(1)
    expect(rows.get('c.jpg')?.serverId).toBeNull()
    expect(rows.get('d.jpg')?.serverId).toBeNull()
  })

  it('a name match without the preview here stays a new photo, and the old one stays online', async () => {
    const folder = folderWith('NP', ['d.jpg'])
    const server = serve('NP', [img(4, null, 'd.webp')])
    expect(await adopt(folder, server, 'standalone', null)).toMatchObject({ matched: 0, remote: 1 })
    const rows = getAlbumImages('NP')
    expect(rows.find((i) => i.originalFilename === 'd.jpg')).toMatchObject({
      serverId: null,
      uploadStatus: 'pending'
    })
    expect(rows.find((i) => i.serverId === 4)?.uploadStatus).toBe('remote')
  })

  it('matches an NFD name to an NFC one, and names the copy as the disk spells it', async () => {
    const nfd = 'Café' // macOS's spelling of Café
    const folder = folderWith('NFD', [`${nfd}.jpg`])
    await withPreview(folder, `${nfd}.jpg`)
    const server = serve('NFD', [img(7, null, 'Café.webp')])
    expect(await adopt(folder, server, 'standalone', null)).toMatchObject({ matched: 1 })
    const row = getAlbumImages('NFD').find((i) => i.serverId === 7)!
    const out = join(getAlbum('NFD')!.localFolderPath, `${nfd}.webp`)
    expect(row).toMatchObject({ uploadStatus: 'complete', localFilePath: out })
    expect(existsSync(out)).toBe(true)
    expect(existsSync(join(getAlbum('NFD')!.localFolderPath, '.thumbnail', `${nfd}.webp`))).toBe(
      true
    )
  })

  it.skipIf(process.platform === 'linux')(
    'matches names ignoring case on Windows and macOS',
    async () => {
      const folder = folderWith('CASE', ['IMG_2.JPG'])
      await withPreview(folder, 'IMG_2.JPG')
      const server = serve('CASE', [img(8, null, 'img_2.webp')])
      expect(await adopt(folder, server, 'standalone', null)).toMatchObject({ matched: 1 })
    }
  )

  it('never matches by name when two local files share it (IMG_1.jpg, IMG_1.png)', async () => {
    const folder = folderWith('S2', ['IMG_1.jpg', 'IMG_1.png'])
    await withPreview(folder, 'IMG_1.jpg')
    await withPreview(folder, 'IMG_1.png')
    const server = serve('S2', [img(9, null, 'IMG_1.webp', 0)])
    expect(await adopt(folder, server, 'standalone', null)).toMatchObject({
      matched: 0,
      remote: 1
    })
    expect(
      getAlbumImages('S2')
        .filter((i) => i.serverId === 9)
        .map((i) => i.uploadStatus)
    ).toEqual(['remote'])
  })

  it("orders new photos after the server's last, and reports matching progress", async () => {
    const folder = folderWith('ORD', ['new.jpg'])
    const server = serve('ORD', [img(1, 'x', 'x.webp', 100)]) // one photo, order 100
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    await adopt(folder, server, 'standalone', win as never)
    expect(rowsOf('ORD').get('new.jpg')?.uploadOrder).toBe(101)
    expect(send).toHaveBeenCalledWith('album:attach-progress', {
      albumId: 'ORD',
      done: 1,
      total: 1
    })
  })

  it('drops an adoption whose album went away online, freeing the folder', async () => {
    const folder = mkdtempSync(join(root, 'gone-'))
    const server = serve('S3', [])
    api.getSets.mockRejectedValueOnce(new Error('offline')) // the first try stops part way
    await expect(adopt(folder, server, 'standalone', null)).rejects.toThrow('offline')
    expect(getAlbum('S3')?.adopting).toBe(1)
    api.getAlbumWithImages.mockRejectedValueOnce(
      Object.assign(new Error('Album not found'), { status: 404 })
    )
    await expect(finishAdoption('S3', null)).rejects.toBeInstanceOf(AdoptionGoneError)
    expect(getAlbum('S3')).toBeFalsy()
  })

  it('offline: refuses instead of making a new album', async () => {
    const folder = folderWith('GONE?', [])
    api.getAlbumWithImages.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'))
    await expect(matchFolder(folder)).rejects.toThrow("Can't reach LumoSnap")
    api.getAlbumWithImages.mockRejectedValueOnce(
      Object.assign(new Error('Album not found'), { status: 404 })
    )
    expect((await matchFolder(folder)).kind).toBe('new')
  })
})
