import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'
import { createLogger, getErrorMessage } from './logger'
import { effectiveTags } from './tags/select'
import { bestMatches, classify } from './people-match'

const logger = createLogger('Database')

let db: Database.Database | null = null

export interface Album {
  id: string
  title: string
  eventDate: string | null // ISO 8601 datetime string (legacy/primary date)
  startTime: string | null // ISO 8601 datetime string
  endTime: string | null // ISO 8601 datetime string
  localFolderPath: string
  sourceFolderPath: string
  albumType: 'watch_folder' | 'standalone' // watch_folder = in master folder, standalone = custom path
  totalImages: number
  lastSyncedAt: string | null
  needsSync: number // 0 or 1 (SQLite boolean)
  isOrphaned: number // 0 or 1 - true if source folder was deleted
  createdAt: string
  sets_need_push?: number // migration 4: >0 = sets changed locally since the last full push
  tag_set?: string | null // migration 6: JSON array of enabled AI tag slugs; null = all
  tags_scored?: string | null // migration 6: scoring key the AI tags were last computed with
  event_type?: string | null // migration 7: picks the AI tag pack; null = wedding
  people_enabled?: number // migration 8: 1 = find and group faces (opt-in)
  people_need_push?: number // migration 8: >0 = people changed locally since the last full push
  vectors_hash?: string | null // migration 11: hash of the LSV1 search file last uploaded; null = none
  vectors_ids?: string | null // migration 12: JSON server ids in that file (deletes-only changes skip the upload)
}

export interface AlbumSet {
  id: string
  albumId: string
  name: string
  position: number
  coverImageId: number | null // local image id
  imageIds: number[] // local image ids, in insertion order
}

export interface Image {
  id: number
  albumId: string
  serverId: number | null // ID from the server/cloud
  originalFilename: string
  localFilePath: string
  fileSize: number
  width: number
  height: number
  mtime: string
  sourceFileHash: string | null
  uploadStatus:
    | 'pending'
    | 'compressing'
    | 'uploading'
    | 'complete'
    | 'failed'
    | 'failed_compression'
    | 'failed_upload'
  uploadOrder: number
  createdAt: string
  // Browse metadata (migrations 2-3), snake_case like their columns; null until analyzed
  captured_at?: number | null // unix ms, EXIF wall-clock encoded as UTC
  camera_id?: string | null
  rating?: number | null
  phash?: string | null
  sharpness?: number | null
  thumbhash?: string | null
  burst_id?: string | null
  is_burst_cover?: number | null // 0 or 1
  moment_id?: string | null
  needs_push?: number | null // 1 = browse fields changed locally, not yet PATCHed to server
  tags_need_push?: number | null // migration 5: 1 = AI tags changed, not yet PATCHed
  faces_scanned?: number | null // migration 8: 1 = face detection ran (even if it found none)
}

export function initDatabase(dbPath = join(app.getPath('userData'), 'lumosnap.db')): void {
  db = new Database(dbPath)

  // Enable foreign keys
  db.pragma('foreign_keys = ON')
  // WAL lets reads proceed during writes; busy_timeout waits instead of SQLITE_BUSY
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')

  // Create tables
  createTables()

  runMigrations(db)

  // Create indexes
  createIndexes()
}

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  const tableInfo = database.pragma(`table_info(${table})`) as Array<{ name: string }>
  return tableInfo.some((col) => col.name === column)
}

/**
 * Ordered schema migrations. Migration N runs when user_version < N, then sets
 * user_version = N in the same transaction. Append only; never reorder.
 */
