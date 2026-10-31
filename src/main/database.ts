import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'
import { createLogger, getErrorMessage } from './logger'
import { effectiveTags } from './tags/select'

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
  }
]

export function runMigrations(database: Database.Database): void {
  const current = database.pragma('user_version', { simple: true }) as number
  for (let version = current + 1; version <= migrations.length; version++) {
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
    INSERT INTO albums (id, title, eventDate, startTime, endTime, localFolderPath, sourceFolderPath, albumType, totalImages, lastSyncedAt, needsSync, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    fullAlbum.createdAt
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
