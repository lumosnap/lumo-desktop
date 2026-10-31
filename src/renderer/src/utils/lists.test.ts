import { describe, it, expect } from 'vitest'
import {
  pickersByImage,
  listsByImage,
  progress,
  sentText,
  limitsText,
  listSummary,
  dateValue,
  endOfDay,
  picksLost,
  EVERYONE,
  type List
} from './lists'

const client = (clientName: string, imageIds: number[], submittedAt: number | null = null) => ({
  clientName,
  imageIds,
  count: imageIds.length,
  submittedAt
})
const main: List = {
  id: 'm',
  name: 'Main album',
  position: 0,
  maxPicks: 3,
  deadline: null,
  setLimits: [{ setId: 'h', max: 1 }],
  clients: [client('Anjali', [1, 2, 3]), client('Rahul', [2, 3]), client('Lakshmi', [3, 4])]
}
const sets = [{ id: 'h', name: 'Haldi', imageIds: [1, 2, 9] }]

describe('pickersByImage', () => {
  it('merges who picked each photo', () => {
    const by = pickersByImage(main)
    expect(by.get(3)).toEqual(['Anjali', 'Rahul', 'Lakshmi'])
    expect(by.get(4)).toEqual(['Lakshmi'])
    expect(by.size).toBe(4)
  })
  it('keeps one client, or the photos everyone picked', () => {
    expect([...pickersByImage(main, 'Rahul').keys()]).toEqual([2, 3])
    expect([...pickersByImage(main, EVERYONE).keys()]).toEqual([3])
  })
})

describe('listsByImage', () => {
  it('names each list a photo is in, once', () => {
    const parents: List = { ...main, id: 'p', name: 'Parents', clients: [client('Anjali', [3])] }
    const by = listsByImage([main, parents])
    expect(by.get(3)).toEqual(['Main album', 'Parents'])
    expect(by.get(1)).toEqual(['Main album'])
  })
})

describe('progress', () => {
  it('counts picks per set against its limit', () => {
    const p = progress(main, main.clients[0], sets)
    expect(p).toMatchObject({ count: 3, max: 3, over: false })
    expect(p.perSet).toEqual([{ name: 'Haldi', count: 2, max: 1, over: true }])
  })
  it('uses the real count, photos missing here too', () => {
    expect(progress(main, { ...main.clients[1], count: 5 }, sets).over).toBe(true)
  })
  it('is overdue only past the deadline and not sent', () => {
    const due = { ...main, deadline: 1000 }
    expect(progress(due, main.clients[0], sets, 2000).overdue).toBe(true)
    expect(progress(due, client('A', [], 1500), sets, 2000).overdue).toBe(false)
    expect(progress(due, main.clients[0], sets, 500).overdue).toBe(false)
  })
  it('says sent, late or not yet', () => {
    const d = new Date(2026, 9, 31).getTime()
    expect(sentText(progress(main, client('A', [], d), sets), null)).toBe('Sent 31 Oct')
    expect(sentText(progress({ ...main, deadline: d }, main.clients[0], sets, d + 1), d)).toBe(
      'Not sent · was due 31 Oct'
    )
    expect(sentText(progress(main, main.clients[0], sets), null)).toBe('Not sent yet')
  })
})

describe('limitsText', () => {
  it('reads like the photographer would say it', () => {
    expect(
      limitsText({ ...main, maxPicks: 300, deadline: new Date(2026, 10, 15).getTime() }, sets)
    ).toBe('up to 300 · Haldi up to 1 · by 15 Nov')
    expect(limitsText({ ...main, maxPicks: null, setLimits: null }, sets)).toBe('no limit')
  })
})

describe('dates', () => {
  it('round-trips a date input to the end of that day', () => {
    const ms = endOfDay('2026-11-15')!
    expect(new Date(ms).getHours()).toBe(23)
    expect(dateValue(ms)).toBe('2026-11-15')
    expect(endOfDay('')).toBeNull()
    expect(dateValue(null)).toBe('')
  })
})

describe('picksLost', () => {
  it('lists the removed lists clients already picked in', () => {
    const empty: List = { ...main, id: 'e', name: 'Empty', clients: [client('A', [])] }
    expect(picksLost([main, empty], [])).toEqual([
      { name: 'Main album', picks: 7, clients: ['Anjali', 'Rahul', 'Lakshmi'] }
    ])
    expect(picksLost([main], [main])).toEqual([])
  })
})

describe('listSummary', () => {
  it('says how many sent and how many are late', () => {
    const c = (sent: boolean) => ({
      clientName: 'x',
      imageIds: [],
      count: 0,
      submittedAt: sent ? 1 : null
    })
    const l = { ...main, deadline: 1000, clients: [c(true), c(false), c(false)] }
    expect(listSummary(l, 2000)).toEqual({ text: '1 of 3 sent · 2 late', late: true })
    expect(listSummary(l, 500)).toEqual({ text: '1 of 3 sent', late: false })
    expect(listSummary({ ...l, clients: [c(true), c(true)] }, 2000).text).toBe('All 2 sent')
    expect(listSummary({ ...l, clients: [] }).text).toBe('')
  })
})
