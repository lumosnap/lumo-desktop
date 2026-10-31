import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './database'

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
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(cols('albums')).toEqual(
      expect.arrayContaining(['startTime', 'endTime', 'isOrphaned', 'albumType'])
    )
    expect(cols('images')).toEqual(
      expect.arrayContaining(['serverId', 'captured_at', 'burst_id', 'thumbhash', 'sharpness'])
    )
    db.close()
  })
})
