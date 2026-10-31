import { describe, it, expect } from 'vitest'
import { tagLabel, tagCounts, withTags, searchTags } from './tags'

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
