import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { join } from 'path'

const db = vi.hoisted(() => ({
  album: null as null | Record<string, unknown>,
  others: {} as Record<string, Record<string, unknown> | undefined>, // undefined: not local
  onImages: null as null | (() => void) // runs once on the next image listing
}))
const images = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('./database', () => ({
  getAlbum: (id: string) => (id in db.others ? db.others[id] : db.album),
  getAlbumImages: () => {
    const f = db.onImages
    db.onImages = null
    f?.()
    return images
  },
  getAlbumTags: () => new Map([[1, ['bride']]]),
  listSets: () => [{ id: 's', name: 'S', position: 0, coverImageId: 1, imageIds: [1] }],
  getAlbumPeople: () => [{ id: 'p', name: 'Pat', hidden: 0, faces: [{ imageId: 1 }] }]
}))
vi.mock('./config', () => ({ getConfig: () => ({ portableSnapshot: true }) }))
const disk = vi.hoisted(() => ({
  free: null as number | null, // null: the real statfs
  total: 0,
  removable: false,
  refuse: '', // copyFile throws EPERM for sources containing this
  network: false,
  active: 0,
  maxActive: 0
}))
vi.mock('fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs/promises')>()
  return {
    ...real,
    statfs: (p: string) =>
      disk.free == null
        ? real.statfs(p)
        : Promise.resolve({ bavail: disk.free, blocks: disk.total, bsize: 1 }),
    copyFile: async (from: string, to: string) => {
      if (disk.refuse && from.includes(disk.refuse)) {
        throw Object.assign(new Error('locked'), { code: 'EPERM' })
      }
      disk.maxActive = Math.max(disk.maxActive, ++disk.active)
      try {
        await real.copyFile(from, to)
      } finally {
        disk.active--
      }
    }
  }
})
vi.mock('./volumes', () => ({
  drivesKnown: () => true,
  isNetworkDrive: () => disk.network,
  isRemovableVolume: () => disk.removable
}))
const child = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('child_process', () => child)

