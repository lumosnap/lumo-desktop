import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'

const api = vi.hoisted(() => ({ putSets: vi.fn(), getSets: vi.fn() }))
vi.mock('./api-client', () => ({ albumsApi: api }))
vi.mock('./ml/embedder', () => ({ embedBatch: vi.fn(), stopEmbedder: vi.fn(), BATCH_SIZE: 8 }))
vi.mock('./pipeline', () => ({ uploadPipeline: { isBusy: () => false } }))

import {
  initDatabase,
  closeDatabase,
  createAlbum,
  createImagesBatch,
  createSet,
  getAlbum,
  listSets,
  updateImage
} from './database'
import { pushSets } from './album-analysis'

let loadable = true
try {
  new Database(':memory:').close()
} catch {
  loadable = false
}

describe.skipIf(!loadable)('pushSets version conflict', () => {
  it('on 409 pulls the other computer’s sets, then retries once with its version', async () => {
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
    const [img] = createImagesBatch([
      {
        albumId: 'a',
        serverId: null,
        originalFilename: '0.jpg',
        localFilePath: '/x/0.jpg',
        fileSize: 1,
        width: 1,
        height: 1,
        mtime: '',
        sourceFileHash: null,
        uploadStatus: 'complete' as const,
        uploadOrder: 0
      }
    ])
    updateImage(img.id, { serverId: 500 })
    createSet('a', 'Mine', [img.id])

    api.putSets
      .mockRejectedValueOnce(
        Object.assign(new Error('Sets changed on another computer'), { status: 409 })
      )
      .mockResolvedValueOnce({ version: 8 })
    api.getSets.mockResolvedValueOnce({
      sets: [{ id: 'other', name: 'Theirs', position: 1, coverImageId: 500, imageIds: [500, 999] }],
      version: 7
    })

    await pushSets('a')

    expect(api.putSets).toHaveBeenCalledTimes(2)
    expect(api.putSets.mock.calls[0][2]).toBe(0)
    expect(api.putSets.mock.calls[1][2]).toBe(7) // retried on the pulled version
    expect(api.putSets.mock.calls[1][1].map((s: { name: string }) => s.name).sort()).toEqual([
      'Mine',
      'Theirs'
    ])
    const theirs = listSets('a').find((s) => s.id === 'other')!
    expect(theirs.imageIds).toEqual([img.id]) // server id 999 isn't here: dropped
    expect(theirs.coverImageId).toBe(img.id)
    expect(getAlbum('a')?.sets_version).toBe(8)
    expect(getAlbum('a')?.sets_need_push).toBe(0) // the retry sent the pulled set too
    closeDatabase()
  })
})
