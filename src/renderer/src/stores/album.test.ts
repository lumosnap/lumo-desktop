import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAlbumStore } from './album'
import { useAuthStore } from './auth'

const cloudAlbum = (
  id: string
): { id: string; title: string; eventDate: null; totalImages: number; thumbnailUrl: null } => ({
  id,
  title: id,
  eventDate: null,
  totalImages: 1,
  thumbnailUrl: null
})

// A promise the test settles by hand, to order the answers
function later<T>(): { p: Promise<T>; done: (v: T) => void } {
  let done!: (v: T) => void
  const p = new Promise<T>((r) => (done = r))
  return { p, done }
}

const api = {
  albums: { list: vi.fn(), listCloud: vi.fn(), attachCloud: vi.fn() },
  auth: { logout: vi.fn() },
  on: vi.fn(() => () => {})
}

beforeEach(() => {
  vi.resetAllMocks()
  api.on.mockReturnValue(() => {})
  api.albums.list.mockResolvedValue({ success: true, albums: [] })
  ;(globalThis as unknown as { window: unknown }).window = { api }
  setActivePinia(createPinia())
})

describe('album store: account albums', () => {
  it('puts the online sizes on the albums in place, also on a list that answers later', async () => {
    const s = useAlbumStore()
    s.albums = [{ id: 'a' } as never, { id: 'b' } as never]
    api.albums.listCloud.mockResolvedValue({ success: true, albums: [], sizes: { a: 2048 } })
    await s.loadCloud()
    expect(s.albums.map((x) => x.cloudSize)).toEqual([2048, undefined])
    expect(api.albums.list).not.toHaveBeenCalled()
    // An album:list asked before the sizes were stored answers now, without them
    api.albums.list.mockResolvedValue({ success: true, albums: [{ id: 'a', cloudSize: null }] })
    await s.load()
    expect(s.albums[0].cloudSize).toBe(2048)
  })

  it('cloudShown hides albums already here and keeps the one being matched', async () => {
    const s = useAlbumStore()
    s.albums = [{ id: 'a' } as never]
    s.cloud = [cloudAlbum('a'), cloudAlbum('b')]
    expect(s.cloudShown.map((c) => c.id)).toEqual(['b'])

    // c is in neither list while it matches, but its row stays
    const m = later<unknown>()
    api.albums.attachCloud.mockReturnValue(m.p)
    const run = s.attach(cloudAlbum('c'), '/x')
    expect(s.cloudShown.map((c) => c.id)).toEqual(['c', 'b'])
    m.done({ success: false, error: 'OTHER_ALBUM' })
    await run
    expect(s.attaching).toBeNull()
    expect(s.attachErrors.c).toBe('OTHER_ALBUM')
  })

  it('albums on a plugged-in drive come first, but not while a match runs', async () => {
    const s = useAlbumStore()
    const found = { folder: '/Volumes/NO NAME/b', drive: 'NO NAME' }
    const f = (id: string): object => ({ ...cloudAlbum(id), found })
    const list = [cloudAlbum('a'), f('b'), cloudAlbum('c'), f('d')]
    api.albums.listCloud.mockResolvedValue({ success: true, albums: list })
    await s.loadCloud()
    expect(s.cloudShown.map((c) => c.id)).toEqual(['b', 'd', 'a', 'c'])

    // A drive comes while c matches: the rows stay, a new album goes last
    const m = later<unknown>()
    api.albums.attachCloud.mockReturnValue(m.p)
    const run = s.attach(cloudAlbum('c'), '/x')
    api.albums.listCloud.mockResolvedValue({
      success: true,
      albums: [f('e'), f('a'), f('b'), cloudAlbum('c'), f('d')]
    })
    await s.loadCloud()
    expect(s.cloudShown.map((c) => c.id)).toEqual(['b', 'd', 'a', 'c', 'e'])
    m.done({ success: false, error: 'NO_FOLDER' })
    await run
    expect(s.attachErrors.c).toBe('NO_FOLDER')

    // The drive is back: the old line goes; a failed ask with keep leaves the list
    api.albums.listCloud.mockResolvedValue({ success: true, albums: [f('c')] })
    expect(await s.loadCloud()).toBe(true)
    expect(s.attachErrors.c).toBeUndefined()
    api.albums.listCloud.mockResolvedValue({ success: false, error: 'SERVER' })
    expect(await s.loadCloud({ keep: true })).toBe(false)
    expect([s.cloud?.map((c) => c.id), s.cloudFailed]).toEqual([['c'], false])
  })

  it('a late answer to an older ask is dropped', async () => {
    const s = useAlbumStore()
    const first = later<unknown>()
    api.albums.listCloud.mockReturnValueOnce(first.p)
    api.albums.listCloud.mockResolvedValueOnce({ success: true, albums: [cloudAlbum('new')] })
    const one = s.loadCloud()
    await s.loadCloud()
    first.done({ success: true, albums: [cloudAlbum('old')] })
    await one
    expect(s.cloud?.map((c) => c.id)).toEqual(['new'])
  })

  it('signed out is not a failure; other errors are', async () => {
    const s = useAlbumStore()
    api.albums.listCloud.mockResolvedValueOnce({ success: false, error: 'AUTH' })
    await s.loadCloud()
    expect([s.cloud, s.cloudFailed]).toEqual([[], false])
    for (const error of ['SERVER', 'OFFLINE', 'FAILED']) {
      api.albums.listCloud.mockResolvedValueOnce({ success: false, error })
      await s.loadCloud()
      expect(s.cloudFailed).toBe(true)
    }
    api.albums.listCloud.mockRejectedValueOnce(new Error('ipc gone'))
    await s.loadCloud()
    expect(s.cloudFailed).toBe(true)
  })

  it('logout and expiry clear the account, and drop answers still on the way', async () => {
    const s = useAlbumStore()
    const auth = useAuthStore()
    for (const out of [() => auth.logout(), () => auth.expire()]) {
      s.cloud = [cloudAlbum('b')]
      s.cloudFailed = true
      s.attachErrors = { b: 'SERVER' }
      const list = later<unknown>()
      const match = later<unknown>()
      api.albums.listCloud.mockReturnValueOnce(list.p)
      api.albums.attachCloud.mockReturnValueOnce(match.p)
      const asking = s.loadCloud()
      const attaching = s.attach(cloudAlbum('c'), '/x')
      await out()
      expect([s.cloud, s.cloudFailed, s.attaching, s.attachErrors]).toEqual([null, false, null, {}])
      list.done({ success: true, albums: [cloudAlbum('first-account')] })
      match.done({ success: false, error: 'SERVER' })
      expect(await attaching).toBeNull()
      await asking
      expect([s.cloud, s.attachErrors]).toEqual([null, {}])
    }
  })
})
