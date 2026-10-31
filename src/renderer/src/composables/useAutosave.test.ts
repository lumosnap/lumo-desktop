import { describe, it, expect, vi } from 'vitest'
import { useAutosave } from './useAutosave'

describe('useAutosave', () => {
  it('saves the last edit once typing stops', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => true)
    const a = useAutosave(save, 500)
    a.edit('a')
    a.edit('ab')
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('ab')
    expect(a.status.value).toBe('saved')
    vi.useRealTimers()
  })

  it('keeps a failed value and sends it on flush', async () => {
    let ok = false
    const save = vi.fn(async () => ok)
    const a = useAutosave(save, 10_000)
    a.edit('note')
    expect(await a.flush()).toBe(false)
    expect(a.status.value).toBe('error')
    expect(a.dirty()).toBe(true)
    ok = true
    expect(await a.flush()).toBe(true)
    expect(save).toHaveBeenLastCalledWith('note')
    expect(a.dirty()).toBe(false)
  })

  it('sends an edit made during a save right after it', async () => {
    let finish: (v: boolean) => void = () => {}
    const save = vi.fn((v: string) =>
      v === 'one' ? new Promise<boolean>((r) => (finish = r)) : Promise.resolve(true)
    )
    const a = useAutosave(save, 10_000)
    a.edit('one')
    const first = a.flush()
    a.edit('two')
    finish(true)
    await first
    await a.flush()
    expect(save.mock.calls.map((c) => c[0])).toEqual(['one', 'two'])
    expect(a.status.value).toBe('saved')
  })
})