import {
  cancelPreviews,
  ensureDir,
  folderOwner,
  isCloudSynced,
  legacyAlbumId,
  sourcePresent,
  previewsSettled,
  readManifest,
  writeManifest,
  SNAPSHOT_DIR
} from './portable'

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
afterEach(async () => {
  await previewsSettled('A')
  await previewsSettled('B')
  await previewsSettled('X')
  await previewsSettled('N')
  for (const o of Object.values(db.others)) {
    if (o) rmSync(o.sourceFolderPath as string, { recursive: true, force: true })
  }
  db.others = {}
  Object.assign(disk, {
    free: null,
    total: 0,
    removable: false,
    refuse: '',
    network: false,
    maxActive: 0
  })
  rmSync(folder, { recursive: true, force: true })
})

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

  const withPreviews = (): void => {
    const local = join(folder, 'app-storage')
    mkdirSync(join(local, '.thumbnail'), { recursive: true })
    writeFileSync(join(local, 'Café.webp'), 'preview-bytes') // 13 bytes
    writeFileSync(join(local, '.thumbnail', 'Café.webp'), 'thumb') // 5
    db.album = { ...db.album, localFolderPath: local }
    images[0].uploadStatus = 'complete'
    images[0].originalFilename = 'Café.jpg'
  }

  it('copies previews in by hash and redoes a torn copy', async () => {
    withPreviews()
    writeManifest('A')
    await previewsSettled('A')
    const prev = join(folder, SNAPSHOT_DIR, 'previews', 'h1.webp')
    expect(readFileSync(prev, 'utf-8')).toBe('preview-bytes')
    writeFileSync(prev, '') // a power cut left 0 bytes
    writeManifest('A')
    await previewsSettled('A')
    expect(readFileSync(prev, 'utf-8')).toBe('preview-bytes')
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'thumbs', 'h1.webp'))).toBe(true)
  })

  it('stops copying before the drive drops below the free-space floor, manifest kept', async () => {
    withPreviews()
    disk.free = 2 * 1024 ** 3 + 15 // room for the 13-byte preview, not the thumb after it
    expect(writeManifest('A')).toBe(true)
    await previewsSettled('A')
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'previews', 'h1.webp'))).toBe(true)
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'thumbs', 'h1.webp'))).toBe(false)
    expect(readManifest(folder)?.manifest.albumId).toBe('A')
  })

  it('on a removable card, stops before a quarter of the card is left free', async () => {
    withPreviews()
    disk.removable = true
    disk.total = 100 * 1024 ** 3
    disk.free = 25 * 1024 ** 3 + 15 // room for the preview above 25 %, not the thumb
    writeManifest('A')
    await previewsSettled('A')
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'previews', 'h1.webp'))).toBe(true)
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'thumbs', 'h1.webp'))).toBe(false)
  })

  it('a file the OS refuses is skipped and the run goes on', async () => {
    withPreviews()
    disk.refuse = join('app-storage', 'Café.webp') // the preview, not the thumb
    writeManifest('A')
    await previewsSettled('A')
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'previews', 'h1.webp'))).toBe(false)
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'thumbs', 'h1.webp'))).toBe(true)
  })

  it('cancelPreviews stops a run before its next file', async () => {
    withPreviews()
    writeManifest('A')
    db.onImages = cancelPreviews // as the queued run starts listing its photos
    await previewsSettled('A')
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'previews', 'h1.webp'))).toBe(false)
  })

  it('one preview run app-wide: a second album waits for the first', async () => {
    withPreviews()
    const other = mkdtempSync(join(tmpdir(), 'lumo-portable-'))
    db.others.B = { ...db.album, id: 'B', sourceFolderPath: other }
    writeManifest('A')
    writeManifest('B')
    await previewsSettled('B')
    expect(existsSync(join(other, SNAPSHOT_DIR, 'thumbs', 'h1.webp'))).toBe(true)
    expect(existsSync(join(folder, SNAPSHOT_DIR, 'thumbs', 'h1.webp'))).toBe(true) // A went first
    expect(disk.maxActive).toBe(1)
  })

  it('a write during a preview run runs it once more after, never two at once', async () => {
    withPreviews()
    writeManifest('A')
    const first = previewsSettled('A')
    writeManifest('A') // during the run
    expect(previewsSettled('A')).toBe(first) // the same run, marked to go again
    await first
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
    const body = JSON.parse(readFileSync(p, 'utf-8'))
    delete body.checksum
    const newer = { ...body, schema: 99 }
    const sum = createHash('sha256').update(JSON.stringify(newer)).digest('hex')
    writeFileSync(p, JSON.stringify({ ...newer, checksum: sum }))
    expect(readManifest(folder)?.readOnly).toBe(true)
    expect(writeManifest('A')).toBe(false)
  })

  it('Windows: hides .lumosnap once, when it is made, with no console window', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      child.execFile.mockClear()
      ensureDir(folder)
      ensureDir(folder)
      expect(child.execFile).toHaveBeenCalledTimes(1)
      expect(child.execFile.mock.calls[0][2]).toEqual({ windowsHide: true })
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it('knows sync-client folders on Windows and macOS', () => {
    for (const p of [
      'C:\\Users\\me\\OneDrive - Studio\\Shoots',
      'C:\\Users\\me\\Dropbox (Personal)\\a',
      'G:\\My Drive\\a',
      'C:\\Users\\me\\iCloudDrive\\a',
      '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/a',
      '/Users/me/Library/CloudStorage/GoogleDrive-x/a'
    ]) {
      expect(isCloudSynced(p), p).toBe(true)
    }
    expect(isCloudSynced('/Volumes/NO NAME/DCIM')).toBe(false)
  })

  describe('folderOwner', () => {
    const named = (id: string): void => {
      db.album = { ...db.album, id }
      writeManifest(id)
      db.album = { ...db.album, id: 'A' }
    }
    it("another card at this album's path whose album's own folder is gone is that album's", () => {
      named('X')
      db.others.X = { id: 'X', sourceFolderPath: join(folder, 'gone') }
      expect(folderOwner(folder, 'A')).toBe('X')
      expect(sourcePresent({ id: 'A', sourceFolderPath: folder })).toBe(false)
    })
    it("two NO NAME cards, both albums stored this path: B's card is in, so A's is missing", () => {
      named('B')
      db.others.B = { id: 'B', sourceFolderPath: folder }
      images[0].originalFilename = 'IMG_1.jpg' // A's photo, not on B's card
      expect(folderOwner(folder, 'A')).toBe('B')
      expect(sourcePresent({ id: 'A', sourceFolderPath: folder })).toBe(false)
      expect(sourcePresent({ id: 'B', sourceFolderPath: folder })).toBe(true)
    })
    it('two albums that shared one folder before manifests: present for both', () => {
      named('X')
      db.others.X = { id: 'X', sourceFolderPath: folder }
      images[0].originalFilename = 'IMG_1.jpg'
      writeFileSync(join(folder, 'IMG_1.jpg'), 'x') // A's photos are here too
      expect(folderOwner(folder, 'A')).toBeNull()
      expect(sourcePresent({ id: 'A', sourceFolderPath: folder })).toBe(true)
      expect(sourcePresent({ id: 'X', sourceFolderPath: folder })).toBe(true)
    })
    it("another computer's card (its album not here) is foreign only if none of A's photos are in it", () => {
      images[0].sourceFileHash = 'theirs'
      named('N')
      db.others.N = undefined // N is not on this computer
      images[0].sourceFileHash = 'h1' // A's photo, not in N's manifest
      expect(folderOwner(folder, 'A')).toBe('N')
      images[0].uploadStatus = 'remote' // no photo of A's here to compare
      expect(folderOwner(folder, 'A')).toBeNull()
      images[0].uploadStatus = 'pending'
      images[0].sourceFileHash = null // not hashed yet: can't tell
      expect(folderOwner(folder, 'A')).toBeNull()
      images[0].sourceFileHash = 'theirs' // A's photo is in it: shared
      expect(folderOwner(folder, 'A')).toBeNull()
    })
    it('a folder that cannot be written (network share): path only, the manifest is not trusted', () => {
      // Written by hand: writeManifest would probe the folder writable and keep that
      mkdirSync(join(folder, SNAPSHOT_DIR))
      const body = { schema: 1, albumId: 'X', images: [] }
      const checksum = createHash('sha256').update(JSON.stringify(body)).digest('hex')
      writeFileSync(
        join(folder, SNAPSHOT_DIR, 'manifest.json'),
        JSON.stringify({ ...body, checksum })
      )
      db.others.X = { id: 'X', sourceFolderPath: join(folder, 'gone') }
      disk.network = true
      expect(folderOwner(folder, 'A')).toBeNull()
      disk.network = false
      expect(folderOwner(folder, 'A')).toBe('X')
    })
    it("never writes this album's snapshot over another album's card at its path", () => {
      named('X')
      db.others.X = { id: 'X', sourceFolderPath: join(folder, 'gone') } // X's card is this one
      expect(writeManifest('A')).toBe(false)
      expect(readManifest(folder)?.manifest.albumId).toBe('X')
      expect(writeManifest('A', true)).toBe(true) // an explicit "this folder is A's now"
      expect(readManifest(folder)?.manifest.albumId).toBe('A')
    })
    it('a copy whose new manifest was never written: present while the original is there', () => {
      named('X')
      const original = mkdtempSync(join(tmpdir(), 'lumo-portable-'))
      db.others.X = { id: 'X', sourceFolderPath: original }
      expect(folderOwner(folder, 'A')).toBeNull()
      rmSync(original, { recursive: true })
    })
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
