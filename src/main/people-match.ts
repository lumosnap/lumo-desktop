/**
 * People matching. Pure: no DB, no Electron. A person is the set of faces the photographer
 * confirmed (references); every other face goes to the person with the most similar reference.
 * SFace vectors are L2-normalized, so cosine = dot product.
 */

export const FACE_DIM = 128
/**
 * Max cosine to a person's references at which a face is assigned without asking.
 * Precision first. On LumoTest (fp32 SFace), the closest different-person pair is 0.42
 * (mother vs her daughter the bride), father vs groom ≤ 0.19, and 433 strangers (bench) score
 * ≤ 0.44 against all 25 known faces; true matches to one reference are mostly 0.54-0.81.
 * ponytail: one global threshold; tune per album if family look-alikes start auto-matching.
 */
export const T_AUTO = 0.5
/**
 * Lower bound for "Is this X?" suggestions. Near SFace's published same-person 0.363.
 * 0.30 would also reach the bride's three profile/kiss shots on LumoTest but asks about
 * ~22% of strangers instead of ~7%: every no is remembered, but that's a lot of noes.
 */
export const T_REVIEW = 0.35

export interface FaceVec {
  id: number
  vec: Float32Array
  /** Person this face is a reference of. */
  ref: string | null
}

export interface Match {
  personId: string
  score: number
}

/**
 * Best person per non-reference face: max cosine to any of that person's references, skipping
 * people the photographer said the face is not (`rejected` holds `${faceId}:${personId}`).
 * Faces with no candidate are left out.
 * ponytail: O(faces × references × 128) on every change; ~10 ms for 5k faces × 50 references.
 */
export function bestMatches(faces: FaceVec[], rejected: Set<string>): Map<number, Match> {
  const refs = faces.filter((f) => f.ref != null)
  const out = new Map<number, Match>()
  for (const f of faces) {
    if (f.ref != null) continue
    let best: Match | null = null
    for (const r of refs) {
      if (rejected.has(`${f.id}:${r.ref}`)) continue
      let s = 0
      for (let k = 0; k < FACE_DIM; k++) s += f.vec[k] * r.vec[k]
      if (!best || s > best.score) best = { personId: r.ref!, score: s }
    }
    if (best) out.set(f.id, best)
  }
  return out
}

/** Split matches into auto assignments (face → person) and per-person review queues (best first). */
export function classify(
  matches: Map<number, Match>,
  tAuto = T_AUTO,
  tReview = T_REVIEW
): { auto: Map<number, string>; review: Map<string, Array<{ faceId: number; score: number }>> } {
  const auto = new Map<number, string>()
  const review = new Map<string, Array<{ faceId: number; score: number }>>()
  for (const [faceId, m] of matches) {
    if (m.score >= tAuto) auto.set(faceId, m.personId)
    else if (m.score >= tReview) {
      const q = review.get(m.personId)
      if (q) q.push({ faceId, score: m.score })
      else review.set(m.personId, [{ faceId, score: m.score }])
    }
  }
  for (const q of review.values()) q.sort((a, b) => b.score - a.score)
  return { auto, review }
}
