import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BrowserWindow } from 'electron'

vi.mock('./config', () => ({ getConfig: () => ({ reattach: true, portableSnapshot: true }) }))
vi.mock('./pipeline', () => ({
  uploadPipeline: { isActive: () => false, startPipeline: vi.fn(() => Promise.resolve()) }
}))
vi.mock('./watcher', () => ({
  watcherService: { watch: vi.fn(), unwatch: vi.fn(), checkSyncStatus: vi.fn() }
}))
vi.mock('./ipc/sync', () => ({ checkSourceFolder: () => true }))
vi.mock('./ipc/albums', () => ({ samePath: (a: string, b: string) => a === b }))

import { initDatabase, closeDatabase, createAlbum, getAlbum, updateAlbum } from './database'
import { reattachMoved, relinkAlbum } from './drives'

let loadable = true
try {
  new Database(':memory:').close()
} catch {
  loadable = false
}

const tmp = mkdtempSync(join(tmpdir(), 'lumo-drives-'))
function manifestAt(folder: string, albumId: string): void {
  mkdirSync(join(folder, '.lumosnap'), { recursive: true })
  const body = { schema: 1, albumId, writtenAt: '', app: '', images: [], sets: [], people: [] }
  const checksum = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  writeFileSync(join(folder, '.lumosnap', 'manifest.json'), JSON.stringify({ ...body, checksum }))
}
function album(id: string, folder: string, volumePath: string, orphaned: number): void {
  createAlbum({
    id,
    title: id.toUpperCase(),
    eventDate: null,
    startTime: null,
    endTime: null,
    localFolderPath: join(tmp, 'storage', id),
    sourceFolderPath: folder,
    albumType: 'standalone',
    totalImages: 0,
    lastSyncedAt: null,
    needsSync: 0,
    isOrphaned: 0
  })
  updateAlbum(id, { isOrphaned: orphaned, volume_path: volumePath })
}

