/**
 * Main-process side of the ML utilityProcess (SigLIP tags, faces). Models never run in main or renderer.
 * Spawned lazily at low OS priority, paused on battery or thermal pressure, killed when idle.
 */
import { ipcMain, powerMonitor, utilityProcess, type UtilityProcess } from 'electron'
import { constants, setPriority } from 'os'
import { join } from 'path'
import { discardModel, ensureFaceModels, ensureModel } from './model'
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
// Unplugged, ML keeps running while the battery has charge to spare; it pauses below this level.
const MIN_BATTERY = 0.4 // ponytail: tuning knob; a settings toggle if photographers want stricter
let onBattery = false
let batteryLevel: number | null = null // 0..1, reported by the renderer (Battery Status API); null = unknown
let hot = false
let resumeWaiters: Array<Pending> = []
let watching = false

function update(): void {
  if (paused()) return
  for (const w of resumeWaiters) w.resolve(undefined)
  resumeWaiters = []
}

// The main process has no battery-level API; the renderer reports navigator.getBattery() changes.
ipcMain.on('power:battery', (_event, level: unknown) => {
  batteryLevel = typeof level === 'number' && level >= 0 && level <= 1 ? level : null
  update()
})

function watchPower(): void {
  if (watching) return
  watching = true
  onBattery = powerMonitor.isOnBatteryPower()
  powerMonitor.on('on-battery', () => {
    onBattery = true
    update()
  })
  powerMonitor.on('on-ac', () => {
    onBattery = false
    update()
  })
  powerMonitor.on('thermal-state-change', ({ state }) => {
    hot = state === 'serious' || state === 'critical'
    update()
  })
}

// Unknown level (renderer hasn't reported yet, or no Battery API) runs: never park on a guess
const lowBattery = (): boolean => onBattery && batteryLevel !== null && batteryLevel < MIN_BATTERY
const paused = (): boolean => lowBattery() || hot

/** Unplugged but allowed to run: the UI shows a quiet warning. */
export function isMlOnBattery(): boolean {
  watchPower()
  return onBattery && !paused()
}

/** True while ML work waits for AC power or a cooler machine. */
export function isMlPaused(): boolean {
  watchPower()
  return paused()
}

function waitUntilAllowed(): Promise<void> {
  watchPower()
  if (!paused()) return Promise.resolve()
  log.info(
    `Paused (${hot ? 'thermal pressure' : `battery ${batteryLevel === null ? 'level unknown' : `${Math.round(batteryLevel * 100)}%`}`})`
  )
  return new Promise((resolve, reject) => resumeWaiters.push({ resolve, reject }))
}

/**
 * The worker went away (crash = it exited on its own) or was stopped: nothing to do with the
 * input, so callers retry later instead of recording a result.
 */
export class EmbedderDown extends Error {
  constructor(
    message: string,
    readonly crashed = false
  ) {
    super(message)
  }
}

let shutDown = false

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
  proc.on('message', (msg: { id: number; result?: unknown; error?: string; badModel?: string }) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    // A model that won't load may be corrupt: drop it (if its hash is off) so the next call downloads it again
    if (msg.badModel) {
      log.warn(`model ${msg.badModel} failed to load: ${msg.error}`)
      discardModel(msg.badModel).catch((e) => log.warn('discardModel:', getErrorMessage(e)))
      p.reject(new EmbedderDown(`model failed to load: ${msg.error}`))
    } else if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  })
  proc.on('exit', (code) => {
    // A worker we already replaced (stopEmbedder) must not fail the new one's requests
    if (child !== proc) return
    child = null
    failAll(new EmbedderDown(`embedder exited (${code})`, true))
  })
  return proc
}

function kill(): void {
  clearTimeout(idleTimer)
  const proc = child
  child = null
  failAll(new EmbedderDown('embedder stopped'))
  proc?.kill()
}

/** Kill the worker; in-flight and power-parked requests reject. The next embed() respawns it. */
export function stopEmbedder(): void {
  kill()
  for (const w of resumeWaiters) w.reject(new EmbedderDown('embedder stopped'))
  resumeWaiters = []
}

/** App quit: stop for good, later requests reject instead of respawning the worker. */
export function shutdownEmbedder(): void {
  shutDown = true
  stopEmbedder()
}

/** One request to the worker; waits while on battery or thermally throttled. */
async function request<T>(msg: object): Promise<T> {
  await waitUntilAllowed()
  if (shutDown) throw new EmbedderDown('embedder stopped')
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
      idleTimer = setTimeout(kill, IDLE_KILL_MS) // parked requests stay parked
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
