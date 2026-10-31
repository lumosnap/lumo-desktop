/**
 * People clustering. Pure: no DB, no Electron. clusterFaces is heavy and runs in the ML worker;
 * assignPeople is cheap and runs in main inside the write transaction.
 *
 * SFace vectors are L2-normalized, so the mean pairwise cosine between two groups is
 * dot(sumA, sumB) / (|A|·|B|): average linkage needs only each cluster's vector sum.
 */

export const FACE_DIM = 128
/**
 * Average-linkage cosine to join two clusters, and to match a cluster to an existing person.
 * SFace's same-identity reference is 0.363. On LumoTest 0.45 makes no wrong merges (bride split
 * in two), 0.40 already puts a guest in the mother's cluster: a wrong merge is worse than a split.
 */
export const CLUSTER_THRESHOLD = 0.45

const dot = (s: Float64Array, a: number, b: number): number => {
  let d = 0
  for (let k = 0; k < FACE_DIM; k++) d += s[a * FACE_DIM + k] * s[b * FACE_DIM + k]
  return d
}

/**
 * Average-linkage agglomerative clustering via the nearest-neighbour chain, stopping at
 * `threshold`. vecs = n × FACE_DIM, L2-normalized. Returns a cluster label (a face index) per face.
 * ponytail: O(n²·d): ~2 s for 2k faces, ~18 s for 5k in the worker; add an ANN index if albums get bigger.
 */
export function clusterFaces(vecs: Float32Array, threshold = CLUSTER_THRESHOLD): Int32Array {
  const n = vecs.length / FACE_DIM
  const sums = Float64Array.from(vecs)
  const size = new Float64Array(n).fill(1)
  const parent = Int32Array.from({ length: n }, (_, i) => i)
  let live = Array.from({ length: n }, (_, i) => i) // not merged away, not retired
  const dead = new Uint8Array(n)
  const sim = (a: number, b: number): number => dot(sums, a, b) / (size[a] * size[b])

  const chain: number[] = []
  while (live.length > 1) {
    if (chain.length === 0) chain.push(live[0])
    const a = chain[chain.length - 1]
    const prev = chain.length > 1 ? chain[chain.length - 2] : -1
    let best = -1
    let bestSim = -Infinity
    for (const x of live) {
      if (x === a) continue
      const s = sim(a, x)
      if (s > bestSim || (s === bestSim && x === prev)) {
        best = x
        bestSim = s
      }
    }
    if (bestSim < threshold) {
      // Sims rise along the chain, so nothing on it reaches the threshold with anyone.
      // Average linkage is reducible: later merges can't raise them either. Retire the chain.
      for (const c of chain) dead[c] = 1
      chain.length = 0
    } else if (best === prev) {
      chain.length -= 2
      for (let k = 0; k < FACE_DIM; k++) sums[a * FACE_DIM + k] += sums[best * FACE_DIM + k]
      size[a] += size[best]
      parent[best] = a
      dead[best] = 1
    } else {
      chain.push(best)
      continue
    }
    live = live.filter((x) => !dead[x])
  }

  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  return Int32Array.from({ length: n }, (_, i) => root(i))
}

export interface FaceIn {
  id: number
  vec: Float32Array
  /** Current person (before this run). */
  person: string | null
  /** Manual override: undefined = none, null = "no one", string = that person. */
  override?: string | null
}

export interface PersonIn {
  id: string
  /** Named, hidden, merged into or given a cover by the photographer: kept, may take many clusters. */
  curated: boolean
}

/**
 * Turn fresh cluster labels into person ids, keeping existing people stable. `labels` covers
 * the faces without an override. Each cluster goes to the existing person with the best
 * average-linkage similarity ≥ threshold (an uncurated person takes at most one cluster);
 * unmatched clusters of ≥ 2 faces become new people; singletons stay unassigned.
 * Overrides always win. Returns the person per face and the ids it created.
 */
export function assignPeople(
  faces: FaceIn[],
  labels: Map<number, number>,
  persons: PersonIn[],
  newId: () => string,
  threshold = CLUSTER_THRESHOLD
): { assign: Map<number, string | null>; created: string[] } {
  const accumulate = (groups: Map<string | number, FaceIn[]>): Map<string | number, Float64Array> =>
    new Map(
      [...groups].map(([key, fs]) => {
        const s = new Float64Array(FACE_DIM)
        for (const f of fs) for (let k = 0; k < FACE_DIM; k++) s[k] += f.vec[k]
        return [key, s]
      })
    )
  const groupBy = <K>(fs: FaceIn[], key: (f: FaceIn) => K | null): Map<K, FaceIn[]> => {
    const m = new Map<K, FaceIn[]>()
    for (const f of fs) {
      const k = key(f)
      if (k == null) continue
      const list = m.get(k)
      if (list) list.push(f)
      else m.set(k, [f])
    }
    return m
  }

  const known = new Map(persons.map((p) => [p.id, p]))
  const personFaces = groupBy(faces, (f) => (f.person && known.has(f.person) ? f.person : null))
  const personSums = accumulate(personFaces as Map<string | number, FaceIn[]>)
  const clusters = groupBy(
    faces.filter((f) => f.override === undefined),
    (f) => labels.get(f.id) ?? null
  )
  const clusterSums = accumulate(clusters as Map<string | number, FaceIn[]>)

  const pairs: Array<{ c: number; p: string; s: number }> = []
  for (const [c, cf] of clusters) {
    for (const [p, pf] of personFaces) {
      let d = 0
      const cs = clusterSums.get(c)!
      const ps = personSums.get(p)!
      for (let k = 0; k < FACE_DIM; k++) d += cs[k] * ps[k]
      const s = d / (cf.length * pf.length)
      if (s >= threshold) pairs.push({ c, p, s })
    }
  }
  pairs.sort((x, y) => y.s - x.s)

  const clusterPerson = new Map<number, string>()
  const taken = new Set<string>()
  for (const { c, p } of pairs) {
    if (clusterPerson.has(c)) continue
    if (!known.get(p)!.curated && taken.has(p)) continue
    // A lone face may only join someone who is already shown as a person
    if (clusters.get(c)!.length < 2 && !known.get(p)!.curated && personFaces.get(p)!.length < 2)
      continue
    clusterPerson.set(c, p)
    taken.add(p)
  }
  const created: string[] = []
  for (const [c, cf] of clusters) {
    if (clusterPerson.has(c) || cf.length < 2) continue
    const id = newId()
    created.push(id)
    clusterPerson.set(c, id)
  }

  const assign = new Map<number, string | null>()
  for (const f of faces) {
    if (f.override !== undefined) assign.set(f.id, f.override)
    else assign.set(f.id, clusterPerson.get(labels.get(f.id) ?? -1) ?? null)
  }
  return { assign, created }
}
