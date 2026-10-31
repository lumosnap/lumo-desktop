import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  runMigrations,
  initDatabase,
  closeDatabase,
  createAlbum,
  createImagesBatch,
  deleteImages,
  deleteAlbum,
  getAlbum,
  listSets,
  createSet,
  addImagesToSet,
  removeImagesFromSet,
  setSetCover,
  reorderSets,
  deleteSet,
  clearSetsNeedPush
} from './database'

// better-sqlite3 is rebuilt for Electron's ABI by postinstall; skip under plain Node if it won't load
let loadable = true
try {
  new Database(':memory:').close()
} catch {
  loadable = false
}

describe.skipIf(!loadable)('runMigrations', () => {
  it('upgrades a legacy schema and is idempotent', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE albums (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE images (id INTEGER PRIMARY KEY, albumId TEXT NOT NULL, uploadStatus TEXT);
    `)

    runMigrations(db)
    runMigrations(db)

    const cols = (t: string): string[] =>
      (db.pragma(`table_info(${t})`) as Array<{ name: string }>).map((c) => c.name)
    expect(db.pragma('user_version', { simple: true })).toBe(4)
    expect(cols('albums')).toEqual(
      expect.arrayContaining(['startTime', 'endTime', 'isOrphaned', 'albumType'])
    )
    expect(cols('images')).toEqual(
      expect.arrayContaining([
        'serverId',
        'captured_at',
        'burst_id',
        'thumbhash',
        'sharpness',
        'camera_id',
        'rating',
        'needs_push'
      ])
    )
    expect(cols('albums')).toContain('sets_need_push')
    expect(cols('album_sets')).toEqual(
      expect.arrayContaining(['id', 'album_id', 'name', 'position', 'cover_image_id'])
    )
    expect(cols('set_images')).toEqual(['set_id', 'image_id', 'position'])
    db.close()
  })
})

describe.skipIf(!loadable)('sets', () => {
  it('CRUD, dirty counter and cascades', () => {
    initDatabase(':memory:')
    const album = (id: string): void => {
      createAlbum({
        id,
        title: id,
        eventDate: null,
        startTime: null,
        endTime: null,
        localFolderPath: '/x',
        sourceFolderPath: '/y',
        albumType: 'standalone',
        totalImages: 0,
        lastSyncedAt: null,
        needsSync: 0,
        isOrphaned: 0
      })
    }
    album('a')
    album('b')
    const mk = (albumId: string, n: number): number[] =>
      createImagesBatch(
        Array.from({ length: n }, (_, i) => ({
          albumId,
          serverId: null,
          originalFilename: `${albumId}${i}.jpg`,
          localFilePath: `/x/${albumId}${i}.jpg`,
          fileSize: 1,
          width: 1,
          height: 1,
          mtime: '',
          sourceFileHash: null,
          uploadStatus: 'pending' as const,
          uploadOrder: i
        }))
      ).map((img) => img.id)
    const [i1, i2, i3] = mk('a', 3)
    const [other] = mk('b', 1)

    const s1 = createSet('a', 'Ceremony', [i1, i2, other]) // other album's image ignored
    const s2 = createSet('a', 'Party')
    expect(listSets('a').map((s) => [s.name, s.position, s.imageIds])).toEqual([
      ['Ceremony', 0, [i1, i2]],
      ['Party', 1, []]
    ])

    addImagesToSet(s2, [i2, i3, i2])
    setSetCover(s1, i2)
    expect(() => setSetCover(s2, i1)).toThrow()
    removeImagesFromSet(s1, [i2]) // the cover leaves, so the cover clears
    expect(listSets('a')[0]).toMatchObject({ imageIds: [i1], coverImageId: null })

    reorderSets('a', [s2])
    expect(listSets('a').map((s) => s.id)).toEqual([s2, s1])

    // Dirty counter: a stale clear is ignored
    const seen = getAlbum('a')!.sets_need_push!
    expect(seen).toBeGreaterThan(0)
    createSet('a', 'Later')
    clearSetsNeedPush('a', seen)
    expect(getAlbum('a')!.sets_need_push).toBe(seen + 1)
    clearSetsNeedPush('a', seen + 1)
    expect(getAlbum('a')!.sets_need_push).toBe(0)

    // Image delete drops membership; set delete drops rows; album delete drops sets
    deleteImages([i3])
    expect(listSets('a')[0].imageIds).toEqual([i2])
    deleteSet(s1)
    expect(listSets('a').map((s) => s.name)).toEqual(['Party', 'Later'])
    deleteAlbum('a')
    expect(listSets('a')).toEqual([])
    closeDatabase()
  })
})
