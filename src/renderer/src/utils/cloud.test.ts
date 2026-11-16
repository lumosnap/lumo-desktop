import { describe, it, expect } from 'vitest'
import { attachedNote, attachError, relinkError } from './cloud'

describe('attachedNote', () => {
  const r = { title: 'Asha & Rohan', matched: 0, remote: 0, total: 0 }
  it('says what was found and what stays online', () => {
    expect(attachedNote(r)).toBe('“Asha & Rohan” is on this computer now.')
    expect(attachedNote({ ...r, matched: 1200, total: 1200 })).toBe(
      '“Asha & Rohan” is on this computer now, with all 1,200 photos.'
    )
    expect(attachedNote({ ...r, remote: 1, total: 1 })).toBe(
      '“Asha & Rohan” is on this computer now. Its 1 photo is only online.'
    )
    expect(attachedNote({ ...r, matched: 400, remote: 12, total: 412 })).toBe(
      '“Asha & Rohan” is on this computer now. 400 photos found, 12 only online.'
    )
  })
})

describe('attachError', () => {
  it('has its own line for each code', () => {
    const codes = [
      'IN_USE',
      'OTHER_ALBUM',
      'NO_FOLDER',
      'OFFLINE',
      'BUSY',
      'AUTH',
      'SERVER',
      'FAILED'
    ]
    const lines = codes.map((c) => attachError(c as Parameters<typeof attachError>[0]))
    expect(new Set(lines).size).toBe(codes.length)
    expect(lines.every(Boolean)).toBe(true)
  })
})

describe('relinkError', () => {
  it('words every code and never shows raw text', () => {
    const codes = ['IN_USE', 'ADOPTING', 'NOT_FOUND', 'BUSY', 'CONFIRM_MISSING']
    const lines = codes.map(relinkError)
    expect(new Set([...lines, relinkError('Album not found')]).size).toBe(codes.length + 1)
    for (const l of lines) expect(l).not.toMatch(/[A-Z]{2,}_|ADOPTING/)
    expect(relinkError('ENOENT: no such file')).not.toMatch(/ENOENT/)
    expect(relinkError(undefined)).toBe(relinkError('?'))
  })
})