const migrations: Array<(database: Database.Database) => void> = [
  // 1: legacy column additions (guarded, so idempotent for installs that already have them)
  (database) => {
    if (!hasColumn(database, 'images', 'serverId')) {
      database.exec('ALTER TABLE images ADD COLUMN serverId INTEGER')
    }
    if (!hasColumn(database, 'albums', 'startTime')) {
      database.exec('ALTER TABLE albums ADD COLUMN startTime TEXT')
    }
    if (!hasColumn(database, 'albums', 'endTime')) {
      database.exec('ALTER TABLE albums ADD COLUMN endTime TEXT')
    }
    if (!hasColumn(database, 'albums', 'isOrphaned')) {
      database.exec('ALTER TABLE albums ADD COLUMN isOrphaned INTEGER DEFAULT 0')
    }
    if (!hasColumn(database, 'albums', 'albumType')) {
      database.exec("ALTER TABLE albums ADD COLUMN albumType TEXT DEFAULT 'watch_folder'")
    }
  },
  // 2: browse metadata (populated later)
  (database) => {
    database.exec(`
      ALTER TABLE images ADD COLUMN captured_at INTEGER;
      ALTER TABLE images ADD COLUMN burst_id TEXT;
      ALTER TABLE images ADD COLUMN is_burst_cover INTEGER;
      ALTER TABLE images ADD COLUMN moment_id TEXT;
      ALTER TABLE images ADD COLUMN phash TEXT;
      ALTER TABLE images ADD COLUMN sharpness REAL;
      ALTER TABLE images ADD COLUMN thumbhash TEXT;
      CREATE INDEX IF NOT EXISTS idx_images_album_captured ON images(albumId, captured_at);
      CREATE INDEX IF NOT EXISTS idx_images_album_status ON images(albumId, uploadStatus);
    `)
  },
  // 3: grouping inputs + server push marker
  (database) => {
    database.exec(`
      ALTER TABLE images ADD COLUMN camera_id TEXT;
      ALTER TABLE images ADD COLUMN rating INTEGER;
      ALTER TABLE images ADD COLUMN needs_push INTEGER DEFAULT 0;
    `)
  },
  // 4: photographer-defined sets. albums.sets_need_push counts unpushed mutations (0 = clean)
  (database) => {
    database.exec(`
      CREATE TABLE album_sets (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        cover_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_album_sets_album ON album_sets(album_id, position);
      CREATE TABLE set_images (
        set_id TEXT NOT NULL REFERENCES album_sets(id) ON DELETE CASCADE,
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        position INTEGER,
        PRIMARY KEY (set_id, image_id)
      );
      CREATE INDEX idx_set_images_image ON set_images(image_id);
      ALTER TABLE albums ADD COLUMN sets_need_push INTEGER DEFAULT 0;
    `)
  },
  // 5: AI tags. vec = little-endian f32 image embedding from `model`
  (database) => {
    database.exec(`
      CREATE TABLE image_embeddings (
        image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        vec BLOB NOT NULL
      );
      CREATE TABLE image_tags (
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        score REAL NOT NULL,
        PRIMARY KEY (image_id, tag)
      );
      CREATE INDEX idx_image_tags_tag ON image_tags(tag);
      ALTER TABLE images ADD COLUMN tags_need_push INTEGER DEFAULT 0;
    `)
  },
  // 6: per-album AI tag set, album-relative scoring key, manual per-photo tag overrides
  (database) => {
    database.exec(`
      ALTER TABLE albums ADD COLUMN tag_set TEXT;
      ALTER TABLE albums ADD COLUMN tags_scored TEXT;
      CREATE TABLE image_tag_overrides (
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
        PRIMARY KEY (image_id, tag)
      );
    `)
  },
  // 7: album event type (AI tag pack); NULL = wedding for albums created before it
  (database) => {
    database.exec('ALTER TABLE albums ADD COLUMN event_type TEXT')
  },
  // 8: People. Face vectors never leave the device. box/landmarks = JSON, normalized to the photo.
  // face_overrides.person_id NULL = "not this person / no one". people.cover_face_id NULL = auto.
  (database) => {
    database.exec(`
      ALTER TABLE albums ADD COLUMN people_enabled INTEGER DEFAULT 0;
      ALTER TABLE albums ADD COLUMN people_need_push INTEGER DEFAULT 0;
      ALTER TABLE images ADD COLUMN faces_scanned INTEGER DEFAULT 0;
      CREATE TABLE people (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        name TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        cover_face_id INTEGER REFERENCES faces(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_people_album ON people(album_id);
      CREATE TABLE faces (
        id INTEGER PRIMARY KEY,
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        box TEXT NOT NULL,
        score REAL NOT NULL,
        landmarks TEXT NOT NULL,
        vec BLOB NOT NULL,
        person_id TEXT REFERENCES people(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_faces_image ON faces(image_id);
      CREATE INDEX idx_faces_person ON faces(person_id);
      CREATE TABLE face_overrides (
        face_id INTEGER PRIMARY KEY REFERENCES faces(id) ON DELETE CASCADE,
        person_id TEXT REFERENCES people(id) ON DELETE CASCADE
      );
      CREATE TABLE client_people (
        album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        client_name TEXT NOT NULL,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        PRIMARY KEY (album_id, client_name)
      );
    `)
  },
  // 9: People from references. faces.source 'ref' = the photographer confirmed this face is
  // person_id, 'auto' = matched to a reference. Rejected = "not this person", never re-matched.
  // Old clustering: unnamed people go; faces the photographer named become references.
  (database) => {
    database.exec(`
      ALTER TABLE faces ADD COLUMN source TEXT;
      CREATE TABLE face_rejections (
        face_id INTEGER NOT NULL REFERENCES faces(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        PRIMARY KEY (face_id, person_id)
      );
      CREATE INDEX idx_face_rejections_person ON face_rejections(person_id);
      UPDATE faces SET person_id = NULL WHERE person_id IN (SELECT id FROM people WHERE name IS NULL);
      DELETE FROM people WHERE name IS NULL;
      UPDATE faces SET source = 'ref' WHERE person_id IS NOT NULL;
      DROP TABLE face_overrides;
    `)
  },
  // 10: the photographer's private notes. Only on this computer: never pushed, never in the gallery.
  (database) => {
    database.exec(`
      CREATE TABLE image_notes (
        image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        updated_at INTEGER
      );
      ALTER TABLE albums ADD COLUMN private_note TEXT;
    `)
  },
  // 11: gallery search vectors. Differs from the album's current LSV1 file hash = needs upload.
  (database) => {
    database.exec('ALTER TABLE albums ADD COLUMN vectors_hash TEXT')
  },
  // 12: server ids in the uploaded vectors file; the gallery ignores ids no longer in the album
  (database) => {
    database.exec('ALTER TABLE albums ADD COLUMN vectors_ids TEXT')
  },
  // 13: photos the photographer marked done (their note or the client's is handled). Local only.
  (database) => {
    database.exec(`
      CREATE TABLE image_done (
        image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
        done_at INTEGER NOT NULL
      );
    `)
  }
]

/** `upTo` is for tests that need data at an older schema. */
export function runMigrations(database: Database.Database, upTo = migrations.length): void {
  const current = database.pragma('user_version', { simple: true }) as number
  for (let version = current + 1; version <= upTo; version++) {
    try {
      database.transaction(() => {
        migrations[version - 1](database)
        database.pragma(`user_version = ${version}`)
      })()
      logger.info(`Applied migration ${version}`)
    } catch (error) {
      // A half-migrated schema is worse than a surfaced failure
      logger.error(`Migration ${version} failed:`, getErrorMessage(error), error)
      throw error
    }
  }
}

function createTables(): void {
  if (!db) throw new Error('Database not initialized')

  // Albums table
  db.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      eventDate TEXT,
      startTime TEXT,
      endTime TEXT,
      localFolderPath TEXT NOT NULL,
      sourceFolderPath TEXT NOT NULL,
      albumType TEXT DEFAULT 'watch_folder',
      totalImages INTEGER DEFAULT 0,
      lastSyncedAt TEXT,
      needsSync INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
    )
  `)

  // Images table
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      albumId TEXT NOT NULL,
      serverId INTEGER,
      originalFilename TEXT NOT NULL,
      localFilePath TEXT NOT NULL,
      fileSize INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      mtime TEXT NOT NULL,
      sourceFileHash TEXT,
      uploadStatus TEXT NOT NULL,
      uploadOrder INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (albumId) REFERENCES albums(id) ON DELETE CASCADE
    )
  `)
}

