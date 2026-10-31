import { describe, it, expect } from 'vitest'
import {
  columnsForWidth,
  flattenRows,
  momentLabel,
  momentSetName,
  moved,
  inSet,
  orderForGrouping,
  type GroupableImage
} from './grid'

const img = (id: number, extra: Partial<GroupableImage> = {}): GroupableImage => ({
  id,
  capturedAt: null,
  burstId: null,
  isBurstCover: null,
  momentId: null,
  ...extra
})
const ids = (r: ReturnType<typeof flattenRows>): unknown[] =>
  r.rows.map((row) => (row.kind === 'header' ? 'H' : row.tiles.map((t) => t.image.id)))

describe('columnsForWidth', () => {
  it('matches the auto-fill grid in main.css', () => {
    expect(columnsForWidth(190, 1400)).toBe(1)
    expect(columnsForWidth(1000, 1400)).toBe(5) // (1000+8)/(198)
    expect(columnsForWidth(1000, 1100)).toBe(6) // 150px tracks under 1180px
  })
})

describe('flattenRows', () => {
  it('all-null fields -> flat rows, no headers', () => {
    const r = flattenRows(
      [1, 2, 3, 4, 5, 6, 7].map((i) => img(i)),
      { columns: 3, stackBursts: true }
    )
    expect(ids(r)).toEqual([[1, 2, 3], [4, 5, 6], [7]])
    expect(r.headers).toEqual([])
    expect(r.tiles.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(r.tileRow).toEqual([0, 0, 0, 1, 1, 1, 2])
  })

  it('moments -> a header row before each section', () => {
    const t = (h: number, m: number): number => Date.UTC(2026, 9, 31, h, m)
    const list = [
      img(1, { momentId: 'a', capturedAt: t(16, 12) }),
      img(2, { momentId: 'a', capturedAt: t(16, 47) }),
      img(3, { momentId: 'a', capturedAt: t(16, 30) }),
      img(4, { momentId: 'b', capturedAt: t(18, 0) })
    ]
    const r = flattenRows(list, { columns: 2, stackBursts: true })
    expect(ids(r)).toEqual(['H', [1, 2], [3], 'H', [4]])
    expect(r.headers.map((h) => h.row)).toEqual([0, 3])
    expect(r.headers[0].label).toBe('Sat 31 Oct · 4:12–4:47 PM · 3 photos')
    expect(r.tileRow).toEqual([1, 1, 2, 4])
  })

  it('bursts collapse to the cover, or expand when not stacking', () => {
    const list = [
      img(1),
      img(2, { burstId: 'x' }),
      img(3, { burstId: 'x', isBurstCover: true }),
      img(4, { burstId: 'x' }),
      img(5, { burstId: 'solo' })
    ]
    const stacked = flattenRows(list, { columns: 10, stackBursts: true })
    expect(ids(stacked)).toEqual([[1, 3, 5]])
    expect(stacked.tiles[1].burst?.map((f) => f.id)).toEqual([2, 3, 4])
    expect(stacked.tiles[2].burst).toBeUndefined() // a one-frame burst is just a photo
    const open = flattenRows(list, { columns: 10, stackBursts: false })
    expect(ids(open)).toEqual([[1, 2, 3, 4, 5]])
    expect(open.tiles.every((t) => !t.burst)).toBe(true)
  })

  it('labels', () => {
    const d = (h: number, m: number): number => Date.UTC(2026, 9, 31, h, m)
    expect(momentLabel([d(11, 50), d(12, 20)], 1)).toBe('Sat 31 Oct · 11:50 AM–12:20 PM · 1 photo')
    expect(momentLabel([], 2)).toBe('Undated · 2 photos')
  })
})

describe('orderForGrouping', () => {
  const order = (list: GroupableImage[]): number[] => orderForGrouping(list).map((i) => i.id)

  it('keeps the input order when nothing is grouped', () => {
    const list = [img(3, { capturedAt: 9 }), img(1, { capturedAt: 1 }), img(2)]
    expect(orderForGrouping(list)).toBe(list)
  })

  it('sorts by capture time, moments by their earliest frame, undated last', () => {
    const list = [
      img(1, { momentId: 'b', capturedAt: 50 }),
      img(2, { momentId: 'a', capturedAt: 20 }),
      img(3, { momentId: 'b', capturedAt: 10 }),
      img(4, { momentId: 'a', capturedAt: 30 }),
      img(5, { momentId: 'b' }),
      img(6, { momentId: 'a', capturedAt: 20 }) // tie -> input order
    ]
    expect(order(list)).toEqual([3, 1, 5, 2, 6, 4])
  })

  it('keeps a burst contiguous at its earliest frame', () => {
    const list = [
      img(1, { momentId: 'm', capturedAt: 1, burstId: 'x' }),
      img(2, { momentId: 'm', capturedAt: 2 }),
      img(3, { momentId: 'm', capturedAt: 3, burstId: 'x' }),
      img(4, { momentId: 'm', capturedAt: 0 })
    ]
    expect(order(list)).toEqual([4, 1, 3, 2])
  })
})

describe('sets', () => {
  it('inSet keeps display order and passes through without a set', () => {
    const list = [img(3), img(1), img(2)]
    expect(inSet(list, null)).toBe(list)
    expect(inSet(list, [2, 3, 99]).map((i) => i.id)).toEqual([3, 2])
    expect(inSet(list, [])).toEqual([])
  })
  it('moved clamps at the ends', () => {
    expect(moved(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moved(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moved(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moved(['a', 'b'], 'x', 1)).toEqual(['a', 'b'])
  })
  it('momentSetName drops the photo count', () => {
    expect(momentSetName(momentLabel([Date.UTC(2026, 9, 31, 16, 12)], 1))).toBe(
      'Sat 31 Oct · 4:12 PM'
    )
    expect(momentSetName('Undated · 1,204 photos')).toBe('Undated')
  })
})
