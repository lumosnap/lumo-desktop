/**
 * Compression Worker Pool
 *
 * Manages a pool of worker threads for parallel image compression.
 * Provides task queuing, error recovery, and graceful shutdown.
 */

import { Worker } from 'worker_threads'
import { join } from 'path'
import { createLogger } from './logger'

const logger = createLogger('CompressionPool')

export interface CompressionOptions {
  outputDir: string
  precomputedHash?: string // If provided, skip hashing in worker
  maxBytes?: number
  tolerance?: number
  maxEdge?: number
  qualityStart?: number
  qualityMin?: number
  effort?: number
  sharpConcurrency?: number
  smartSubsample?: boolean
  preset?: 'photo' | 'picture' | 'drawing' | 'icon' | 'text'
}

export interface CompressionResult {
  success: boolean
  compressedPath: string
  thumbnailPath: string
  width: number
  height: number
  fileSize: number
  hash: string
  error?: string
}

interface PendingTask {
  taskId: string
  inputPath: string
  options: CompressionOptions
  resolve: (result: CompressionResult) => void
  reject: (error: Error) => void
}

interface WorkerState {
  worker: Worker
  busy: boolean
  currentTaskId: string | null
}

class CompressionPool {
  private workers: WorkerState[] = []
  private taskQueue: PendingTask[] = []
  private pendingTasks: Map<string, PendingTask> = new Map()
  private isInitialized = false
  private isShuttingDown = false
  private taskIdCounter = 0

  private readonly poolSize = 4 // Match current concurrency
  private readonly workerTimeout = 60000 // 60s timeout per task

  /**
   * Get the worker script path
   */
  private getWorkerPath(): string {
    // In development, the worker is in src/main
    // In production, it's compiled to out/main
    if (process.env.NODE_ENV === 'development' || !require.main?.filename) {
      // Development - use the TS file with ts-node or direct path
      return join(__dirname, 'compression-worker.js')
    }
    // Production - compiled JS
    return join(__dirname, 'compression-worker.js')
  }

  /**
   * Initialize the worker pool
   */
  initialize(): void {
    if (this.isInitialized) {
      logger.warn('Worker pool already initialized')
      return
    }

    logger.info(`Initializing compression pool with ${this.poolSize} workers...`)

    const workerPath = this.getWorkerPath()

    for (let i = 0; i < this.poolSize; i++) {
      this.createWorker(i, workerPath)
    }

    this.isInitialized = true
    logger.info('✓ Compression pool initialized')
  }

