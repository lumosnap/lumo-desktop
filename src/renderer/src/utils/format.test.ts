import { describe, it, expect } from 'vitest'
import { albumDay, currentPlanOf, fileManager, fileSize, localDay, planPrice } from './format'

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

describe('planPrice', () => {
  it('reads whole dollars, and nothing as Free', () => {
    expect(['5', '4.99', '12.5', '0.00', '0', '', 'x'].map(planPrice)).toEqual([
      '$5',
      '$4.99',
      '$12.50',
      'Free',
      'Free',
      'Free',
      'Free'
    ])
  })
})

describe('currentPlanOf', () => {
  const plans = [
    { displayName: 'Starter', priceMonthly: '0.00', imageLimit: 500 },
    { displayName: 'Pro Plan', priceMonthly: '5', imageLimit: 5000 }
  ]
  const on = (planName: string, imageLimit = 500): { planName: string; imageLimit: number } => ({
    planName,
    imageLimit
  })
  it('finds the plan by name, and the free plan for Trial (no subscription)', () => {
    expect(currentPlanOf(plans, on('Pro Plan', 5000))).toBe(plans[1])
    expect(currentPlanOf(plans, on('Trial'))).toBe(plans[0])
    expect(currentPlanOf(plans, undefined)).toBeUndefined()
  })
  it('a retired paid plan, or a Trial with another limit, is not the free plan', () => {
    expect(currentPlanOf(plans, on('Gold', 20000))).toBeUndefined()
    expect(currentPlanOf(plans, on('Trial', 1000))).toBeUndefined()
  })
})

describe('fileSize', () => {
  it('counts 1024 to a unit, with one decimal under 10', () => {
    const MB = 1024 ** 2
    expect([1, NaN, -5].map(fileSize)).toEqual(['1 byte', '', ''])
    expect([512, 2048, 840 * MB, 2.34 * 1024 * MB, 1023.8 * MB, 9.97 * MB].map(fileSize)).toEqual([
      '512 bytes',
      '2.0 KB',
      '840 MB',
      '2.3 GB',
      '1.0 GB',
      '10 MB'
    ])
  })
})