function createIndexes(): void {
  if (!db) throw new Error('Database not initialized')

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_images_albumId ON images(albumId);
    CREATE INDEX IF NOT EXISTS idx_images_uploadStatus ON images(uploadStatus);
    CREATE INDEX IF NOT EXISTS idx_images_serverId ON images(serverId);
    CREATE INDEX IF NOT EXISTS idx_images_hash ON images(sourceFileHash);
  `)
}

/**
 * Execute multiple operations in a transaction for better performance
 * Automatically commits on success, rolls back on error
 */
export function runInTransaction<T>(fn: () => T): T {
  if (!db) throw new Error('Database not initialized')

  const transaction = db.transaction(() => {
    return fn()
  })

  return transaction()
}

/**
 * Bulk create images in a single transaction for performance
 * Much faster than creating images one by one
 */
export function createImagesBatch(images: Array<Omit<Image, 'id' | 'createdAt'>>): Image[] {
  if (!db) throw new Error('Database not initialized')

  const createdAt = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO images (albumId, serverId, originalFilename, localFilePath, fileSize, width, height, mtime, sourceFileHash, uploadStatus, uploadOrder, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction((imgs: Array<Omit<Image, 'id' | 'createdAt'>>) => {
    const results: Image[] = []
    for (const image of imgs) {
      const result = stmt.run(
        image.albumId,
        image.serverId,
        image.originalFilename,
        image.localFilePath,
        image.fileSize,
        image.width,
        image.height,
        image.mtime,
        image.sourceFileHash,
        image.uploadStatus,
        image.uploadOrder,
        createdAt
      )
      results.push({
        ...image,
        id: result.lastInsertRowid as number,
        createdAt
      })
    }
    return results
  })

  return insertMany(images)
}

/**
 * Bulk update images in a single transaction
 */
export function updateImagesBatch(updates: Array<{ id: number; changes: Partial<Image> }>): void {
  if (!db) throw new Error('Database not initialized')

  const updateMany = db.transaction((items: typeof updates) => {
    for (const { id, changes } of items) {
      const fields = Object.keys(changes)
        .map((key) => `${key} = ?`)
        .join(', ')
      const values = Object.values(changes)

      const stmt = db!.prepare(`UPDATE images SET ${fields} WHERE id = ?`)
      stmt.run(...values, id)
    }
  })

  updateMany(updates)
}

// Album CRUD operations
export function createAlbum(album: Omit<Album, 'createdAt'>): Album {
  if (!db) throw new Error('Database not initialized')

  const createdAt = new Date().toISOString()
  const fullAlbum = { ...album, createdAt }

  const stmt = db.prepare(`
    INSERT INTO albums (id, title, eventDate, startTime, endTime, localFolderPath, sourceFolderPath, albumType, totalImages, lastSyncedAt, needsSync, createdAt, event_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    fullAlbum.id,
    fullAlbum.title,
    fullAlbum.eventDate,
    fullAlbum.startTime,
    fullAlbum.endTime,
    fullAlbum.localFolderPath,
    fullAlbum.sourceFolderPath,
    fullAlbum.albumType,
    fullAlbum.totalImages,
    fullAlbum.lastSyncedAt,
    fullAlbum.needsSync,
    fullAlbum.createdAt,
    fullAlbum.event_type ?? null
  )

  return fullAlbum
}

export function getAlbum(id: string): Album | null {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('SELECT * FROM albums WHERE id = ?')
  return stmt.get(id) as Album | null
}

export function getAllAlbums(): Album[] {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('SELECT * FROM albums ORDER BY createdAt DESC')
  return stmt.all() as Album[]
}

export function getAlbumImageCounts(): Record<string, number> {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('SELECT albumId, COUNT(*) as count FROM images GROUP BY albumId')
  const results = stmt.all() as { albumId: string; count: number }[]

  const counts: Record<string, number> = {}
  results.forEach((row) => {
    counts[row.albumId] = row.count
  })

  return counts
}

export function getAlbumBySourcePath(sourceFolderPath: string): Album | null {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('SELECT * FROM albums WHERE sourceFolderPath = ?')
  return stmt.get(sourceFolderPath) as Album | null
}

export function updateAlbum(id: string, updates: Partial<Album>): void {
  if (!db) throw new Error('Database not initialized')

  const fields = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(', ')
  const values = Object.values(updates)

  const stmt = db.prepare(`UPDATE albums SET ${fields} WHERE id = ?`)
  stmt.run(...values, id)
}

export function deleteAlbum(id: string): void {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('DELETE FROM albums WHERE id = ?')
  stmt.run(id)
}

// Image CRUD operations
export function createImage(image: Omit<Image, 'id' | 'createdAt'>): Image {
  if (!db) throw new Error('Database not initialized')

  const createdAt = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO images (albumId, serverId, originalFilename, localFilePath, fileSize, width, height, mtime, sourceFileHash, uploadStatus, uploadOrder, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    image.albumId,
    image.serverId,
    image.originalFilename,
    image.localFilePath,
    image.fileSize,
    image.width,
    image.height,
    image.mtime,
    image.sourceFileHash,
    image.uploadStatus,
    image.uploadOrder,
    createdAt
  )

  return {
    ...image,
    id: result.lastInsertRowid as number,
    createdAt
  }
}

export function getAlbumImages(albumId: string): Image[] {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('SELECT * FROM images WHERE albumId = ? ORDER BY uploadOrder')
  return stmt.all(albumId) as Image[]
}

export function getImage(id: number): Image | null {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('SELECT * FROM images WHERE id = ?')
  return stmt.get(id) as Image | null
}

export function updateImage(id: number, updates: Partial<Image>): void {
  if (!db) throw new Error('Database not initialized')

  const fields = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(', ')
  const values = Object.values(updates)

  const stmt = db.prepare(`UPDATE images SET ${fields} WHERE id = ?`)
  stmt.run(...values, id)
}

export function deleteImage(id: number): void {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('DELETE FROM images WHERE id = ?')
  stmt.run(id)
}

export function deleteImages(ids: number[]): void {
  if (!db) throw new Error('Database not initialized')

  const placeholders = ids.map(() => '?').join(',')
  const stmt = db.prepare(`DELETE FROM images WHERE id IN (${placeholders})`)
  stmt.run(...ids)
}

export function getImagesByStatus(albumId: string, status: Image['uploadStatus']): Image[] {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('SELECT * FROM images WHERE albumId = ? AND uploadStatus = ?')
  return stmt.all(albumId, status) as Image[]
}

export function getImageByFilename(albumId: string, filename: string): Image | null {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('SELECT * FROM images WHERE albumId = ? AND originalFilename = ?')
  return stmt.get(albumId, filename) as Image | null
}

export function getImageByHash(albumId: string, hash: string): Image | null {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare('SELECT * FROM images WHERE albumId = ? AND sourceFileHash = ?')
  return stmt.get(albumId, hash) as Image | null
}

export function getImageStats(albumId: string): {
  total: number
  pending: number
  compressing: number
  uploading: number
  complete: number
  failed: number
  failed_compression: number
  failed_upload: number
} {
  if (!db) throw new Error('Database not initialized')

  const stmt = db.prepare(`
    SELECT 
      uploadStatus,
      COUNT(*) as count
    FROM images 
    WHERE albumId = ?
    GROUP BY uploadStatus
  `)

  const results = stmt.all(albumId) as { uploadStatus: string; count: number }[]

  const stats = {
    total: 0,
    pending: 0,
    compressing: 0,
    uploading: 0,
    complete: 0,
    failed: 0,
    failed_compression: 0,
    failed_upload: 0
  }

  results.forEach((row) => {
    stats[row.uploadStatus] = row.count
    stats.total += row.count
  })

  return stats
}

// Sets. Every mutation bumps albums.sets_need_push in the same transaction.

