import { ref, type Ref } from 'vue'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Saves the latest edit a moment after typing stops. One save at a time; an edit made during a
 * save goes in the next one. A failed value is kept, so flush() (on close) or retry() sends it.
 */
export function useAutosave<T>(
  save: (value: T) => Promise<boolean>,
  delay = 700
): {
  status: Ref<SaveStatus>
  edit: (value: T) => void
  flush: () => Promise<boolean>
  dirty: () => boolean
} {
  const status = ref<SaveStatus>('idle')
  let timer: ReturnType<typeof setTimeout> | undefined
  let next: { value: T } | null = null
  let running: Promise<boolean> | null = null

  function edit(value: T): void {
    next = { value }
    if (status.value === 'saved') status.value = 'idle'
    clearTimeout(timer)
    timer = setTimeout(flush, delay)
  }

  async function flush(): Promise<boolean> {
    clearTimeout(timer)
    while (running) await running
    if (!next) return status.value !== 'error'
    const { value } = next
    next = null
    status.value = 'saving'
    running = save(value).catch(() => false)
    const ok = await running
    running = null
    if (!ok && !next) next = { value } // keep it for the retry
    if (next && ok) return flush()
    status.value = ok ? 'saved' : 'error'
    return ok
  }

  return { status, edit, flush, dirty: () => !!next || !!running }
}
