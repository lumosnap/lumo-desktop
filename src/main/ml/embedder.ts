/**
 * Main-process side of the embedding utilityProcess. The model never runs in main or renderer.
 * Spawned lazily at low OS priority, paused on battery or thermal pressure, killed when idle.
 */
import { powerMonitor, utilityProcess, type UtilityProcess } from 'electron'
import { constants, setPriority } from 'os'
import { join } from 'path'
import { ensureModel } from './model'
import { createLogger, getErrorMessage } from '../logger'

const log = createLogger('Embedder')

export const BATCH_SIZE = 8
const IDLE_KILL_MS = 3 * 60_000

type Pending = { resolve: (v: Array<Float32Array | null>) => void; reject: (e: Error) => void }

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

function spawn(modelPath: string): UtilityProcess {
  const proc = utilityProcess.fork(join(__dirname, 'embed-worker.js'), [modelPath], {
    serviceName: 'Lumosnap Tagger'
  })
  proc.on('spawn', () => {
    try {
      setPriority(proc.pid!, constants.priority.PRIORITY_LOW) // nice 19 / Windows IDLE-ish class
    } catch (error) {
      log.warn('Could not lower embedder priority:', getErrorMessage(error))
    }
  })
  proc.on(
    'message',
    (msg: { id: number; vectors?: Array<Float32Array | null>; error?: string }) => {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg.vectors!)
    }
  )
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

/**
 * Embed up to BATCH_SIZE thumbnails. Resolves with one L2-normalized 768-d vector per path
 * (null where the image could not be decoded). Waits while on battery or thermally throttled.
 */
export async function embedBatch(paths: string[]): Promise<Array<Float32Array | null>> {
  await waitUntilAllowed()
  const modelPath = await ensureModel()
  clearTimeout(idleTimer)
  child ??= spawn(modelPath)
  const id = nextId++
  const result = new Promise<Array<Float32Array | null>>((resolve, reject) =>
    pending.set(id, { resolve, reject })
  )
  child.postMessage({ id, paths })
  try {
    return await result
  } finally {
    if (pending.size === 0) {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(stopEmbedder, IDLE_KILL_MS)
    }
  }
}
