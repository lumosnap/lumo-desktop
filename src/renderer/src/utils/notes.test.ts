import { describe, it, expect } from 'vitest'
import { noteState, withNoteState } from './notes'

const at = (s: string): number => Date.parse(s)
const c = (
  notes: string | null,
  createdAt = '2026-10-30T10:00:00Z'
): { notes: string | null; createdAt: string } => ({ notes, createdAt })

describe('noteState', () => {
  it('is nothing for a photo with no note, hearts only, or a blank note', () => {
    expect(noteState({ id: 1 })).toBeNull()
    expect(noteState({ id: 1, comments: [c(null), c('  ')] }, '  ')).toBeNull()
    expect(noteState({ id: 1 }, undefined, at('2026-10-31'))).toBeNull()
  })
  it('is open with your note or a client note, done once marked', () => {
    expect(noteState({ id: 1 }, 'Retouch')).toBe('open')
    expect(noteState({ id: 1, comments: [c('Brighter please')] })).toBe('open')
    expect(noteState({ id: 1, notesCount: 2 })).toBe('open') // comments not loaded yet
    expect(noteState({ id: 1 }, 'Retouch', at('2026-10-31'))).toBe('done')
    expect(noteState({ id: 1, comments: [c('Brighter please')] }, '', at('2026-10-31'))).toBe(
      'done'
    )
  })
  it('opens again when the client writes after the mark', () => {
    const late = { id: 1, comments: [c('Brighter'), c('And crop it', '2026-11-01T09:00:00Z')] }
    expect(noteState(late, undefined, at('2026-10-31'))).toBe('open')
    expect(noteState(late, undefined, at('2026-11-02'))).toBe('done')
  })
})

describe('withNoteState', () => {
  const imgs = [
    { id: 1 },
    { id: 2, comments: [c('Brighter')] },
    { id: 3 },
    { id: 4, comments: [c('Crop')] }
  ]
  const notes = { 3: 'Print 16x24' }
  const done = { 1: at('2026-10-31'), 4: at('2026-10-31') }
  it('keeps every photo with no filter', () => {
    expect(withNoteState(imgs, null, notes, done)).toBe(imgs)
  })
  it('splits noted photos into to do and done; plain ones are in neither', () => {
    expect(withNoteState(imgs, 'open', notes, done).map((i) => i.id)).toEqual([2, 3])
    expect(withNoteState(imgs, 'done', notes, done).map((i) => i.id)).toEqual([4])
  })
})
