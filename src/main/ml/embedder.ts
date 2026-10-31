/**
 * Main-process side of the ML utilityProcess (SigLIP tags, faces). Models never run in main or renderer.
 * Spawned lazily at low OS priority, paused on battery or thermal pressure, killed when idle.
 */
import { powerMonitor, utilityProcess, type UtilityProcess } from 'electron'
import { constants, setPriority } from 'os'
import { join } from 'path'
import { ensureFaceModels, ensureModel } from './model'
import type { WorkerFace } from './faces'
import { createLogger, getErrorMessage } from '../logger'

const log = createLogger('Embedder')

export const BATCH_SIZE = 8
const IDLE_KILL_MS = 3 * 60_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }

let child: UtilityProcess | null = null
let nextId = 0
const pending = new Map<number, Pending>()
let idleTimer: ReturnType<typeof setTimeout> | undefined

// Pause state. Thermal state is macOS-only; other platforms never report serious/critical.
let onBattery = false
let hot = false
let resumeWaiters: Array<() => void> = []
let watching = false

function watchPower(): void {
  if (watching) return
  watching = true
  onBattery = powerMonitor.isOnBatteryPower()
  const update = (): void => {
    if (paused()) return
    for (const w of resumeWaiters) w()
    resumeWaiters = []
  }
  powerMonitor.on('on-battery', () => (onBattery = true))
  powerMonitor.on('on-ac', () => {
    onBattery = false
    update()
  })
  powerMonitor.on('thermal-state-change', ({ state }) => {
    hot = state === 'serious' || state === 'critical'
    update()
  })
}

const paused = (): boolean => onBattery || hot

/** True while ML work waits for AC power or a cooler machine. */
export function isMlPaused(): boolean {
  watchPower()
  return paused()
}

function waitUntilAllowed(): Promise<void> {
  watchPower()
  if (!paused()) return Promise.resolve()
  log.info(`Paused (${onBattery ? 'on battery' : 'thermal pressure'})`)
  return new Promise((resolve) => resumeWaiters.push(resolve))
}

function failAll(error: Error): void {
  for (const p of pending.values()) p.reject(error)
  pending.clear()
}

function spawn(): UtilityProcess {
  const proc = utilityProcess.fork(join(__dirname, 'embed-worker.js'), [], {
    serviceName: 'Lumosnap Tagger'
  })
  proc.on('spawn', () => {
    try {
      setPriority(proc.pid!, constants.priority.PRIORITY_LOW) // nice 19 / Windows IDLE-ish class
    } catch (error) {
      log.warn('Could not lower embedder priority:', getErrorMessage(error))
    }
  })
  proc.on('message', (msg: { id: number; result?: unknown; error?: string }) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  })
  proc.on('exit', (code) => {
    if (child === proc) child = null
    failAll(new Error(`embedder exited (${code})`))
  })
  return proc
}

/** Kill the worker; in-flight batches reject. The next embed() respawns it. */
export function stopEmbedder(): void {
  clearTimeout(idleTimer)
  const proc = child
  child = null
  failAll(new Error('embedder stopped'))
  proc?.kill()
}

/** One request to the worker; waits while on battery or thermally throttled. */
async function request<T>(msg: object): Promise<T> {
  await waitUntilAllowed()
  clearTimeout(idleTimer)
  child ??= spawn()
  const id = nextId++
  const result = new Promise<T>((resolve, reject) => pending.set(id, { resolve, reject }))
  child.postMessage({ id, ...msg })
  try {
    return await result
  } finally {
    if (pending.size === 0) {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(stopEmbedder, IDLE_KILL_MS)
    }
  }
}

/**
 * Embed up to BATCH_SIZE thumbnails. Resolves with one L2-normalized 768-d vector per path
 * (null where the image could not be decoded).
 */
export async function embedBatch(paths: string[]): Promise<Array<Float32Array | null>> {
  return request({ op: 'embed', model: await ensureModel(), paths })
}

/** Faces in one photo (read at full quality, long edge 1024), each with a 128-d SFace vector. */
export async function detectFaces(path: string): Promise<WorkerFace[]> {
  return request({ op: 'faces', models: await ensureFaceModels(), path })
}

/** Average-linkage cluster labels for n×128 vectors (heavy, so off the main thread). */
export function clusterInWorker(vecs: Float32Array, threshold: number): Promise<Int32Array> {
  return request({ op: 'cluster', vecs, threshold })
}
