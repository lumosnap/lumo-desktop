import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

export interface Album {
  id: string
  title: string
  eventDate: string | null // ISO 8601 datetime string (legacy/primary date)
  startTime: string | null // ISO 8601 datetime string
  endTime: string | null // ISO 8601 datetime string
  localFolderPath: string
  sourceFolderPath: string
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
  uploadStatus: 'pending' | 'compressing' | 'uploading' | 'complete' | 'failed'
  uploadOrder: number
  createdAt: string
}

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'lumosnap.db')
  db = new Database(dbPath)

  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Create tables
  createTables()

  // Migration: Add serverId column if it doesn't exist
  try {
    const tableInfo = db.pragma('table_info(images)') as Array<{ name: string }>
    const hasServerId = tableInfo.some((col) => col.name === 'serverId')
    if (!hasServerId) {
      console.log('[Database] Adding serverId column to images table')
      db.exec('ALTER TABLE images ADD COLUMN serverId INTEGER')
    }
  } catch (error) {
    console.error('[Database] Migration failed:', error)
  }

  // Migration: Add startTime and endTime columns to albums table
  try {
    const tableInfo = db.pragma('table_info(albums)') as Array<{ name: string }>
    const hasStartTime = tableInfo.some((col) => col.name === 'startTime')
    const hasEndTime = tableInfo.some((col) => col.name === 'endTime')

    if (!hasStartTime) {
      console.log('[Database] Adding startTime column to albums table')
      db.exec('ALTER TABLE albums ADD COLUMN startTime TEXT')
    }
    if (!hasEndTime) {
      console.log('[Database] Adding endTime column to albums table')
      db.exec('ALTER TABLE albums ADD COLUMN endTime TEXT')
    }
  } catch (error) {
    console.error('[Database] Album migration failed:', error)
  }

  // Migration: Add isOrphaned column if it doesn't exist
  try {
    const albumInfo = db.pragma('table_info(albums)') as Array<{ name: string }>
    const hasIsOrphaned = albumInfo.some((col) => col.name === 'isOrphaned')
    if (!hasIsOrphaned) {
      console.log('[Database] Adding isOrphaned column to albums table')
      db.exec('ALTER TABLE albums ADD COLUMN isOrphaned INTEGER DEFAULT 0')
    }
  } catch (error) {
    console.error('[Database] isOrphaned migration failed:', error)
  }

  // Create indexes
  createIndexes()
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
  `)
}

// Album CRUD operations
export function createAlbum(album: Omit<Album, 'createdAt'>): Album {
  if (!db) throw new Error('Database not initialized')

  const createdAt = new Date().toISOString()
  const fullAlbum = { ...album, createdAt }

  const stmt = db.prepare(`
    INSERT INTO albums (id, title, eventDate, startTime, endTime, localFolderPath, sourceFolderPath, totalImages, lastSyncedAt, needsSync, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    fullAlbum.id,
    fullAlbum.title,
    fullAlbum.eventDate,
    fullAlbum.startTime,
    fullAlbum.endTime,
    fullAlbum.localFolderPath,
    fullAlbum.sourceFolderPath,
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

export function getImageStats(albumId: string): {
  total: number
  pending: number
  compressing: number
  uploading: number
  complete: number
  failed: number
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
    failed: 0
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
