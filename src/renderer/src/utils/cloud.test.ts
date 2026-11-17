import { describe, it, expect } from 'vitest'
import {
  addFromLabel,
  attachedNote,
  attachError,
  foundNote,
  foundWhere,
  newlyFound,
  relinkError
} from './cloud'
import type { CloudAlbum } from '../../../main/ipc/cloud'

const album = (id: string, found?: CloudAlbum['found']): CloudAlbum =>
  ({ id, title: id, eventDate: null, totalImages: 1, thumbnailUrl: null, found }) as CloudAlbum

describe('albums on a plugged-in drive', () => {
  const nn = { folder: '/Volumes/NO NAME/2026/Asha & Rohan', drive: 'NO NAME' }
  const win = { folder: 'E:\\Shoots\\Asha & Rohan\\', drive: null }
  it('names the drive, else the folder', () => {
    expect(addFromLabel(nn)).toBe('Add from “NO NAME”')
    expect(addFromLabel(win)).toBe('Add from “Asha & Rohan”')
    expect(addFromLabel({ ...win, drive: '' })).toBe('Add from “Asha & Rohan”')
    expect(foundWhere(nn)).toBe('In “Asha & Rohan” on “NO NAME”')
    expect(foundWhere(win)).toBe('In “Asha & Rohan” on a plugged-in drive')
  })
  it('newlyFound: only albums that were not on a drive before', () => {
    const before = [album('a', nn), album('b')]
    const after = [album('a', nn), album('b', nn), album('c', nn), album('d')]
    expect(newlyFound(before, after).map((c) => c.id)).toEqual(['b', 'c'])
    expect(newlyFound(after, [album('a')])).toEqual([])
  })
  it('foundNote: one or many, one drive or several', () => {
    expect(foundNote([album('A', nn)])).toBe(
      'Found “A” on “NO NAME”. It isn’t on this computer yet.'
    )
    expect(foundNote([album('A', win)])).toBe(
      'Found “A” on a drive you plugged in. It isn’t on this computer yet.'
    )
    expect(foundNote([album('A', nn), album('B', nn)])).toBe(
      '“NO NAME” has 2 of your albums that aren’t on this computer.'
    )
    expect(foundNote([album('A', win), album('B', win)])).toBe(
      'A drive you plugged in has 2 of your albums that aren’t on this computer.'
    )
    expect(foundNote([album('A', nn), album('B', { folder: '/x', drive: 'EOS_DIGITAL' })])).toBe(
      'The drives you plugged in have 2 of your albums that aren’t on this computer.'
    )
  })
})

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