describe.skipIf(!loadable)('auto re-attach when a drive mounts', () => {
  it('re-attaches on the drive whose manifest names the album; not a foreign folder', async () => {
    initDatabase(':memory:')
    const [gone, a, b] = ['gone', 'a', 'b'].map((r) => join(tmp, r))
    manifestAt(join(a, 'Shoots', 'Wedding'), 'someone-else') // same place, another album
    manifestAt(join(b, 'Shoots', 'Wedding'), 'wed')
    manifestAt(join(b, 'Party'), 'party')
    manifestAt(join(b, 'Used'), 'used') // its manifest, but another album uses that folder
    // ...and its own path exists, holding album z's card (z's own folder away), so it is missing
    manifestAt(join(gone, 'Used'), 'z')
    album('z', join(gone, 'Z'), 'Z', 1)
    album('wed', join(gone, 'Shoots', 'Wedding'), 'Shoots/Wedding', 1)
    album('party', join(gone, 'Party'), 'Party', 1)
    album('other', join(b, 'Party'), 'Party', 0) // stored there, but the folder names party: not its
    album('used', join(gone, 'Used'), 'Used', 1)
    album('user', join(b, 'Used'), 'Used', 0)

    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
    await reattachMoved(win, [a, b])

    expect(getAlbum('wed')).toMatchObject({
      sourceFolderPath: join(b, 'Shoots', 'Wedding'),
      isOrphaned: 0
    })
    expect(getAlbum('party')).toMatchObject({ sourceFolderPath: join(b, 'Party'), isOrphaned: 0 })
    expect(getAlbum('used')).toMatchObject({ sourceFolderPath: join(gone, 'Used'), isOrphaned: 1 })
    expect(send.mock.calls.map((c) => c[1].albumId).sort()).toEqual(['party', 'wed'])
    closeDatabase()
  })

  const win = (): BrowserWindow =>
    ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as unknown as BrowserWindow

  it('card A back as "NO NAME 1" while card B, also "NO NAME", holds the old name and folder', async () => {
    initDatabase(':memory:')
    const [cardB, cardA] = ['NO NAME', 'NO NAME 1'].map((r) => join(tmp, 'core', r))
    manifestAt(join(cardB, 'Shoots'), 'b') // same folder name, album B's
    manifestAt(join(cardA, 'Shoots'), 'a')
    album('b', join(cardB, 'Shoots'), 'Shoots', 0)
    album('a', join(cardB, 'Shoots'), 'Shoots', 1)
    updateAlbum('a', { volume_label: 'NO NAME' })
    await reattachMoved(win(), [cardB, cardA])
    expect(getAlbum('a')).toMatchObject({ sourceFolderPath: join(cardA, 'Shoots'), isOrphaned: 0 })
    expect(getAlbum('b')?.sourceFolderPath).toBe(join(cardB, 'Shoots'))
    closeDatabase()
  })

  it('a backup copy on a drive with another label is never it, card there or not', async () => {
    initDatabase(':memory:')
    const [card, backup] = ['NO NAME', 'BACKUP'].map((r) => join(tmp, 'bk', r))
    mkdirSync(card, { recursive: true }) // Wedding was renamed on the card
    manifestAt(join(backup, 'Wedding'), 'w')
    album('w', join(card, 'Wedding'), 'Wedding', 1)
    updateAlbum('w', { volume_label: 'NO NAME' })
    await reattachMoved(win(), [card, backup])
    expect(getAlbum('w')).toMatchObject({ sourceFolderPath: join(card, 'Wedding'), isOrphaned: 1 })
    // The card unplugged: the copy is still a backup, not the card
    await reattachMoved(win(), [backup])
    expect(getAlbum('w')).toMatchObject({ sourceFolderPath: join(card, 'Wedding'), isOrphaned: 1 })
    closeDatabase()
  })

  it('label unknown: only while its own drive is away, and only one candidate', async () => {
    initDatabase(':memory:')
    const [own, f, g] = ['E', 'F', 'G'].map((r) => join(tmp, 'unk', r))
    mkdirSync(own, { recursive: true })
    manifestAt(join(f, 'X'), 'u')
    album('u', join(own, 'X'), 'X', 1) // no volume_label: a Windows drive not read yet
    await reattachMoved(win(), [own, f]) // its drive is here: the folder moved on it
    expect(getAlbum('u')?.isOrphaned).toBe(1)
    manifestAt(join(g, 'X'), 'u')
    await reattachMoved(win(), [f, g]) // two copies: the person picks
    expect(getAlbum('u')?.isOrphaned).toBe(1)
    await reattachMoved(win(), [f])
    expect(getAlbum('u')).toMatchObject({ sourceFolderPath: join(f, 'X'), isOrphaned: 0 })
    closeDatabase()
  })

  it("an album stored at the folder whose own card is away doesn't hold it", async () => {
    // card1 was F: (album A), card2 alone was E: (album B); now card1 alone at E:
    const [e, f] = ['E', 'F'].map((r) => join(tmp, 'lock', r))
    const at = (root: string): string => join(root, 'DCIM', '100CANON')
    manifestAt(at(e), 'a')
    for (const relinkByHand of [false, true]) {
      initDatabase(':memory:')
      album('a', at(f), 'DCIM/100CANON', 1)
      album('b', at(e), 'DCIM/100CANON', 1)
      if (relinkByHand) expect(await relinkAlbum('a', at(e), win())).toBeNull()
      else await reattachMoved(win(), [e])
      expect(getAlbum('a')).toMatchObject({ sourceFolderPath: at(e), isOrphaned: 0 })
      expect(getAlbum('b')).toMatchObject({ sourceFolderPath: at(e), isOrphaned: 1 })
      closeDatabase()
    }
  })

  it('two drives with its label both hold it: leaves it for the person to pick', async () => {
    initDatabase(':memory:')
    const roots = ['NO NAME 1', 'NO NAME 2'].map((r) => join(tmp, 'two', r))
    for (const r of roots) manifestAt(join(r, 'X'), 'x')
    album('x', join(tmp, 'two', 'NO NAME', 'X'), 'X', 1)
    updateAlbum('x', { volume_label: 'NO NAME' })
    await reattachMoved(win(), roots)
    expect(getAlbum('x')?.isOrphaned).toBe(1)
    closeDatabase()
  })
})
