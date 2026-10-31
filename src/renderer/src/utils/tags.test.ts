import { describe, it, expect } from 'vitest'
import {
  tagLabel,
  tagCounts,
  withTags,
  searchTags,
  tagCountsFor,
  slugify,
  groupVocab,
  PRESETS,
  presetSlugs,
  CATEGORIES,
  listSome,
  pickerGroups,
  tagSavePlan,
  sameSet
} from './tags'
import { TAGS } from '../../../main/tags/vocabulary'

const imgs = [
  { id: 1, tags: ['bride', 'haldi', 'portrait'] },
  { id: 2, tags: ['bride', 'haldi'] },
  { id: 3, tags: ['groom', 'portrait'] },
  { id: 4, tags: [] },
  { id: 5 }
]

describe('tagLabel', () => {
  it('maps known slugs and title-cases the rest', () => {
    expect(tagLabel('black-and-white')).toBe('Black & white')
    expect(tagLabel('sadya')).toBe('Sadya')
    expect(tagLabel('some-new-tag')).toBe('Some New Tag')
  })
})

describe('tagCounts', () => {
  it('counts and sorts by frequency, ties by label', () => {
    expect(tagCounts(imgs)).toEqual([
      ['bride', 2],
      ['haldi', 2],
      ['portrait', 2],
      ['groom', 1]
    ])
    expect(tagCounts([])).toEqual([])
  })
})

describe('withTags', () => {
  it('ANDs the selection and keeps order', () => {
    expect(withTags(imgs, []).length).toBe(5)
    expect(withTags(imgs, ['bride']).map((i) => i.id)).toEqual([1, 2])
    expect(withTags(imgs, ['bride', 'portrait']).map((i) => i.id)).toEqual([1])
    expect(withTags(imgs, ['bride', 'groom'])).toEqual([])
  })
})

describe('searchTags', () => {
  const entries: [string, number][] = [
    ['candid', 9],
    ['dance', 5],
    ['mehendi-hands', 4],
    ['mehendi', 3],
    ['black-and-white', 1]
  ]
  it('word-prefix matches first, then substrings, by slug or label', () => {
    expect(searchTags(entries, 'and').map((e) => e[0])).toEqual([
      'black-and-white',
      'candid',
      'mehendi-hands'
    ])
    expect(searchTags(entries, 'Hand').map((e) => e[0])).toEqual(['mehendi-hands'])
    expect(searchTags(entries, 'meh').map((e) => e[0])).toEqual(['mehendi-hands', 'mehendi'])
    expect(searchTags(entries, '  ').length).toBe(5)
    expect(searchTags(entries, 'xyz')).toEqual([])
  })
})

describe('tagCountsFor', () => {
  it('counts only the selected images', () => {
    expect(tagCountsFor(imgs, new Set([1, 3, 5]))).toEqual([
      ['portrait', 2],
      ['bride', 1],
      ['groom', 1],
      ['haldi', 1]
    ])
    expect(tagCountsFor(imgs, new Set())).toEqual([])
  })
})

describe('slugify', () => {
  it('lowercases, dashes spaces, drops the rest, caps at 40', () => {
    expect(slugify('  First Dance ')).toBe('first-dance')
    expect(slugify('Ammu’s  Saree!!')).toBe('ammus-saree')
    expect(slugify('--a__b--')).toBe('a-b')
    expect(slugify('മലയാളം')).toBe('')
    const long = slugify('x'.repeat(39) + ' yz')
    expect(long).toBe('x'.repeat(39))
    expect(slugify('y'.repeat(60))).toHaveLength(40)
    expect(slugify('Mehendi Hands')).toMatch(/^[a-z0-9-]{1,40}$/)
  })
})

const vocab = TAGS.map((t) => ({ slug: t.slug, label: tagLabel(t.slug), category: t.category }))

