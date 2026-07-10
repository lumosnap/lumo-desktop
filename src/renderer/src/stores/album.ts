interface AlbumImage {
  id: number
  albumId: string
  originalFilename: string
  localFilePath: string
  fileSize: number
  width?: number
  height?: number
  uploadStatus: string
  serverId?: number
  isFavorite?: boolean
  favoriteData?: unknown
}

export interface Album {
  id: string
  userId: number
  title: string
  eventDate: string | null
  startTime: string | null
  endTime: string | null
  totalImages: number
  totalSize: number
  shareLinkToken: string | null
  expiresAt: string | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
  needsSync?: number // 0 or 1 (SQLite boolean) - indicates if album needs sync with source folder
  isOrphaned?: number // 0 or 1 (SQLite boolean) - indicates if source folder was deleted
  albumType?: 'watch_folder' | 'standalone' // watch_folder = in master folder, standalone = custom path
  // For backward compatibility with frontend
  photoCount?: number
  coverPhoto?: string
  photos?: AlbumImage[]
  thumbnail?: string
  localFolderPath?: string
  sourceFolderPath?: string
}
