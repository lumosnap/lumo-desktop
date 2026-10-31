import { describe, it, expect } from 'vitest'
import { toLocalLists, cleanLists, type ServerList } from './lists'

const list = (over: Partial<ServerList> = {}): ServerList => ({
  id: 'a',
  name: 'Main album',
  position: 0,
  maxPicks: 300,
  deadline: null,
  setLimits: null,
  clients: [],
  ...over
})

describe('toLocalLists', () => {
  const images = [
    { id: 1, serverId: 101 },
    { id: 2, serverId: 102 },
    { id: 3, serverId: null }
  ]

  it('maps server image ids to local ids and keeps the real count', () => {
    const [l] = toLocalLists(
      [list({ clients: [{ clientName: 'Anjali', imageIds: [102, 101, 999], submittedAt: 5 }] })],
      images
    )
    expect(l.clients[0]).toEqual({
      clientName: 'Anjali',
      imageIds: [2, 1],
      count: 3,
      submittedAt: 5
    })
  })

  it('orders lists by position', () => {
    const out = toLocalLists(
      [list({ id: 'b', position: 1 }), list({ id: 'a', position: 0 })],
      images
    )
    expect(out.map((l) => l.id)).toEqual(['a', 'b'])
  })
})

describe('cleanLists', () => {
  it('trims names, renumbers positions and drops bad limits', () => {
    expect(
      cleanLists([
        {
          id: 'x',
          name: '  Parents  ',
          position: 7,
          maxPicks: 0,
          deadline: 10,
          setLimits: [
            { setId: 's', max: 40 },
            { setId: 't', max: -1 }
          ]
        }
      ])
    ).toEqual([
      {
        id: 'x',
        name: 'Parents',
        position: 0,
        maxPicks: null,
        deadline: 10,
        setLimits: [{ setId: 's', max: 40 }]
      }
    ])
  })

  it('refuses a blank name and more than 20 lists', () => {
    expect(() => cleanLists([{ id: 'x', name: ' ' }])).toThrow()
    expect(() =>
      cleanLists(Array.from({ length: 21 }, (_, i) => ({ id: `${i}`, name: 'a' })))
    ).toThrow()
  })
})
