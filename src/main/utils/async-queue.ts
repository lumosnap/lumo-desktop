/**
 * AsyncQueue - Producer-Consumer Queue for Pipeline
 *
 * Enables parallel compression and upload by decoupling producers from consumers.
 * Features:
 * - Backpressure control via max size
 * - Async iteration support
 * - Graceful completion signaling
 * - Pause/resume for network changes
 */

export interface QueueItem<T> {
  data: T
  id: string
}

export class AsyncQueue<T> {
  private queue: QueueItem<T>[] = []
  private waiters: Array<{
    resolve: (value: QueueItem<T> | null) => void
    reject: (error: Error) => void
  }> = []
  private spaceWaiters: Array<() => void> = []
  private completed = false
  private paused = false
  private pauseWaiters: Array<() => void> = []
  private readonly maxSize: number

  constructor(maxSize = 200) {
    this.maxSize = maxSize
  }

  /**
   * Get current queue size
   */
  get size(): number {
    return this.queue.length
  }

  /**
   * Check if queue is full
   */
  get isFull(): boolean {
    return this.queue.length >= this.maxSize
  }

  /**
   * Check if queue is paused
   */
  get isPaused(): boolean {
    return this.paused
  }

  /**
   * Push an item to the queue
   */
  push(item: T, id: string): void {
    if (this.completed) {
      throw new Error('Cannot push to completed queue')
    }

    const queueItem: QueueItem<T> = { data: item, id }

    // If there's a waiting consumer, deliver directly
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve(queueItem)
      return
    }

    // Otherwise add to queue
    this.queue.push(queueItem)
  }

  /**
   * Pop an item from the queue (async)
   * Returns null when queue is completed and empty
   */
  async pop(): Promise<QueueItem<T> | null> {
    // Wait if paused
    while (this.paused) {
      await new Promise<void>((resolve) => {
        this.pauseWaiters.push(resolve)
      })
    }

    // If there's an item, return it
    if (this.queue.length > 0) {
      const item = this.queue.shift()!

      // Notify space waiters
      const spaceWaiter = this.spaceWaiters.shift()
      if (spaceWaiter) {
        spaceWaiter()
      }

      return item
    }

    // If completed and empty, return null
    if (this.completed) {
      return null
    }

    // Wait for an item
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  /**
   * Wait for space in the queue (for backpressure)
   */
  async waitForSpace(): Promise<void> {
    if (!this.isFull) return

    return new Promise((resolve) => {
      this.spaceWaiters.push(resolve)
    })
  }

  /**
   * Mark queue as complete (no more items will be added)
   */
  complete(): void {
    this.completed = true

    // Resolve all waiting consumers with null
    for (const waiter of this.waiters) {
      waiter.resolve(null)
    }
    this.waiters = []
  }

  /**
   * Pause the queue (consumers will wait)
   */
  pause(): void {
    this.paused = true
  }

  /**
   * Resume the queue
   */
  resume(): void {
    this.paused = false

    // Wake up all pause waiters
    for (const waiter of this.pauseWaiters) {
      waiter()
    }
    this.pauseWaiters = []
  }

  /**
   * Abort the queue (reject all waiters)
   */
  abort(reason: string): void {
    this.completed = true
    this.paused = false

    const error = new Error(reason)

    for (const waiter of this.waiters) {
      waiter.reject(error)
    }
    this.waiters = []

    for (const waiter of this.pauseWaiters) {
      waiter()
    }
    this.pauseWaiters = []
  }

  /**
   * Clear all items from the queue
   */
  clear(): void {
    this.queue = []

    // Notify all space waiters
    for (const waiter of this.spaceWaiters) {
      waiter()
    }
    this.spaceWaiters = []
  }

  /**
   * Get all remaining items (drains the queue)
   */
  drain(): QueueItem<T>[] {
    const items = [...this.queue]
    this.clear()
    return items
  }

  /**
   * Async iterator support
   */
  async *[Symbol.asyncIterator](): AsyncIterator<QueueItem<T>> {
    while (true) {
      const item = await this.pop()
      if (item === null) break
      yield item
    }
  }
}
