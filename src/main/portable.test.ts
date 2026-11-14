import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const db = vi.hoisted(() => ({ album: null as null | Record<string, unknown> }))
const images = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('./database', () => ({
  getAlbum: () => db.album,
  getAlbumImages: () => images,
  getAlbumTags: () => new Map([[1, ['bride']]]),
  listSets: () => [{ id: 's', name: 'S', position: 0, coverImageId: 1, imageIds: [1] }],
  getAlbumPeople: () => [{ id: 'p', name: 'Pat', hidden: 0, faces: [{ imageId: 1 }] }]
}))
vi.mock('./config', () => ({ getConfig: () => ({ portableSnapshot: true }) }))

import { ensureDir, legacyAlbumId, readManifest, writeManifest, SNAPSHOT_DIR } from './portable'

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'lumo-portable-'))
  db.album = { id: 'A', sourceFolderPath: folder, sets_version: 3, people_version: 1 }
  images.splice(0, images.length, {
    id: 1,
    originalFilename: 'Cafe\u0301.jpg', // NFD, as macOS can list it from exFAT
    sourceFileHash: 'h1',
    serverId: 10,
    uploadStatus: 'pending',
    localFilePath: '/nowhere/Café.jpg'
  })
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe('portable snapshot', () => {
  it('writes a manifest that reads back, with NFC paths', () => {
    expect(writeManifest('A')).toBe(true)
    const r = readManifest(folder)!
    expect(r.readOnly).toBe(false)
    expect(r.manifest.albumId).toBe('A')
    expect(r.manifest.images[0].path).toBe('Café.jpg'.normalize('NFC'))
    expect(r.manifest.sets[0]).toMatchObject({ coverHash: 'h1', imageHashes: ['h1'] })
    expect(r.manifest.people[0]).toMatchObject({ name: 'Pat', imageHashes: ['h1'] })
  })

  it('falls back to the .bak when the current file is torn', () => {
    writeManifest('A') // first write: no .bak yet
    writeManifest('A') // second: the first becomes the .bak
    writeFileSync(join(folder, SNAPSHOT_DIR, 'manifest.json'), '{"schema":1,"albumId":"A","imag')
    expect(readManifest(folder)?.manifest.albumId).toBe('A')
  })

  it('a torn current file never replaces a good .bak', () => {
    writeManifest('A')
    writeManifest('A') // .bak = a good manifest
    const cur = join(folder, SNAPSHOT_DIR, 'manifest.json')
    writeFileSync(cur, 'garbage')
    writeManifest('A') // the garbage must not become the .bak
    writeFileSync(cur, 'garbage again') // as if this write was torn too
    expect(readManifest(folder)?.manifest.albumId).toBe('A')
  })

  it('copies previews in by hash and redoes a torn copy', () => {
    const local = join(folder, 'app-storage')
    mkdirSync(join(local, '.thumbnail'), { recursive: true })
    writeFileSync(join(local, 'Café.webp'), 'preview-bytes')
    writeFileSync(join(local, '.thumbnail', 'Café.webp'), 'thumb')
    db.album = { ...db.album, localFolderPath: local }
    images[0].uploadStatus = 'complete'
    images[0].originalFilename = 'Café.jpg'
    writeManifest('A')
    const prev = join(folder, SNAPSHOT_DIR, 'previews', 'h1.webp')
    expect(readFileSync(prev, 'utf-8')).toBe('preview-bytes')
    writeFileSync(prev, '') // a power cut left 0 bytes
    writeManifest('A')
    expect(readFileSync(prev, 'utf-8')).toBe('preview-bytes')
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'thumbs', 'h1.webp'))).toBe(true)
  })

  it('rejects a manifest whose checksum does not match', () => {
    writeManifest('A')
    const p = join(folder, SNAPSHOT_DIR, 'manifest.json')
    writeFileSync(p, readFileSync(p, 'utf-8').replace('"A"', '"B"'))
    expect(readManifest(folder)).toBeNull()
  })

  it('never overwrites a manifest from a newer app', () => {
    writeManifest('A')
    const p = join(folder, SNAPSHOT_DIR, 'manifest.json')
    const { checksum: _c, ...body } = JSON.parse(readFileSync(p, 'utf-8'))
    const newer = { ...body, schema: 99 }
    const { createHash } = require('crypto')
    const sum = createHash('sha256').update(JSON.stringify(newer)).digest('hex')
    writeFileSync(p, JSON.stringify({ ...newer, checksum: sum }))
    expect(readManifest(folder)?.readOnly).toBe(true)
    expect(writeManifest('A')).toBe(false)
  })

  it('moves an old .lumosnap file into the directory and keeps its album id', () => {
    writeFileSync(join(folder, '.lumosnap'), JSON.stringify({ version: 1, albumId: 'old-id' }))
    expect(legacyAlbumId(folder)).toBe('old-id')
    ensureDir(folder)
    expect(statSync(join(folder, SNAPSHOT_DIR)).isDirectory()).toBe(true)
    expect(existsSync(join(folder, SNAPSHOT_DIR, '.lumosnap-legacy.json'))).toBe(true)
    expect(legacyAlbumId(folder)).toBe('old-id')
  })
})