  /**
   * Create a single worker
   */
  private createWorker(index: number, workerPath: string): void {
    try {
      const worker = new Worker(workerPath)

      const workerState: WorkerState = {
        worker,
        busy: false,
        currentTaskId: null
      }

      worker.on('message', (message) => {
        if (message.type === 'ready') {
          logger.debug(`Worker ${index} ready`)
          return
        }

        // Handle compression result
        const taskId = message.taskId
        const pendingTask = this.pendingTasks.get(taskId)

        if (pendingTask) {
          this.pendingTasks.delete(taskId)
          workerState.busy = false
          workerState.currentTaskId = null

          const result: CompressionResult = {
            success: message.success,
            compressedPath: message.compressedPath,
            thumbnailPath: message.thumbnailPath,
            width: message.width,
            height: message.height,
            fileSize: message.fileSize,
            hash: message.hash || '',
            error: message.error
          }

          pendingTask.resolve(result)

          // Process next task in queue
          this.processNextTask(workerState)
        }
      })

      worker.on('error', (error) => {
        logger.error(`Worker ${index} error:`, error)
        this.restartWorker(index, workerState, error)
      })

      worker.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          logger.warn(`Worker ${index} exited with code ${code}, restarting...`)
          this.restartWorker(index, workerState, new Error(`Worker exited with code ${code}`))
        }
      })

      this.workers[index] = workerState
    } catch (error) {
      logger.error(`Failed to create worker ${index}:`, error)
    }
  }

  /**
   * Restart a crashed or hung worker, rejecting its in-flight task.
   * No-op if this worker was already replaced (error is followed by exit).
   */
  private restartWorker(index: number, oldState: WorkerState, reason: Error): void {
    if (this.isShuttingDown || this.workers[index] !== oldState) return

    const taskId = oldState.currentTaskId
    const pendingTask = taskId ? this.pendingTasks.get(taskId) : undefined
    if (taskId && pendingTask) {
      this.pendingTasks.delete(taskId)
      pendingTask.reject(reason)
    }

    try {
      oldState.worker.terminate().catch(() => {})
    } catch {
      // Ignore termination errors
    }

    const workerPath = this.getWorkerPath()
    logger.info(`Restarting worker ${index}...`)
    this.createWorker(index, workerPath)

    // Keep draining the queue on the fresh worker
    const freshState = this.workers[index]
    if (freshState !== oldState) this.processNextTask(freshState)
  }

  /**
   * Process the next task in queue
   */
  private processNextTask(workerState: WorkerState): void {
    if (this.isShuttingDown || workerState.busy) return

    const task = this.taskQueue.shift()
    if (!task) return

    this.dispatch(workerState, task)
  }

  /**
   * Send a task to a worker. On timeout the worker is still running the task,
   * so it is terminated and respawned rather than marked free.
   */
  private dispatch(workerState: WorkerState, task: PendingTask): void {
    workerState.busy = true
    workerState.currentTaskId = task.taskId
    this.pendingTasks.set(task.taskId, task)

    workerState.worker.postMessage({
      taskId: task.taskId,
      inputPath: task.inputPath,
      outputDir: task.options.outputDir,
      precomputedHash: task.options.precomputedHash,
      options: task.options
    })

    setTimeout(() => {
      if (this.pendingTasks.has(task.taskId)) {
        logger.warn(`Task ${task.taskId} timed out`)
        const index = this.workers.indexOf(workerState)
        if (index !== -1) {
          this.restartWorker(index, workerState, new Error('Compression timed out'))
        } else {
          this.pendingTasks.delete(task.taskId)
          task.reject(new Error('Compression timed out'))
        }
      }
    }, this.workerTimeout)
  }

  /**
   * Compress an image using the worker pool
   */
  compress(inputPath: string, options: CompressionOptions): Promise<CompressionResult> {
    // Lazy initialization
    if (!this.isInitialized) {
      this.initialize()
    }

    return new Promise((resolve, reject) => {
      const taskId = `task_${++this.taskIdCounter}_${Date.now()}`

      const task: PendingTask = {
        taskId,
        inputPath,
        options,
        resolve,
        reject
      }

      // Find an available worker
      const availableWorker = this.workers.find((w) => !w.busy)

      if (availableWorker) {
        this.dispatch(availableWorker, task)
      } else {
        // Queue the task
        this.taskQueue.push(task)
      }
    })
  }

  /**
   * Get pool statistics
   */
  getStats(): { active: number; queued: number; total: number } {
    return {
      active: this.workers.filter((w) => w.busy).length,
      queued: this.taskQueue.length,
      total: this.poolSize
    }
  }

  /**
   * Gracefully shutdown the pool
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return

    logger.info('Shutting down compression pool...')
    this.isShuttingDown = true

    // Reject all queued tasks
    for (const task of this.taskQueue) {
      task.reject(new Error('Pool shutting down'))
    }
    this.taskQueue = []

    // Terminate all workers
    const terminatePromises = this.workers.map(async (workerState) => {
      try {
        await workerState.worker.terminate()
      } catch {
        // Ignore errors
      }
    })

    await Promise.all(terminatePromises)

    this.workers = []
    this.pendingTasks.clear()
    this.isInitialized = false

    logger.info('✓ Compression pool shutdown complete')
  }
}

// Singleton instance
export const compressionPool = new CompressionPool()
