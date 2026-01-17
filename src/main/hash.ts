/**
 * Hash Utility Module
 *
 * Provides reusable file hashing functionality for:
 * - Sync detection (rename/duplicate detection)
 * - Compression (source file identification)
 *
 * Uses SHA-256 for consistent, cross-platform hashing.
 */

/**
 * Hash Utility Module
 *
 * Provides reusable file hashing functionality for:
 * - Sync detection (rename/duplicate detection)
 * - Compression (source file identification)
 *
 * Uses BLAKE3 (via hash-wasm) for fast, secure hashing.
 */

import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createBLAKE3 } from 'hash-wasm'

/**
 * Compute BLAKE3 hash from a Buffer
 */
export async function hashBuffer(buffer: Buffer): Promise<string> {
  const hasher = await createBLAKE3()
  hasher.init()
  hasher.update(buffer)
  return hasher.digest('hex')
}

/**
 * Compute BLAKE3 hash from a file path (async, stream-based)
 * Optimized for large files and low memory usage
 */
export async function hashFile(filePath: string): Promise<string> {
  const hasher = await createBLAKE3()
  hasher.init()

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)

    stream.on('error', (err) => reject(err))
    stream.on('data', (chunk) => {
      // hash-wasm expects Uint8Array or similar
      hasher.update(chunk as Buffer)
    })
    stream.on('end', () => resolve(hasher.digest('hex')))
  })
}

/**
 * Read file and compute hash in one operation
 * Returns both buffer and hash to avoid re-reading the file
 */
export async function readFileWithHash(
  filePath: string
): Promise<{ buffer: Buffer; hash: string }> {
  const buffer = await fs.readFile(filePath)
  const hash = await hashBuffer(buffer)
  return { buffer, hash }
}

