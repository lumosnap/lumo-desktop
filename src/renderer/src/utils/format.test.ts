import { describe, it, expect } from 'vitest'
import { albumDay, fileManager, localDay } from './format'

describe('localDay', () => {
  it('reads an event date as that day in this time zone', () => {
    for (const s of ['2026-10-12', '2026-10-12T00:00:00.000Z', '2026-10-12T00:00:00Z']) {
      const d = localDay(s)
      expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 12])
    }
    expect(albumDay('2026-10-12')).toBe('12 Oct 2026')
  })
  it('keeps a timestamp an instant, and says nothing for no date', () => {
    expect(localDay('2026-10-12T15:30:00Z').getTime()).toBe(Date.UTC(2026, 9, 12, 15, 30))
    // A SQLite createdAt has a space and no zone: still an instant (local time), not a day
    expect(localDay('2026-10-12 15:30:00').getTime()).toBe(new Date(2026, 9, 12, 15, 30).getTime())
    expect(albumDay(null)).toBe('')
    expect(albumDay('not a date')).toBe('')
  })
})

describe('fileManager', () => {
  it('names Explorer on Windows, Finder on macOS, a folder elsewhere', () => {
    expect(['win32', 'darwin', 'linux'].map(fileManager)).toEqual(['Explorer', 'Finder', 'folder'])
  })
})
