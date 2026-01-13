/**
 * Hash Utility Module
 *
 * Provides reusable file hashing functionality for:
 * - Sync detection (rename/duplicate detection)
 * - Compression (source file identification)
 *
 * Uses SHA-256 for consistent, cross-platform hashing.
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { readFileSync, createReadStream } from 'node:fs'

const HASH_ALGORITHM = 'sha256'

/**
 * Compute SHA-256 hash from a Buffer
 */
export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash(HASH_ALGORITHM).update(buffer).digest('hex')
}

/**
 * Compute SHA-256 hash from a file path (async, stream-based)
 * Optimized for large files and low memory usage
 */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(HASH_ALGORITHM)
    const stream = createReadStream(filePath)

    stream.on('error', (err) => reject(err))
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Compute SHA-256 hash from a file path (sync)
 * Use sparingly - prefer async version for better performance
 */
export function hashFileSync(filePath: string): string {
  const buffer = readFileSync(filePath)
  return hashBuffer(buffer)
}

/**
 * Read file and compute hash in one operation
 * Returns both buffer and hash to avoid re-reading the file
 */
export async function readFileWithHash(
  filePath: string
): Promise<{ buffer: Buffer; hash: string }> {
  const buffer = await fs.readFile(filePath)
  const hash = hashBuffer(buffer)
  return { buffer, hash }
}

/**
 * Sync version of readFileWithHash
 */
export function readFileWithHashSync(filePath: string): { buffer: Buffer; hash: string } {
  const buffer = readFileSync(filePath)
  const hash = hashBuffer(buffer)
  return { buffer, hash }
}