function conn(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

function setAlbumId(setId: string): string {
  const row = conn().prepare('SELECT album_id FROM album_sets WHERE id = ?').get(setId) as
    | { album_id: string }
    | undefined
  if (!row) throw new Error('Set not found')
  return row.album_id
}

function mutateSets(albumId: string, fn: (d: Database.Database, now: string) => void): void {
  const d = conn()
  d.transaction(() => {
    fn(d, new Date().toISOString())
    d.prepare(
      'UPDATE albums SET sets_need_push = COALESCE(sets_need_push, 0) + 1 WHERE id = ?'
    ).run(albumId)
  })()
}

export function listSets(albumId: string): AlbumSet[] {
  const d = conn()
  const sets = d
    .prepare(
      'SELECT id, album_id, name, position, cover_image_id FROM album_sets WHERE album_id = ? ORDER BY position, created_at'
    )
    .all(albumId) as Array<{
    id: string
    album_id: string
    name: string
    position: number
    cover_image_id: number | null
  }>
  const members = d
    .prepare(
      `SELECT si.set_id, si.image_id FROM set_images si JOIN album_sets s ON s.id = si.set_id
       WHERE s.album_id = ? ORDER BY si.position, si.rowid`
    )
    .all(albumId) as Array<{ set_id: string; image_id: number }>
  const byId = new Map<string, number[]>(sets.map((s) => [s.id, []]))
  for (const m of members) byId.get(m.set_id)!.push(m.image_id)
  return sets.map((s) => ({
    id: s.id,
    albumId: s.album_id,
    name: s.name,
    position: s.position,
    coverImageId: s.cover_image_id,
    imageIds: byId.get(s.id)!
  }))
}

// Only images from the set's own album are added; duplicates are ignored
function insertMembers(
  d: Database.Database,
  setId: string,
  albumId: string,
  imageIds: number[]
): void {
  const stmt = d.prepare(
    'INSERT OR IGNORE INTO set_images (set_id, image_id) SELECT ?, id FROM images WHERE id = ? AND albumId = ?'
  )
  for (const id of imageIds) stmt.run(setId, id, albumId)
}

export function createSet(albumId: string, name: string, imageIds: number[] = []): string {
  const id = randomUUID()
  mutateSets(albumId, (d, now) => {
    const { next } = d
      .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM album_sets WHERE album_id = ?')
      .get(albumId) as { next: number }
    d.prepare(
      'INSERT INTO album_sets (id, album_id, name, position, cover_image_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)'
    ).run(id, albumId, name, next, now, now)
    insertMembers(d, id, albumId, imageIds)
  })
  return id
}

export function createSetFromMoment(albumId: string, momentId: string, name: string): string {
  const ids = (
    conn()
      .prepare(
        'SELECT id FROM images WHERE albumId = ? AND moment_id = ? ORDER BY captured_at, uploadOrder'
      )
      .all(albumId, momentId) as Array<{ id: number }>
  ).map((r) => r.id)
  return createSet(albumId, name, ids)
}

export function renameSet(setId: string, name: string): string {
  const albumId = setAlbumId(setId)
  mutateSets(albumId, (d, now) =>
    d.prepare('UPDATE album_sets SET name = ?, updated_at = ? WHERE id = ?').run(name, now, setId)
  )
  return albumId
}

export function deleteSet(setId: string): string {
  const albumId = setAlbumId(setId)
  mutateSets(albumId, (d) => d.prepare('DELETE FROM album_sets WHERE id = ?').run(setId))
  return albumId
}

/** Ids missing from orderedIds keep their relative order after the listed ones. */
export function reorderSets(albumId: string, orderedIds: string[]): void {
  const current = listSets(albumId).map((s) => s.id)
  const order = [
    ...orderedIds.filter((id) => current.includes(id)),
    ...current.filter((id) => !orderedIds.includes(id))
  ]
  mutateSets(albumId, (d, now) => {
    const stmt = d.prepare(
      'UPDATE album_sets SET position = ?, updated_at = ? WHERE id = ? AND album_id = ?'
    )
    order.forEach((id, i) => stmt.run(i, now, id, albumId))
  })
}

export function addImagesToSet(setId: string, imageIds: number[]): string {
  const albumId = setAlbumId(setId)
  mutateSets(albumId, (d, now) => {
    insertMembers(d, setId, albumId, imageIds)
    d.prepare('UPDATE album_sets SET updated_at = ? WHERE id = ?').run(now, setId)
  })
  return albumId
}

export function removeImagesFromSet(setId: string, imageIds: number[]): string {
  const albumId = setAlbumId(setId)
  mutateSets(albumId, (d, now) => {
    const stmt = d.prepare('DELETE FROM set_images WHERE set_id = ? AND image_id = ?')
    for (const id of imageIds) stmt.run(setId, id)
    // A cover that left the set stops being the cover
    d.prepare(
      `UPDATE album_sets SET updated_at = ?, cover_image_id = CASE WHEN cover_image_id IN
       (SELECT image_id FROM set_images WHERE set_id = ?) THEN cover_image_id END WHERE id = ?`
    ).run(now, setId, setId)
  })
  return albumId
}

/** imageId must be in the set (or null to clear). */
export function setSetCover(setId: string, imageId: number | null): string {
  const albumId = setAlbumId(setId)
  if (imageId != null) {
    const member = conn()
      .prepare('SELECT 1 FROM set_images WHERE set_id = ? AND image_id = ?')
      .get(setId, imageId)
    if (!member) throw new Error('Cover must be a photo in the set')
  }
  mutateSets(albumId, (d, now) =>
    d
      .prepare('UPDATE album_sets SET cover_image_id = ?, updated_at = ? WHERE id = ?')
      .run(imageId, now, setId)
  )
  return albumId
}

/** Clears the dirty counter only if no mutation landed since `seen` was read. */
export function clearSetsNeedPush(albumId: string, seen: number): void {
  conn()
    .prepare('UPDATE albums SET sets_need_push = 0 WHERE id = ? AND sets_need_push = ?')
    .run(albumId, seen)
}

// AI tags

/** Images in the album with no embedding from `model` yet. */
export function getImagesMissingEmbedding(albumId: string, model: string): Image[] {
  return conn()
    .prepare(
      `SELECT i.* FROM images i LEFT JOIN image_embeddings e ON e.image_id = i.id AND e.model = ?
       WHERE i.albumId = ? AND e.image_id IS NULL ORDER BY i.uploadOrder`
    )
    .all(model, albumId) as Image[]
}

/** Album's effective tags (manual adds, then AI tags not removed) per image id. Untagged are absent. */
export function getAlbumTags(albumId: string): Map<number, string[]> {
  const d = conn()
  const ai = d
    .prepare(
      `SELECT t.image_id, t.tag FROM image_tags t JOIN images i ON i.id = t.image_id
       WHERE i.albumId = ? ORDER BY t.image_id, t.score DESC`
    )
    .all(albumId) as Array<{ image_id: number; tag: string }>
  const ov = d
    .prepare(
      `SELECT o.image_id, o.tag, o.action FROM image_tag_overrides o
       JOIN images i ON i.id = o.image_id WHERE i.albumId = ? ORDER BY o.rowid`
    )
    .all(albumId) as Array<{ image_id: number; tag: string; action: 'add' | 'remove' }>
  const aiBy = new Map<number, string[]>()
  for (const r of ai) aiBy.set(r.image_id, [...(aiBy.get(r.image_id) ?? []), r.tag])
  const ovBy = new Map<number, typeof ov>()
  for (const r of ov) ovBy.set(r.image_id, [...(ovBy.get(r.image_id) ?? []), r])
  const out = new Map<number, string[]>()
  for (const id of new Set([...aiBy.keys(), ...ovBy.keys()])) {
    const tags = effectiveTags(aiBy.get(id) ?? [], ovBy.get(id) ?? [])
    if (tags.length > 0) out.set(id, tags)
  }
  return out
}

/** Album's image ids that have an embedding (so their tags are known, possibly empty). */
export function getEmbeddedImageIds(albumId: string): Set<number> {
  const rows = conn()
    .prepare(
      'SELECT e.image_id FROM image_embeddings e JOIN images i ON i.id = e.image_id WHERE i.albumId = ?'
    )
    .all(albumId) as Array<{ image_id: number }>
  return new Set(rows.map((r) => r.image_id))
}

/** Album's stored embeddings from `model`, by image id. */
/**
 * Cheap fingerprint of an album's shippable embeddings (which photos, their server ids, which
 * embedding rows): lets the vectors push skip decoding + encoding when nothing changed.
 */
export function getAlbumEmbeddingsSignature(albumId: string, model: string): string {
  const r = conn()
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(i.serverId), 0) AS s, COALESCE(SUM(e.rowid), 0) AS r
       FROM image_embeddings e JOIN images i ON i.id = e.image_id
       WHERE i.albumId = ? AND e.model = ? AND i.serverId IS NOT NULL`
    )
    .get(albumId, model) as { n: number; s: number; r: number }
  return `${r.n}:${r.s}:${r.r}`
}

/** Server ids of photos with an embedding for `model` (no vector decoding). */
export function getAlbumEmbeddedServerIds(albumId: string, model: string): number[] {
  return (
    conn()
      .prepare(
        `SELECT i.serverId AS id FROM image_embeddings e JOIN images i ON i.id = e.image_id
         WHERE i.albumId = ? AND e.model = ? AND i.serverId IS NOT NULL`
      )
      .all(albumId, model) as Array<{ id: number }>
  ).map((r) => r.id)
}

export function getAlbumEmbeddings(
  albumId: string,
  model: string
): Array<{ imageId: number; vec: Float32Array }> {
  const rows = conn()
    .prepare(
      `SELECT e.image_id, e.vec FROM image_embeddings e JOIN images i ON i.id = e.image_id
       WHERE i.albumId = ? AND e.model = ? ORDER BY e.image_id`
    )
    .all(albumId, model) as Array<{ image_id: number; vec: Buffer }>
  return rows.map((r) => ({
    imageId: r.image_id,
    vec: new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.length))
  }))
}

/**
 * Store embeddings. A first embedding marks tags_need_push, so the server learns
 * "analyzed" even if the photo ends up with no tags. Returns how many were stored.
 */
export function saveImageEmbeddings(
  model: string,
  items: Array<{ imageId: number; vec: Float32Array }>
): number {
  const d = conn()
  const putVec = d.prepare(
    'INSERT OR REPLACE INTO image_embeddings (image_id, model, vec) VALUES (?, ?, ?)'
  )
  const exists = d.prepare('SELECT 1 FROM images WHERE id = ?')
  const hadVec = d.prepare('SELECT 1 FROM image_embeddings WHERE image_id = ?')
  const dirty = d.prepare('UPDATE images SET tags_need_push = 1 WHERE id = ?')
  let saved = 0
  d.transaction(() => {
    for (const { imageId, vec } of items) {
      if (!exists.get(imageId)) continue // deleted meanwhile
      if (!hadVec.get(imageId)) dirty.run(imageId)
      putVec.run(imageId, model, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength))
      saved++
    }
  })()
  return saved
}

/**
 * Replace AI tags in one transaction. Marks tags_need_push only where the tag list actually
 * changed. Returns how many images' tags changed.
 */
export function saveImageTags(
  items: Array<{ imageId: number; tags: Array<{ tag: string; score: number }> }>
): number {
  const d = conn()
  const oldTags = d.prepare('SELECT tag FROM image_tags WHERE image_id = ? ORDER BY score DESC')
  const clear = d.prepare('DELETE FROM image_tags WHERE image_id = ?')
  const put = d.prepare('INSERT INTO image_tags (image_id, tag, score) VALUES (?, ?, ?)')
  const dirty = d.prepare('UPDATE images SET tags_need_push = 1 WHERE id = ?')
  const exists = d.prepare('SELECT 1 FROM images WHERE id = ?')
  let changed = 0
  d.transaction(() => {
    for (const { imageId, tags } of items) {
      if (!exists.get(imageId)) continue // deleted meanwhile
      const before = (oldTags.all(imageId) as Array<{ tag: string }>).map((r) => r.tag).join()
      clear.run(imageId)
      for (const t of tags) put.run(imageId, t.tag, t.score)
      if (before !== tags.map((t) => t.tag).join()) {
        dirty.run(imageId)
        changed++
      }
    }
  })()
  return changed
}

export function setAlbumTagsScored(albumId: string, key: string): void {
  conn().prepare('UPDATE albums SET tags_scored = ? WHERE id = ?').run(key, albumId)
}

/** Enabled AI tag slugs for an album; null = the whole vocabulary. */
export function getAlbumTagSet(albumId: string): string[] | null {
  const row = conn().prepare('SELECT tag_set FROM albums WHERE id = ?').get(albumId) as
    | { tag_set: string | null }
    | undefined
  return row?.tag_set ? (JSON.parse(row.tag_set) as string[]) : null
}

export function setAlbumTagSet(albumId: string, enabled: string[] | null): void {
  conn()
    .prepare('UPDATE albums SET tag_set = ? WHERE id = ?')
    .run(enabled ? JSON.stringify(enabled) : null, albumId)
}

/** Change an album's event type; its tag set goes back to the new type's pack. */
export function setAlbumEventType(albumId: string, eventType: string): void {
  conn()
    .prepare('UPDATE albums SET event_type = ?, tag_set = NULL WHERE id = ?')
    .run(eventType, albumId)
}

/**
 * Manual add/remove of a tag on photos of an album. One row per (image, tag), so an add
 * replaces a remove and vice versa. Marks the photos for push.
 */
export function setTagOverride(
  albumId: string,
  imageIds: number[],
  tag: string,
  action: 'add' | 'remove'
): void {
  const d = conn()
  const put = d.prepare(
    `INSERT OR REPLACE INTO image_tag_overrides (image_id, tag, action)
     SELECT id, ?, ? FROM images WHERE id = ? AND albumId = ?`
  )
  const dirty = d.prepare('UPDATE images SET tags_need_push = 1 WHERE id = ? AND albumId = ?')
  d.transaction(() => {
    for (const id of imageIds) {
      put.run(tag, action, id, albumId)
      dirty.run(id, albumId)
    }
  })()
}

// People. Every change that the server should see bumps albums.people_need_push.

type Box = [number, number, number, number]

export interface FaceRow {
  id: number
  imageId: number
  box: Box
  score: number
  landmarks: number[]
  personId: string | null
  source: 'ref' | 'auto' | null
}

export interface PersonRow {
  id: string
  name: string
  hidden: boolean
  coverFaceId: number | null
  faces: FaceRow[]
}

const bumpPeople = (d: Database.Database, albumId: string): void => {
  d.prepare(
    'UPDATE albums SET people_need_push = COALESCE(people_need_push, 0) + 1 WHERE id = ?'
  ).run(albumId)
}

const toVec = (b: Buffer): Float32Array =>
  new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))

export function getPeopleProgress(albumId: string): {
  enabled: boolean
  processed: number
  total: number
} {
  const d = conn()
  const album = d.prepare('SELECT people_enabled FROM albums WHERE id = ?').get(albumId) as
    | { people_enabled: number | null }
    | undefined
  const counts = d
    .prepare(
      'SELECT COUNT(*) AS total, COALESCE(SUM(faces_scanned), 0) AS processed FROM images WHERE albumId = ?'
    )
    .get(albumId) as { total: number; processed: number }
  return { enabled: album?.people_enabled === 1, ...counts }
}

/** Turning People off deletes every face, person and client link of the album. */
export function setPeopleEnabled(albumId: string, enabled: boolean): void {
  const d = conn()
  d.transaction(() => {
    if (!enabled) {
      d.prepare(
        'DELETE FROM faces WHERE image_id IN (SELECT id FROM images WHERE albumId = ?)'
      ).run(albumId)
      d.prepare('DELETE FROM client_people WHERE album_id = ?').run(albumId)
      d.prepare('DELETE FROM people WHERE album_id = ?').run(albumId)
      d.prepare('UPDATE images SET faces_scanned = 0 WHERE albumId = ?').run(albumId)
    }
    d.prepare('UPDATE albums SET people_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, albumId)
    bumpPeople(d, albumId)
  })()
}

export function getImagesToScanForFaces(albumId: string): Image[] {
  return conn()
    .prepare(
      'SELECT * FROM images WHERE albumId = ? AND COALESCE(faces_scanned, 0) = 0 ORDER BY uploadOrder'
    )
    .all(albumId) as Image[]
}

/**
 * Store one photo's detected faces and mark it scanned. Skipped (returns false) when the photo
 * was deleted or People was turned off meanwhile. A re-scan replaces the photo's faces.
 */
export function saveImageFaces(
  imageId: number,
  faces: Array<{ box: Box; score: number; landmarks: number[]; vec: Float32Array }>
): boolean {
  const d = conn()
  return d.transaction(() => {
    const ok = d
      .prepare(
        'SELECT 1 FROM images i JOIN albums a ON a.id = i.albumId WHERE i.id = ? AND a.people_enabled = 1'
      )
      .get(imageId)
    if (!ok) return false
    d.prepare('DELETE FROM faces WHERE image_id = ?').run(imageId)
    const put = d.prepare(
      'INSERT INTO faces (image_id, box, score, landmarks, vec) VALUES (?, ?, ?, ?, ?)'
    )
    for (const f of faces) {
      put.run(
        imageId,
        JSON.stringify(f.box),
        f.score,
        JSON.stringify(f.landmarks),
        Buffer.from(f.vec.buffer, f.vec.byteOffset, f.vec.byteLength)
      )
    }
    d.prepare('UPDATE images SET faces_scanned = 1 WHERE id = ?').run(imageId)
    return true
  })()
}

/**
 * Re-match every non-reference face of the album to the people's references (people-match.ts):
 * stores auto assignments, returns the review queues. People left without a reference are
 * removed first. Bumps the push counter if anything the server sees changed.
 */
export function rematchPeople(albumId: string): {
  changed: number
  review: Map<string, Array<{ faceId: number; score: number }>>
} {
  const d = conn()
  return d.transaction(() => {
    if (!getPeopleProgress(albumId).enabled) return { changed: 0, review: new Map() }
    let changed = d
      .prepare(
        `DELETE FROM people WHERE album_id = ? AND NOT EXISTS
         (SELECT 1 FROM faces f WHERE f.person_id = people.id AND f.source = 'ref')`
      )
      .run(albumId).changes
    const rows = d
      .prepare(
        `SELECT f.id, f.vec, f.person_id, f.source FROM faces f JOIN images i ON i.id = f.image_id
         WHERE i.albumId = ?`
      )
      .all(albumId) as Array<{
      id: number
      vec: Buffer
      person_id: string | null
      source: string | null
    }>
    const rejected = new Set(
      (
        d
          .prepare(
            `SELECT r.face_id, r.person_id FROM face_rejections r
             JOIN people p ON p.id = r.person_id WHERE p.album_id = ?`
          )
          .all(albumId) as Array<{ face_id: number; person_id: string }>
      ).map((r) => `${r.face_id}:${r.person_id}`)
    )
    const { auto, review } = classify(
      bestMatches(
        rows.map((r) => ({
          id: r.id,
          vec: toVec(r.vec),
          ref: r.source === 'ref' ? r.person_id : null
        })),
        rejected
      )
    )
    const set = d.prepare('UPDATE faces SET person_id = ?, source = ? WHERE id = ?')
    for (const r of rows) {
      if (r.source === 'ref') continue
      const p = auto.get(r.id) ?? null
      if (p !== r.person_id || (p == null) !== (r.source == null)) {
        set.run(p, p && 'auto', r.id)
        changed++
      }
    }
    d.prepare(
      `UPDATE people SET cover_face_id = NULL WHERE album_id = ? AND cover_face_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM faces f WHERE f.id = cover_face_id AND f.person_id = people.id)`
    ).run(albumId)
    if (changed > 0) bumpPeople(d, albumId)
    return { changed, review }
  })()
}

const parseFace = (r: {
  id: number
  image_id: number
  box: string
  score: number
  landmarks: string
  person_id: string | null
  source: string | null
}): FaceRow => ({
  id: r.id,
  imageId: r.image_id,
  box: JSON.parse(r.box),
  score: r.score,
  landmarks: JSON.parse(r.landmarks),
  personId: r.person_id,
  source: r.source as FaceRow['source']
})

/** The album's people with their reference + auto faces. Hidden people are included (flagged). */
export function getAlbumPeople(albumId: string): PersonRow[] {
  const d = conn()
  const people = d
    .prepare('SELECT id, name, hidden, cover_face_id FROM people WHERE album_id = ?')
    .all(albumId) as Array<{
    id: string
    name: string
    hidden: number
    cover_face_id: number | null
  }>
  const faces = (
    d
      .prepare(
        `SELECT f.id, f.image_id, f.box, f.score, f.landmarks, f.person_id, f.source FROM faces f
         JOIN people p ON p.id = f.person_id WHERE p.album_id = ? ORDER BY f.id`
      )
      .all(albumId) as Array<Parameters<typeof parseFace>[0]>
  ).map(parseFace)
  const byPerson = new Map<string, FaceRow[]>()
  for (const f of faces) {
    const list = byPerson.get(f.personId!)
    if (list) list.push(f)
    else byPerson.set(f.personId!, [f])
  }
  return people
    .map((p) => ({
      id: p.id,
      name: p.name,
      hidden: p.hidden === 1,
      coverFaceId: p.cover_face_id,
      faces: byPerson.get(p.id) ?? []
    }))
    .filter((p) => p.faces.length > 0)
}

/** Every face of the album (no vectors). */
export function getAlbumFaces(albumId: string): FaceRow[] {
  return (
    conn()
      .prepare(
        `SELECT f.id, f.image_id, f.box, f.score, f.landmarks, f.person_id, f.source
         FROM faces f JOIN images i ON i.id = f.image_id WHERE i.albumId = ? ORDER BY f.id`
      )
      .all(albumId) as Array<Parameters<typeof parseFace>[0]>
  ).map(parseFace)
}

export function getImageFaces(
  albumId: string,
  imageId: number
): Array<FaceRow & { name: string | null }> {
  return (
    conn()
      .prepare(
        `SELECT f.id, f.image_id, f.box, f.score, f.landmarks, f.person_id, f.source, p.name
         FROM faces f JOIN images i ON i.id = f.image_id LEFT JOIN people p ON p.id = f.person_id
         WHERE i.albumId = ? AND f.image_id = ? ORDER BY f.id`
      )
      .all(albumId, imageId) as Array<Parameters<typeof parseFace>[0] & { name: string | null }>
  ).map((r) => ({ ...parseFace(r), name: r.name }))
}

export function hasPerson(albumId: string, personId: string): boolean {
  return !!conn()
    .prepare('SELECT 1 FROM people WHERE id = ? AND album_id = ?')
    .get(personId, albumId)
}

function personInAlbum(d: Database.Database, albumId: string, personId: string): void {
  if (!d.prepare('SELECT 1 FROM people WHERE id = ? AND album_id = ?').get(personId, albumId))
    throw new Error('Person not found')
}

function mutatePeople(albumId: string, fn: (d: Database.Database) => void): void {
  const d = conn()
  d.transaction(() => {
    fn(d)
    bumpPeople(d, albumId)
  })()
}

export function renamePerson(albumId: string, personId: string, name: string): void {
  mutatePeople(albumId, (d) => {
    personInAlbum(d, albumId, personId)
    d.prepare('UPDATE people SET name = ? WHERE id = ?').run(name, personId)
  })
}

export function setPersonHidden(albumId: string, personId: string, hidden: boolean): void {
  mutatePeople(albumId, (d) => {
    personInAlbum(d, albumId, personId)
    d.prepare('UPDATE people SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, personId)
  })
}

/** faceId must currently belong to the person. */
export function setPersonCover(albumId: string, personId: string, faceId: number): void {
  mutatePeople(albumId, (d) => {
    personInAlbum(d, albumId, personId)
    if (!d.prepare('SELECT 1 FROM faces WHERE id = ? AND person_id = ?').get(faceId, personId))
      throw new Error("Cover must be one of this person's faces")
    d.prepare('UPDATE people SET cover_face_id = ? WHERE id = ?').run(faceId, personId)
  })
}

/**
 * Merge people into `intoId`: their references, auto faces, rejections and client links move
 * to it; a face that ends up a reference of `intoId` is no longer rejected for it.
 */
export function mergePeople(albumId: string, intoId: string, fromIds: string[]): void {
  mutatePeople(albumId, (d) => {
    personInAlbum(d, albumId, intoId)
    for (const from of fromIds.filter((id) => id !== intoId)) {
      personInAlbum(d, albumId, from)
      d.prepare('UPDATE faces SET person_id = ? WHERE person_id = ?').run(intoId, from)
      d.prepare(
        `INSERT OR IGNORE INTO face_rejections (face_id, person_id)
         SELECT face_id, ? FROM face_rejections WHERE person_id = ?`
      ).run(intoId, from)
      d.prepare('UPDATE client_people SET person_id = ? WHERE person_id = ? AND album_id = ?').run(
        intoId,
        from,
        albumId
      )
      d.prepare('DELETE FROM people WHERE id = ?').run(from)
    }
    d.prepare(
      `DELETE FROM face_rejections WHERE person_id = ? AND face_id IN
       (SELECT id FROM faces WHERE person_id = ? AND source = 'ref')`
    ).run(intoId, intoId)
  })
}

/** Deletes a person; its references become plain faces (and may match someone else). */
export function removePerson(albumId: string, personId: string): void {
  mutatePeople(albumId, (d) => {
    personInAlbum(d, albumId, personId)
    d.prepare('UPDATE faces SET person_id = NULL, source = NULL WHERE person_id = ?').run(personId)
    d.prepare('DELETE FROM people WHERE id = ?').run(personId)
  })
}

function faceInAlbum(d: Database.Database, albumId: string, faceId: number): FaceRow['personId'] {
  const face = d
    .prepare(
      'SELECT f.person_id FROM faces f JOIN images i ON i.id = f.image_id WHERE f.id = ? AND i.albumId = ?'
    )
    .get(faceId, albumId) as { person_id: string | null } | undefined
  if (!face) throw new Error('Face not found')
  return face.person_id
}

function makeReference(d: Database.Database, faceId: number, personId: string): void {
  d.prepare("UPDATE faces SET person_id = ?, source = 'ref' WHERE id = ?").run(personId, faceId)
  d.prepare('DELETE FROM face_rejections WHERE face_id = ? AND person_id = ?').run(faceId, personId)
}

function rejectFace(d: Database.Database, faceId: number, personId: string): void {
  d.prepare('INSERT OR IGNORE INTO face_rejections (face_id, person_id) VALUES (?, ?)').run(
    faceId,
    personId
  )
  d.prepare('UPDATE faces SET person_id = NULL, source = NULL WHERE id = ? AND person_id = ?').run(
    faceId,
    personId
  )
}

/**
 * The photographer says who a face is: a reference of a person, of a new or same-named
 * (case-insensitive) person, or `none` = not its current person (remembered, never re-matched).
 * Returns the person the face is a reference of afterwards. Re-match afterwards.
 */
export function assignFace(
  albumId: string,
  faceId: number,
  target: { personId: string } | { newName: string } | { none: true }
): string | null {
  let personId: string | null = null
  mutatePeople(albumId, (d) => {
    const current = faceInAlbum(d, albumId, faceId)
    if ('none' in target) {
      if (current) rejectFace(d, faceId, current)
      return
    }
    if ('personId' in target) {
      personInAlbum(d, albumId, target.personId)
      personId = target.personId
    } else {
      const same = d
        .prepare('SELECT id FROM people WHERE album_id = ? AND name = ? COLLATE NOCASE')
        .get(albumId, target.newName) as { id: string } | undefined
      personId = same?.id ?? randomUUID()
      if (!same)
        d.prepare('INSERT INTO people (id, album_id, name) VALUES (?, ?, ?)').run(
          personId,
          albumId,
          target.newName
        )
    }
    makeReference(d, faceId, personId)
  })
  return personId
}

/** Answers to "Is this X?": yes = a reference of X, no = never X. Re-match afterwards. */
export function reviewFaces(
  albumId: string,
  personId: string,
  decisions: Array<{ faceId: number; yes: boolean }>
): void {
  mutatePeople(albumId, (d) => {
    personInAlbum(d, albumId, personId)
    for (const { faceId, yes } of decisions) {
      faceInAlbum(d, albumId, faceId)
      if (yes) makeReference(d, faceId, personId)
      else rejectFace(d, faceId, personId)
    }
  })
}

export function setClientPerson(
  albumId: string,
  clientName: string,
  personId: string | null
): void {
  const d = conn()
  if (personId == null) {
    d.prepare('DELETE FROM client_people WHERE album_id = ? AND client_name = ?').run(
      albumId,
      clientName
    )
    return
  }
  personInAlbum(d, albumId, personId)
  d.prepare(
    'INSERT OR REPLACE INTO client_people (album_id, client_name, person_id) VALUES (?, ?, ?)'
  ).run(albumId, clientName, personId)
}

export function getClientPeople(albumId: string): Record<string, string> {
  const rows = conn()
    .prepare('SELECT client_name, person_id FROM client_people WHERE album_id = ?')
    .all(albumId) as Array<{ client_name: string; person_id: string }>
  return Object.fromEntries(rows.map((r) => [r.client_name, r.person_id]))
}

// Private notes: the photographer's own, kept on this computer only

/** Every note in the album, by local image id. */
export function getImageNotes(albumId: string): Record<number, string> {
  const rows = conn()
    .prepare(
      'SELECT n.image_id, n.body FROM image_notes n JOIN images i ON i.id = n.image_id WHERE i.albumId = ?'
    )
    .all(albumId) as Array<{ image_id: number; body: string }>
  return Object.fromEntries(rows.map((r) => [r.image_id, r.body]))
}

/** Saves a photo's note; an empty (or blank) body deletes it. The photo must be in the album. */
export function setImageNote(albumId: string, imageId: number, body: string): void {
  const d = conn()
  if (!d.prepare('SELECT 1 FROM images WHERE id = ? AND albumId = ?').get(imageId, albumId))
    throw new Error('Photo not found in this album')
  if (!body.trim()) {
    d.prepare('DELETE FROM image_notes WHERE image_id = ?').run(imageId)
    return
  }
  d.prepare(
    `INSERT INTO image_notes (image_id, body, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(image_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`
  ).run(imageId, body, Date.now())
}

export function getAlbumNote(albumId: string): string {
  const row = conn().prepare('SELECT private_note FROM albums WHERE id = ?').get(albumId) as
    | { private_note: string | null }
    | undefined
  return row?.private_note ?? ''
}

/** When each photo in the album was marked done, by local image id. */
export function getImageDone(albumId: string): Record<number, number> {
  const rows = conn()
    .prepare(
      'SELECT d.image_id, d.done_at FROM image_done d JOIN images i ON i.id = d.image_id WHERE i.albumId = ?'
    )
    .all(albumId) as Array<{ image_id: number; done_at: number }>
  return Object.fromEntries(rows.map((r) => [r.image_id, r.done_at]))
}

/** Marks photos done (now) or not done. Every photo must be in the album. Returns done_at. */
export function setImageDone(albumId: string, imageIds: number[], done: boolean): number {
  const d = conn()
  const at = Date.now()
  const inAlbum = d.prepare('SELECT 1 FROM images WHERE id = ? AND albumId = ?')
  const mark = d.prepare(
    'INSERT INTO image_done (image_id, done_at) VALUES (?, ?) ON CONFLICT(image_id) DO UPDATE SET done_at = excluded.done_at'
  )
  const clear = d.prepare('DELETE FROM image_done WHERE image_id = ?')
  d.transaction(() => {
    for (const id of imageIds) {
      if (!inAlbum.get(id, albumId)) throw new Error('Photo not found in this album')
      if (done) mark.run(id, at)
      else clear.run(id)
    }
  })()
  return at
}

export function setAlbumNote(albumId: string, body: string): void {
  const r = conn()
    .prepare('UPDATE albums SET private_note = ? WHERE id = ?')
    .run(body.trim() ? body : null, albumId)
  if (!r.changes) throw new Error('Album not found')
}

/** Clears the dirty counter only if no change landed since `seen` was read. */
export function clearPeopleNeedPush(albumId: string, seen: number): void {
  conn()
    .prepare('UPDATE albums SET people_need_push = 0 WHERE id = ? AND people_need_push = ?')
    .run(albumId, seen)
}

/** Photos changed under People (e.g. deleted): the server's people need a fresh push. */
export function markPeopleDirty(albumId: string): void {
  bumpPeople(conn(), albumId)
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'lumosnap.db')
}

export function deleteDatabase(): void {
  closeDatabase()
  const dbPath = getDatabasePath()
  if (existsSync(dbPath)) {
    unlinkSync(dbPath)
    console.log('[Database] Database file deleted:', dbPath)
  }
  // WAL sidecar files
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(sidecar)) unlinkSync(sidecar)
  }
}