describe('PRESETS', () => {
  it('only name real slugs, and none excludes a tag twice', () => {
    const slugs = new Set(TAGS.map((t) => t.slug))
    for (const p of PRESETS) {
      expect(p.exclude.filter((s) => !slugs.has(s))).toEqual([])
      expect(new Set(p.exclude).size).toBe(p.exclude.length)
    }
  })
  it('turn on the pack minus the excluded tags', () => {
    const pack = vocab.map((t) => t.slug)
    const christian = presetSlugs(PRESETS.find((p) => p.name === 'Christian')!.exclude, pack)
    expect(christian).toContain('church-wedding')
    expect(christian).not.toContain('pheras')
    expect(presetSlugs(['pheras'], ['bride', 'pheras'])).toEqual(['bride'])
  })
})

describe('groupVocab', () => {
  it('groups by category in order and filters by label or slug', () => {
    expect(new Set(TAGS.map((t) => t.category))).toEqual(new Set(CATEGORIES.map((c) => c[0])))
    expect(groupVocab(vocab).map((g) => g.category)).toEqual(CATEGORIES.map((c) => c[0]))
    expect(groupVocab(vocab, 'Church').map((g) => [g.category, g.tags.map((t) => t.slug)])).toEqual(
      [
        ['events', ['church-wedding']],
        ['settings', ['church']]
      ]
    )
    expect(groupVocab(vocab, 'zzz')).toEqual([])
  })
})

describe('listSome', () => {
  it('names a few and counts the rest', () => {
    expect(listSome(['A'])).toBe('A')
    expect(listSome(['A', 'B', 'C'])).toBe('A, B and C')
    expect(listSome(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C, D and E')
    expect(listSome(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B, C, D and 2 more')
  })
})

describe('pickerGroups', () => {
  const v = [
    { slug: 'bride', label: 'Bride', category: 'people' },
    { slug: 'stage', label: 'Stage', category: 'settings' },
    { slug: 'cake', label: 'Cake', category: 'things' },
    { slug: 'balloons', label: 'Balloons', category: 'things' }
  ]
  it('puts the active tags first by category, then the rest as More tags', () => {
    expect(
      pickerGroups(v, ['bride', 'stage']).map((g) => [g.label, g.tags.map((t) => t.slug)])
    ).toEqual([
      ['People', ['bride']],
      ['Settings', ['stage']],
      ['More tags', ['balloons', 'cake']]
    ])
  })
  it('filters both parts and drops empty groups', () => {
    expect(pickerGroups(v, ['bride'], 'ca').map((g) => g.label)).toEqual(['More tags'])
    expect(
      pickerGroups(
        v,
        v.map((t) => t.slug)
      ).some((g) => g.category === 'more')
    ).toBe(false)
  })
})

describe('tagSavePlan', () => {
  const cfg = { eventType: 'wedding', enabled: null, pack: ['bride', 'groom', 'haldi'] }
  it('sends a new event type alone', () => {
    expect(tagSavePlan(cfg, 'birthday', ['bride'])).toEqual({ eventType: 'birthday' })
  })
  it('sends nothing when nothing changed', () => {
    expect(tagSavePlan(cfg, 'wedding', null)).toEqual({})
    expect(tagSavePlan(cfg, 'wedding', ['haldi', 'groom', 'bride'])).toEqual({})
    expect(tagSavePlan({ ...cfg, enabled: ['bride'] }, 'wedding', ['bride'])).toEqual({})
  })
  it('sends a chosen set, or null to follow the pack again', () => {
    expect(tagSavePlan(cfg, 'wedding', ['bride'])).toEqual({ enabled: ['bride'] })
    expect(tagSavePlan({ ...cfg, enabled: ['bride'] }, 'wedding', null)).toEqual({ enabled: null })
    expect(tagSavePlan({ ...cfg, enabled: ['bride'] }, 'wedding', [...cfg.pack])).toEqual({
      enabled: null
    })
  })
  it('compares as sets', () => {
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameSet(['a'], ['a', 'b'])).toBe(false)
  })
})
