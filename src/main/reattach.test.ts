import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
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

let loadable = true
try {
  new Database(':memory:').close()
} catch {
  loadable = false
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

describe.skipIf(!loadable)('re-attach on a second computer', () => {
  it('adopts the album: matches by hash, manifest path and stem; never creates a new one', async () => {
    initDatabase(':memory:')
    const folder = join(root, 'Wedding')
    mkdirSync(join(folder, '.lumosnap', 'previews'), { recursive: true })
    mkdirSync(join(folder, '.lumosnap', 'thumbs'), { recursive: true })
    for (const f of ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'])
      writeFileSync(join(folder, f), `photo ${f}`)
    const h = Object.fromEntries(
      await Promise.all(
        ['a', 'b', 'c', 'd', 'e'].map(async (k) => [k, await hashFile(join(folder, `${k}.jpg`))])
      )
    )
    // a has its preview in the folder; the others don't
    writeFileSync(join(folder, '.lumosnap', 'previews', `${h.a}.webp`), 'preview a')
    writeFileSync(join(folder, '.lumosnap', 'thumbs', `${h.a}.webp`), 'thumb a')
    const body = {
      schema: 1,
      albumId: 'SRV',
      writtenAt: '',
      app: 'test',
      images: [{ path: 'c.jpg', hash: 'edited-since', serverId: 3, tags: [] }],
      sets: [],
      setsVersion: 2,
      people: [],
      peopleVersion: 1
    }
    writeFileSync(
      join(folder, '.lumosnap', 'manifest.json'),
      JSON.stringify({ ...body, checksum: sha(JSON.stringify(body)) })
    )
    const img = (id: number, hash: string | null, name: string): object => ({
      id,
      sourceImageHash: hash,
      originalFilename: name,
      fileSize: 1,
      width: 1,
      height: 1,
      uploadOrder: id
    })
    api.getAlbumWithImages.mockResolvedValue({
      id: 'SRV',
      title: 'Wedding',
      eventDate: null,
      images: [
        img(1, h.a, 'a.webp'),
        img(2, h.b, 'b.webp'),
        img(3, 'edited-since', 'c.webp'), // hash changed: matched by the manifest's path
        img(4, null, 'd.webp'), // no hash (old upload): matched by name
        img(5, 'only-online', 'z.webp')
      ]
    })
    api.getSets.mockResolvedValue({
      sets: [{ id: 'set1', name: 'Ceremony', position: 0, coverImageId: 5, imageIds: [1, 5] }],
      version: 4
    })
    api.getPeople.mockResolvedValue({
      people: [
        { id: 'p1', name: 'Pat', position: 0, coverImageId: 1, box: null, imageIds: [1, 5] }
      ],
      version: 6
    })

    const match = await matchFolder(folder)
    expect(match.kind).toBe('adopt')
    if (match.kind !== 'adopt') return
    const r = await adopt(folder, match.server, 'standalone', null)

    expect(api.create).not.toHaveBeenCalled()
    expect(r).toMatchObject({ albumId: 'SRV', matched: 4, remote: 1, total: 5 })
    const rows = new Map(getAlbumImages('SRV').map((i) => [i.originalFilename, i]))
    expect(rows.get('a.jpg')).toMatchObject({ serverId: 1, uploadStatus: 'complete' })
    expect(rows.get('b.jpg')).toMatchObject({ serverId: 2, uploadStatus: 'pending' }) // no preview
    expect(rows.get('c.jpg')?.serverId).toBe(3)
    expect(rows.get('d.jpg')?.serverId).toBe(4)
    expect(rows.get('e.jpg')).toMatchObject({ serverId: null, uploadStatus: 'pending' })
    expect(rows.get('z.webp')).toMatchObject({ serverId: 5, uploadStatus: 'remote' })

    const album = getAlbum('SRV')!
    expect(album).toMatchObject({
      adopting: 0,
      sets_version: 4,
      people_version: 6,
      sets_need_push: 0
    })
    const set = listSets('SRV')[0]
    expect(set.imageIds).toEqual([rows.get('a.jpg')!.id, rows.get('z.webp')!.id]) // the online-only photo stays in the set
    expect(set.coverImageId).toBe(rows.get('z.webp')!.id)
    expect(getRemotePeople('SRV').map((p) => p.name)).toEqual(['Pat'])

    // The same folder again: it's this computer's album now, never a second one
    expect((await matchFolder(folder)).kind).toBe('copy')
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  })

  it('never matches by name when two local files share it (IMG_1.jpg, IMG_1.png)', async () => {
    initDatabase(':memory:')
    const folder = mkdtempSync(join(tmpdir(), 'lumo-reattach-stem-'))
    mkdirSync(join(folder, '.lumosnap'))
    writeFileSync(join(folder, 'IMG_1.jpg'), 'one')
    writeFileSync(join(folder, 'IMG_1.png'), 'two')
    const body = {
      schema: 1,
      albumId: 'S2',
      writtenAt: '',
      app: '',
      images: [],
      sets: [],
      setsVersion: 0,
      people: [],
      peopleVersion: 0
    }
    writeFileSync(
      join(folder, '.lumosnap', 'manifest.json'),
      JSON.stringify({ ...body, checksum: sha(JSON.stringify(body)) })
    )
    const server = {
      id: 'S2',
      title: 'S2',
      eventDate: null,
      images: [
        {
          id: 9,
          sourceImageHash: null,
          originalFilename: 'IMG_1.webp',
          fileSize: 1,
          width: 1,
          height: 1,
          uploadOrder: 0
        }
      ]
    }
    api.getAlbumWithImages.mockResolvedValue(server)
    api.getSets.mockResolvedValue({ sets: [], version: 0 })
    api.getPeople.mockResolvedValue({ people: [], version: 0 })
    const r = await adopt(folder, server, 'standalone', null)
    expect(r).toMatchObject({ matched: 0, remote: 1 })
    expect(
      getAlbumImages('S2')
        .filter((i) => i.serverId === 9)
        .map((i) => i.uploadStatus)
    ).toEqual(['remote'])
    closeDatabase()
    rmSync(folder, { recursive: true, force: true })
  })

  it('drops an adoption whose album went away online, freeing the folder', async () => {
    initDatabase(':memory:')
    const folder = mkdtempSync(join(tmpdir(), 'lumo-reattach-gone-'))
    const server = { id: 'S3', title: 'S3', eventDate: null, images: [] }
    api.getAlbumWithImages.mockResolvedValueOnce(server)
    api.getSets.mockRejectedValueOnce(new Error('offline')) // the first try stops part way
    await expect(adopt(folder, server, 'standalone', null)).rejects.toThrow('offline')
    expect(getAlbum('S3')?.adopting).toBe(1)
    api.getAlbumWithImages.mockRejectedValueOnce(
      Object.assign(new Error('Album not found'), { status: 404 })
    )
    await expect(finishAdoption('S3', null)).rejects.toBeInstanceOf(AdoptionGoneError)
    expect(getAlbum('S3')).toBeFalsy()
    closeDatabase()
    rmSync(folder, { recursive: true, force: true })
  })

  it('offline: refuses instead of making a new album', async () => {
    initDatabase(':memory:')
    const folder = mkdtempSync(join(tmpdir(), 'lumo-reattach-off-'))
    mkdirSync(join(folder, '.lumosnap'))
    const body = {
      schema: 1,
      albumId: 'GONE?',
      writtenAt: '',
      app: '',
      images: [],
      sets: [],
      setsVersion: 0,
      people: [],
      peopleVersion: 0
    }
    writeFileSync(
      join(folder, '.lumosnap', 'manifest.json'),
      JSON.stringify({ ...body, checksum: sha(JSON.stringify(body)) })
    )
    api.getAlbumWithImages.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'))
    await expect(matchFolder(folder)).rejects.toThrow("Can't reach LumoSnap")
    api.getAlbumWithImages.mockRejectedValueOnce(
      Object.assign(new Error('Album not found'), { status: 404 })
    )
    expect((await matchFolder(folder)).kind).toBe('new')
    closeDatabase()
    rmSync(folder, { recursive: true, force: true })
  })
})
