import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { createLogger, getErrorMessage } from './logger'

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
  uploadStatus: 'pending' | 'compressing' | 'uploading' | 'complete' | 'failed' | 'failed_compression' | 'failed_upload'
  uploadOrder: number
  createdAt: string
}

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'lumosnap.db')
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
