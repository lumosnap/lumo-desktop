/**
 * Per-image browse signals (capture time, camera, rating, dHash, sharpness, ThumbHash).
 *
 * Shared by the compression worker (new uploads) and the backfill job (existing albums).
 * Both feed thumbnailSignals() the same input — the encoded 400px `.thumbnail` WebP —
 * so values are comparable regardless of which path produced them.
 */

import sharp from 'sharp'
import exifReader from 'exif-reader'

export interface ImageSignals {
  capturedAt: number | null // unix ms; EXIF wall-clock encoded as if UTC (see readExifSignals)
  cameraId: string | null
  rating: number | null
  phash: string | null // 64-bit dHash, 16 hex chars
  sharpness: number | null
  thumbhash: string | null // base64
}

/**
 * EXIF/XMP fields from sharp metadata (header only, no pixel decode).
 *
 * EXIF DateTimeOriginal has no timezone. We treat it as naive wall-clock and encode it
 * as if it were UTC (exif-reader already does this), consistently on every path, so
 * gaps between frames are exact and the renderer must display it with timeZone 'UTC'.
 */
export function readExifSignals(
  meta: Pick<sharp.Metadata, 'exif' | 'xmp'>
): Pick<ImageSignals, 'capturedAt' | 'cameraId' | 'rating'> {
  let capturedAt: number | null = null
  let cameraId: string | null = null
  let rating: number | null = null

  if (meta.exif) {
    try {
      const exif = exifReader(meta.exif)
      const date = exif.Photo?.DateTimeOriginal
      if (date instanceof Date && !isNaN(date.getTime())) {
        // SubSecTimeOriginal is the fractional-second digits, e.g. "45" = .45s
        const subSec = String(exif.Photo?.SubSecTimeOriginal ?? '').trim()
        const ms = /^\d+$/.test(subSec) ? Math.round(Number(`0.${subSec}`) * 1000) : 0
        capturedAt = date.getTime() + Math.min(ms, 999)
      }
      const serial = String(exif.Photo?.BodySerialNumber ?? '').trim()
      const makeModel = `${exif.Image?.Make ?? ''} ${exif.Image?.Model ?? ''}`.trim()
      cameraId = serial || makeModel || null
      if (typeof exif.Image?.Rating === 'number') rating = exif.Image.Rating
    } catch {
      // Malformed EXIF: leave fields null
    }
  }

  if (meta.xmp) {
    // xmp:Rating="3" (attribute) or <xmp:Rating>3</xmp:Rating> (element)
    const match = /xmp:Rating(?:\s*=\s*["']|>)\s*(-?\d+)/.exec(meta.xmp.toString('utf8'))
    if (match) rating = Number(match[1])
  }

  return { capturedAt, cameraId, rating }
}

/**
 * Pixel signals from a small (thumbnail-sized) image. Each branch resizes the already
 * small input, so this is a few ms.
 *
 * Sharpness: variance of a 3×3 Laplacian on a 256px greyscale, computed here rather than
 * sharp's stats().sharpness because stats() reads the input, not the resized pipeline
 * output, and we want a fixed resolution so values compare across images.
 */
export async function thumbnailSignals(
  input: Buffer | string
): Promise<Pick<ImageSignals, 'phash' | 'sharpness' | 'thumbhash'>> {
  const image = sharp(input, { failOnError: false })
  const { rgbaToThumbHash } = await import('thumbhash') // ESM-only package

  const [dhash, grey, rgba] = await Promise.all([
    image
      .clone()
      .greyscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true }),
    image
      .clone()
      .greyscale()
      .resize(256, 256, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true }),
    image
      .clone()
      .resize(100, 100, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  ])

  return {
    phash: dHash(dhash.data, dhash.info.channels),
    sharpness: laplacianVariance(grey.data, grey.info.width, grey.info.height, grey.info.channels),
    thumbhash: Buffer.from(rgbaToThumbHash(rgba.info.width, rgba.info.height, rgba.data)).toString(
      'base64'
    )
  }
}

/** 9×8 greyscale → 64 bits (left pixel brighter than right) → 16 hex chars */
function dHash(px: Buffer, channels: number): string {
  let hex = ''
  for (let y = 0; y < 8; y++) {
    let byte = 0
    for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * channels
      byte = (byte << 1) | (px[i] > px[i + channels] ? 1 : 0)
    }
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

function laplacianVariance(px: Buffer, w: number, h: number, channels: number): number {
  if (w < 3 || h < 3) return 0
  const at = (x: number, y: number): number => px[(y * w + x) * channels]
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * at(x, y)
      sum += v
      sumSq += v * v
      n++
    }
  }
  const mean = sum / n
  return Math.round((sumSq / n - mean * mean) * 100) / 100
}
