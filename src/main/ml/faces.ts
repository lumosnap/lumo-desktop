/**
 * Face pipeline math, shared by the ML worker and tests. No ORT or sharp here.
 * YuNet (OpenCV Zoo face_detection_yunet_2023mar) decoding follows OpenCV's
 * FaceDetectorYN::postProcess; alignment follows FaceRecognizerSF::alignCrop.
 */

/** YuNet input is fixed at 640x640 (BGR, 0..255, image top-left, zero padded). */
export const YUNET_SIZE = 640
const STRIDES = [8, 16, 32] as const

export interface DetectedFace {
  box: [number, number, number, number] // x, y, w, h in input pixels
  score: number
  landmarks: number[] // 5 points, x/y interleaved: right eye, left eye, nose, right mouth, left mouth
}

type Outputs = Record<string, { data: ArrayLike<number> }>

/** Decode YuNet heads into faces above `minScore`, then NMS (IoU 0.3 like OpenCV's default). */
export function decodeYuNet(out: Outputs, minScore: number, size = YUNET_SIZE): DetectedFace[] {
  const faces: DetectedFace[] = []
  for (const stride of STRIDES) {
    const cols = size / stride
    const rows = size / stride
    const cls = out[`cls_${stride}`].data
    const obj = out[`obj_${stride}`].data
    const bbox = out[`bbox_${stride}`].data
    const kps = out[`kps_${stride}`].data
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const clamp = (v: number): number => Math.min(1, Math.max(0, v))
        const score = Math.sqrt(clamp(cls[i]) * clamp(obj[i]))
        if (score < minScore) continue
        const cx = (c + bbox[i * 4]) * stride
        const cy = (r + bbox[i * 4 + 1]) * stride
        const w = Math.exp(bbox[i * 4 + 2]) * stride
        const h = Math.exp(bbox[i * 4 + 3]) * stride
        const landmarks: number[] = []
        for (let n = 0; n < 5; n++) {
          landmarks.push((kps[i * 10 + 2 * n] + c) * stride, (kps[i * 10 + 2 * n + 1] + r) * stride)
        }
        faces.push({ box: [cx - w / 2, cy - h / 2, w, h], score, landmarks })
      }
    }
  }
  return nms(faces, 0.3)
}

function iou(a: DetectedFace['box'], b: DetectedFace['box']): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]))
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]))
  const inter = ix * iy
  return inter / (a[2] * a[3] + b[2] * b[3] - inter)
}

export function nms(faces: DetectedFace[], threshold: number): DetectedFace[] {
  const kept: DetectedFace[] = []
  for (const f of [...faces].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k.box, f.box) <= threshold)) kept.push(f)
  }
  return kept
}

/** ArcFace 112x112 5-point template used by SFace's alignCrop. */
export const ALIGN_TEMPLATE = [
  38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041
]
export const ALIGN_SIZE = 112

/**
 * Least-squares similarity transform (rotation + uniform scale + translation, no reflection)
 * mapping `src` points onto `dst`, as [a, b, tx, ty]: x' = a·x − b·y + tx, y' = b·x + a·y + ty.
 * Same optimum as Umeyama's method, written as complex least squares (dst ≈ c·src + t).
 */
export function similarityTransform(
  src: number[],
  dst: number[]
): [number, number, number, number] {
  const n = src.length / 2
  let sx = 0
  let sy = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    sx += src[2 * i]
    sy += src[2 * i + 1]
    dx += dst[2 * i]
    dy += dst[2 * i + 1]
  }
  sx /= n
  sy /= n
  dx /= n
  dy /= n
  let numA = 0
  let numB = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const zx = src[2 * i] - sx
    const zy = src[2 * i + 1] - sy
    const wx = dst[2 * i] - dx
    const wy = dst[2 * i + 1] - dy
    numA += zx * wx + zy * wy
    numB += zx * wy - zy * wx
    den += zx * zx + zy * zy
  }
  const a = numA / den
  const b = numB / den
  return [a, b, dx - (a * sx - b * sy), dy - (b * sx + a * sy)]
}

/**
 * Warp an RGB image to the 112x112 aligned face (like cv.warpAffine with INTER_LINEAR and a
 * zero border): every output pixel samples the source at the inverse-mapped position.
 */
export function alignFace(
  rgb: Uint8Array,
  width: number,
  height: number,
  landmarks: number[]
): Uint8Array {
  const [a, b, tx, ty] = similarityTransform(landmarks, ALIGN_TEMPLATE)
  // inverse of c = a + ib is conj(c) / |c|²
  const k = a * a + b * b
  const ia = a / k
  const ib = -b / k
  const out = new Uint8Array(ALIGN_SIZE * ALIGN_SIZE * 3)
  const px = (x: number, y: number, ch: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : rgb[(y * width + x) * 3 + ch]
  for (let v = 0; v < ALIGN_SIZE; v++) {
    for (let u = 0; u < ALIGN_SIZE; u++) {
      const ux = u - tx
      const vy = v - ty
      const x = ia * ux - ib * vy
      const y = ib * ux + ia * vy
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      for (let ch = 0; ch < 3; ch++) {
        const top = px(x0, y0, ch) * (1 - fx) + px(x0 + 1, y0, ch) * fx
        const bottom = px(x0, y0 + 1, ch) * (1 - fx) + px(x0 + 1, y0 + 1, ch) * fx
        out[(v * ALIGN_SIZE + u) * 3 + ch] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return out
}

/** 1 = looking straight at the camera, 0 = profile. From the nose's x between the eyes. */
export function frontalness(landmarks: number[]): number {
  const [rex, , lex, , nx] = landmarks
  const span = lex - rex
  if (span <= 0) return 0
  return Math.max(0, 1 - 2 * Math.abs((nx - rex) / span - 0.5))
}

/** A face as the worker returns it: box and landmarks normalized to the photo (0..1). */
export interface WorkerFace {
  box: [number, number, number, number]
  score: number
  landmarks: number[]
  vec: Float32Array // 128-d SFace, L2-normalized
}
