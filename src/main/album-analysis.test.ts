import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import vectors from './tags/tag-vectors.json'
import {
  initDatabase,
  closeDatabase,
  createAlbum,
  createImagesBatch,
  saveImageEmbeddings,
  getAlbumTags,
  setAlbumEventType
} from './database'
import { rescoreAlbum } from './album-analysis'
import { TAG_MODEL } from './tags/select'

vi.mock('./ml/embedder', () => ({ embedBatch: vi.fn(), stopEmbedder: vi.fn(), BATCH_SIZE: 8 }))
vi.mock('./pipeline', () => ({ uploadPipeline: { isBusy: () => false } }))
vi.mock('./api-client', () => ({ albumsApi: {} }))

let loadable = true
try {
  new Database(':memory:').close()
} catch {
  loadable = false
}

/** A tag's first prompt vector, used as an image embedding: scores that tag sky-high. */
const vecOf = (slug: string): Float32Array => {
  const b = Buffer.from(vectors.tags.find((t) => t.slug === slug)!.vecs[0], 'base64')
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + vectors.dim * 4))
}

describe.skipIf(!loadable)('rescoreAlbum', () => {
  it("scores against the event type's pack; changing it rescores", async () => {
    initDatabase(':memory:')
    createAlbum({
      id: 'a',
      title: 'a',
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
    const [balloons, bride] = createImagesBatch(
      [0, 1].map((i) => ({
        albumId: 'a',
        serverId: null,
        originalFilename: `${i}.jpg`,
        localFilePath: `/x/${i}.jpg`,
        fileSize: 1,
        width: 1,
        height: 1,
        mtime: '',
        sourceFileHash: null,
        uploadStatus: 'pending' as const,
        uploadOrder: i
      }))
    ).map((img) => img.id)
    saveImageEmbeddings(TAG_MODEL, [
      { imageId: balloons, vec: vecOf('balloons') },
      { imageId: bride, vec: vecOf('bride') }
    ])

    await rescoreAlbum('a') // event_type NULL = wedding
    let tags = getAlbumTags('a')
    expect(tags.get(bride)).toContain('bride')
    expect(tags.get(balloons) ?? []).not.toContain('balloons')

    setAlbumEventType('a', 'birthday')
    await rescoreAlbum('a')
    tags = getAlbumTags('a')
    expect(tags.get(balloons)).toContain('balloons')
    expect(tags.get(bride) ?? []).not.toContain('bride')
    closeDatabase()
  })
})
