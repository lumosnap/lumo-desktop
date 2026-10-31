import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  runMigrations,
  initDatabase,
  closeDatabase,
  createAlbum,
  createImagesBatch,
  deleteImages,
  deleteAlbum,
  getAlbum,
  listSets,
  createSet,
  addImagesToSet,
  removeImagesFromSet,
  setSetCover,
  reorderSets,
  deleteSet,
  clearSetsNeedPush,
  saveImageTags,
  saveImageEmbeddings,
  getAlbumEmbeddings,
  setTagOverride,
  getAlbumTagSet,
  setAlbumTagSet,
  setAlbumEventType,
  getAlbumTags,
  getImagesMissingEmbedding,
  getEmbeddedImageIds,
  getImage,
  updateImagesBatch,
  setPeopleEnabled,
  getPeopleProgress,
  saveImageFaces,
  rematchPeople,
  getAlbumPeople,
  getImageFaces,
  renamePerson,
  mergePeople,
  removePerson,
  reviewFaces,
  assignFace,
  setPersonCover,
  setClientPerson,
  getClientPeople,
  hasPerson,
  getImageNotes,
  setImageNote,
  getAlbumNote,
  setAlbumNote,
  getImageDone,
  setImageDone
} from './database'

// better-sqlite3 is rebuilt for Electron's ABI by postinstall; skip under plain Node if it won't load
let loadable = true
try {
  new Database(':memory:').close()
} catch {
  loadable = false
}

describe.skipIf(!loadable)('runMigrations', () => {
  it('upgrades a legacy schema and is idempotent', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE albums (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE images (id INTEGER PRIMARY KEY, albumId TEXT NOT NULL, uploadStatus TEXT);
    `)

    runMigrations(db)
    runMigrations(db)

    const cols = (t: string): string[] =>
      (db.pragma(`table_info(${t})`) as Array<{ name: string }>).map((c) => c.name)
    expect(db.pragma('user_version', { simple: true })).toBe(13)
    expect(cols('albums')).toContain('private_note')
    expect(cols('albums')).toContain('vectors_hash')
    expect(cols('albums')).toContain('vectors_ids')
    expect(cols('image_notes')).toEqual(['image_id', 'body', 'updated_at'])
    expect(cols('image_done')).toEqual(['image_id', 'done_at'])
    expect(cols('albums')).toEqual(
      expect.arrayContaining(['startTime', 'endTime', 'isOrphaned', 'albumType'])
    )
    expect(cols('images')).toEqual(
      expect.arrayContaining([
        'serverId',
        'captured_at',
        'burst_id',
        'thumbhash',
        'sharpness',
        'camera_id',
        'rating',
        'needs_push',
        'tags_need_push'
      ])
    )
    expect(cols('albums')).toContain('sets_need_push')
    expect(cols('album_sets')).toEqual(
      expect.arrayContaining(['id', 'album_id', 'name', 'position', 'cover_image_id'])
    )
    expect(cols('set_images')).toEqual(['set_id', 'image_id', 'position'])
    expect(cols('image_embeddings')).toEqual(['image_id', 'model', 'vec'])
    expect(cols('image_tags')).toEqual(['image_id', 'tag', 'score'])
    expect(cols('albums')).toEqual(expect.arrayContaining(['tag_set', 'tags_scored']))
    expect(cols('image_tag_overrides')).toEqual(['image_id', 'tag', 'action'])
    expect(cols('albums')).toContain('event_type')
    expect(cols('albums')).toEqual(expect.arrayContaining(['people_enabled', 'people_need_push']))
    expect(cols('images')).toContain('faces_scanned')
    expect(cols('faces')).toEqual([
      'id',
      'image_id',
      'box',
      'score',
      'landmarks',
      'vec',
      'person_id',
      'source'
    ])
    expect(cols('people')).toEqual(['id', 'album_id', 'name', 'hidden', 'cover_face_id'])
    expect(cols('face_rejections')).toEqual(['face_id', 'person_id'])
    expect(cols('face_overrides')).toEqual([])
    expect(cols('client_people')).toEqual(['album_id', 'client_name', 'person_id'])
    db.close()
  })

  it('9: drops unnamed people from clustering; faces of named people become references', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE albums (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE images (id INTEGER PRIMARY KEY, albumId TEXT NOT NULL, uploadStatus TEXT);
    `)
    runMigrations(db, 8)
    db.exec(`
      INSERT INTO albums (id, title) VALUES ('a', 'a');
      INSERT INTO images (id, albumId) VALUES (1, 'a');
      INSERT INTO people (id, album_id, name) VALUES ('named', 'a', 'Bride'), ('anon', 'a', NULL);
      INSERT INTO faces (id, image_id, box, score, landmarks, vec, person_id) VALUES
        (1, 1, '[]', 1, '[]', x'00', 'named'), (2, 1, '[]', 1, '[]', x'00', 'anon'),
        (3, 1, '[]', 1, '[]', x'00', NULL);
      INSERT INTO face_overrides (face_id, person_id) VALUES (3, NULL);
      INSERT INTO client_people (album_id, client_name, person_id) VALUES ('a', 'Anu', 'anon');
    `)
    runMigrations(db)
    expect(db.prepare('SELECT id, name FROM people').all()).toEqual([
      { id: 'named', name: 'Bride' }
    ])
    expect(db.prepare('SELECT id, person_id, source FROM faces ORDER BY id').all()).toEqual([
      { id: 1, person_id: 'named', source: 'ref' },
      { id: 2, person_id: null, source: null },
      { id: 3, person_id: null, source: null }
    ])
    expect(db.prepare('SELECT * FROM client_people').all()).toEqual([])
    db.close()
  })
})

function album(id: string): void {
  createAlbum({
    id,
    title: id,
    eventDate: null,
    startTime: null,
    endTime: null,
    localFolderPath: '/x',
    sourceFolderPath: '/y',
    albumType: 'standalone',
    totalImages: 0,
    lastSyncedAt: null,
    needsSync: 0,
    isOrphaned: 0
  })
}

function mk(albumId: string, n: number): number[] {
  return createImagesBatch(
    Array.from({ length: n }, (_, i) => ({
      albumId,
      serverId: null,
      originalFilename: `${albumId}${i}.jpg`,
      localFilePath: `/x/${albumId}${i}.jpg`,
      fileSize: 1,
      width: 1,
      height: 1,
      mtime: '',
      sourceFileHash: null,
      uploadStatus: 'pending' as const,
      uploadOrder: i
    }))
  ).map((img) => img.id)
}

describe.skipIf(!loadable)('ai tags', () => {
  it('stores embeddings + tags, marks changed tags for push, cascades', () => {
    initDatabase(':memory:')
    album('a')
    const [i1, i2, i3] = mk('a', 3)
    const vec = Float32Array.from([1, 0, 0])
    const save = (id: number, tags: string[]): number =>
      saveImageTags([{ imageId: id, tags: tags.map((tag, k) => ({ tag, score: 1 - k / 10 })) }])

    expect(
      saveImageEmbeddings('m1', [
        { imageId: i1, vec },
        { imageId: i2, vec }
      ])
    ).toBe(2)
    expect(getImage(i2)!.tags_need_push).toBe(1) // first embedding pushes even with no tags
    expect(getAlbumEmbeddings('a', 'm1').map((e) => [e.imageId, [...e.vec]])).toEqual([
      [i1, [1, 0, 0]],
      [i2, [1, 0, 0]]
    ])
    expect(save(i1, ['bride', 'haldi'])).toBe(1)
    expect(getImagesMissingEmbedding('a', 'm1').map((r) => r.id)).toEqual([i3])
    expect(getImagesMissingEmbedding('a', 'm2').map((r) => r.id)).toEqual([i1, i2, i3])
    expect(getAlbumTags('a')).toEqual(new Map([[i1, ['bride', 'haldi']]]))
    expect([...getEmbeddedImageIds('a')]).toEqual([i1, i2])
    expect(getImage(i1)!.tags_need_push).toBe(1)
    expect(getImage(i3)!.tags_need_push).toBe(0)

    updateImagesBatch([{ id: i1, changes: { tags_need_push: 0 } }])
    expect(save(i1, ['bride', 'haldi'])).toBe(0) // same tags: no push
    expect(getImage(i1)!.tags_need_push).toBe(0)
    expect(save(i1, ['groom'])).toBe(1)
    expect(getAlbumTags('a').get(i1)).toEqual(['groom'])

    deleteImages([i1])
    expect(getAlbumTags('a').size).toBe(0)
    expect(save(i1, [])).toBe(0) // deleted meanwhile
    expect(saveImageEmbeddings('m1', [{ imageId: i1, vec }])).toBe(0)
    closeDatabase()
  })

  it('manual overrides survive re-scoring; album tag set round-trips', () => {
    initDatabase(':memory:')
    album('a')
    album('b')
    const [i1, i2] = mk('a', 2)
    const [j1] = mk('b', 1)
    saveImageTags([
      {
        imageId: i1,
        tags: [
          { tag: 'bride', score: 2 },
          { tag: 'indoor', score: 1 }
        ]
      }
    ])
    updateImagesBatch([{ id: i1, changes: { tags_need_push: 0 } }])

    setTagOverride('a', [i1, i2, j1], 'my-tag', 'add') // j1 is in another album: ignored
    setTagOverride('a', [i1], 'indoor', 'remove')
    expect(getImage(i1)!.tags_need_push).toBe(1)
    expect(getAlbumTags('a')).toEqual(
      new Map([
        [i1, ['my-tag', 'bride']],
        [i2, ['my-tag']]
      ])
    )
    expect(getAlbumTags('b').size).toBe(0)

    // Re-scoring replaces AI tags only
    saveImageTags([
      {
        imageId: i1,
        tags: [
          { tag: 'indoor', score: 3 },
          { tag: 'groom', score: 1 }
        ]
      }
    ])
    expect(getAlbumTags('a').get(i1)).toEqual(['my-tag', 'groom'])

    setTagOverride('a', [i1], 'my-tag', 'remove') // replaces the add
    setTagOverride('a', [i1], 'indoor', 'add') // replaces the remove
    expect(getAlbumTags('a').get(i1)).toEqual(['indoor', 'groom'])

    expect(getAlbumTagSet('a')).toBeNull()
    setAlbumTagSet('a', ['bride', 'groom'])
    expect(getAlbumTagSet('a')).toEqual(['bride', 'groom'])
    setAlbumTagSet('a', null)
    expect(getAlbumTagSet('a')).toBeNull()

    expect(getAlbum('a')!.event_type).toBeNull() // pre-event-type albums: wedding
    setAlbumTagSet('a', ['bride'])
    setAlbumEventType('a', 'birthday')
    expect(getAlbum('a')!.event_type).toBe('birthday')
    expect(getAlbumTagSet('a')).toBeNull() // back to the pack default

    deleteImages([i1])
    expect(getAlbumTags('a')).toEqual(new Map([[i2, ['my-tag']]]))
    closeDatabase()
  })
})

describe.skipIf(!loadable)('sets', () => {
  it('CRUD, dirty counter and cascades', () => {
    initDatabase(':memory:')
    album('a')
    album('b')
    const [i1, i2, i3] = mk('a', 3)
    const [other] = mk('b', 1)

    const s1 = createSet('a', 'Ceremony', [i1, i2, other]) // other album's image ignored
    const s2 = createSet('a', 'Party')
    expect(listSets('a').map((s) => [s.name, s.position, s.imageIds])).toEqual([
      ['Ceremony', 0, [i1, i2]],
      ['Party', 1, []]
    ])

    addImagesToSet(s2, [i2, i3, i2])
    setSetCover(s1, i2)
    expect(() => setSetCover(s2, i1)).toThrow()
    removeImagesFromSet(s1, [i2]) // the cover leaves, so the cover clears
    expect(listSets('a')[0]).toMatchObject({ imageIds: [i1], coverImageId: null })

    reorderSets('a', [s2])
    expect(listSets('a').map((s) => s.id)).toEqual([s2, s1])

    // Dirty counter: a stale clear is ignored
    const seen = getAlbum('a')!.sets_need_push!
    expect(seen).toBeGreaterThan(0)
    createSet('a', 'Later')
    clearSetsNeedPush('a', seen)
    expect(getAlbum('a')!.sets_need_push).toBe(seen + 1)
    clearSetsNeedPush('a', seen + 1)
    expect(getAlbum('a')!.sets_need_push).toBe(0)

    // Image delete drops membership; set delete drops rows; album delete drops sets
    deleteImages([i3])
    expect(listSets('a')[0].imageIds).toEqual([i2])
    deleteSet(s1)
    expect(listSets('a').map((s) => s.name)).toEqual(['Party', 'Later'])
    deleteAlbum('a')
    expect(listSets('a')).toEqual([])
    closeDatabase()
  })
})

describe.skipIf(!loadable)('people', () => {
  const v = (k: number): Float32Array => {
    const out = new Float32Array(128)
    out[k] = 1
    return out
  }
  const face = (k: number): Parameters<typeof saveImageFaces>[1][number] => ({
    box: [0.1, 0.1, 0.2, 0.2],
    score: 0.9,
    landmarks: [0.15, 0.15, 0.25, 0.15, 0.2, 0.2, 0.16, 0.25, 0.24, 0.25],
    vec: v(k)
  })
  /** One-hot axis k mixed toward axis 100 + k: cosine `c` to v(k). */
  const near = (k: number, c: number): Parameters<typeof saveImageFaces>[1][number] => {
    const f = face(k)
    f.vec = new Float32Array(128)
    f.vec[k] = c
    f.vec[100 + k] = Math.sqrt(1 - c * c)
    return f
  }
  const pushCount = (id: string): number => getAlbum(id)!.people_need_push ?? 0
  const state = (albumId: string, imageId: number): Array<[string | null, string | null]> =>
    getImageFaces(albumId, imageId).map((f) => [f.name, f.source])

  it('references, auto matches, review answers, rejections; off deletes everything', () => {
    initDatabase(':memory:')
    album('a')
    const [i1, i2, i3] = mk('a', 3)
    expect(saveImageFaces(i1, [face(0)])).toBe(false) // People is off: nothing stored

    setPeopleEnabled('a', true)
    expect(saveImageFaces(i1, [face(0), face(1)])).toBe(true)
    expect(saveImageFaces(i2, [face(0), near(1, 0.4)])).toBe(true)
    expect(saveImageFaces(i3, [near(0, 0.3), face(2)])).toBe(true)
    expect(getPeopleProgress('a')).toEqual({ enabled: true, processed: 3, total: 3 })

    // Nobody picked yet: no people, nothing matched
    expect(rematchPeople('a').changed).toBe(0)
    expect(getAlbumPeople('a')).toEqual([])

    // Pick the two faces of photo 1
    const [f0, f1] = getImageFaces('a', i1)
    const bride = assignFace('a', f0.id, { newName: 'Bride' })!
    expect(assignFace('a', f1.id, { newName: 'bride' })).toBe(bride) // same name, any case
    const groom = assignFace('a', f1.id, { newName: 'Groom' })!
    let { review } = rematchPeople('a')
    expect(state('a', i1)).toEqual([
      ['Bride', 'ref'],
      ['Groom', 'ref']
    ])
    expect(state('a', i2)).toEqual([
      ['Bride', 'auto'],
      [null, null]
    ])
    expect(review.get(groom)!.map((r) => r.faceId)).toEqual([getImageFaces('a', i2)[1].id])
    expect(getAlbumPeople('a').map((p) => [p.name, p.faces.length])).toEqual([
      ['Bride', 2],
      ['Groom', 1]
    ])

    // Review: yes = reference; the 0.3 face stays below the review band for Bride
    const seen = pushCount('a')
    reviewFaces('a', groom, [{ faceId: getImageFaces('a', i2)[1].id, yes: true }])
    review = rematchPeople('a').review
    expect(review.get(groom)).toBeUndefined()
    expect(state('a', i2)[1]).toEqual(['Groom', 'ref'])
    expect(pushCount('a')).toBeGreaterThan(seen)

    // "Not Bride": rejected, never matched to Bride again
    const autoFace = getImageFaces('a', i2)[0]
    assignFace('a', autoFace.id, { none: true })
    rematchPeople('a')
    expect(state('a', i2)[0]).toEqual([null, null])
    // ...and a "no" in review is the same
    assignFace('a', autoFace.id, { personId: bride })
    reviewFaces('a', bride, [{ faceId: autoFace.id, yes: false }])
    rematchPeople('a')
    expect(state('a', i2)[0]).toEqual([null, null])

    // A cover that leaves its person stops being the cover
    setPersonCover('a', groom, f1.id)
    expect(() => setPersonCover('a', groom, f0.id)).toThrow()
    assignFace('a', f1.id, { personId: bride })
    rematchPeople('a') // Groom keeps one reference (photo 2), loses the cover
    expect(getAlbumPeople('a').find((p) => p.id === groom)!.coverFaceId).toBeNull()

    // A person whose last reference goes is removed
    assignFace('a', getImageFaces('a', i2)[1].id, { none: true })
    rematchPeople('a')
    expect(getAlbumPeople('a').map((p) => p.name)).toEqual(['Bride'])

    setClientPerson('a', 'Anu', bride)
    setPeopleEnabled('a', false)
    expect(getPeopleProgress('a')).toEqual({ enabled: false, processed: 0, total: 3 })
    expect(getImageFaces('a', i1)).toEqual([])
    expect(getAlbumPeople('a')).toEqual([])
    expect(getClientPeople('a')).toEqual({})
    expect(pushCount('a')).toBeGreaterThan(0) // so the server gets { people: [] }
    closeDatabase()
  })

  it('merge unions references and rejections; remove frees references', () => {
    initDatabase(':memory:')
    album('a')
    const [i1, i2] = mk('a', 2)
    setPeopleEnabled('a', true)
    saveImageFaces(i1, [face(0), face(1), face(2)])
    saveImageFaces(i2, [face(0), face(1)])
    const [a0, a1, a2] = getImageFaces('a', i1)
    const [b0, b1] = getImageFaces('a', i2)
    const anna = assignFace('a', a0.id, { newName: 'Anna' })!
    const anna2 = assignFace('a', a1.id, { newName: 'Anna 2' })!
    assignFace('a', a2.id, { newName: 'Ben' })
    reviewFaces('a', anna, [{ faceId: b1.id, yes: false }]) // b1 is not Anna...
    reviewFaces('a', anna2, [{ faceId: b0.id, yes: false }]) // ...b0 is not Anna 2
    rematchPeople('a')
    expect(state('a', i2)).toEqual([
      ['Anna', 'auto'],
      ['Anna 2', 'auto']
    ])
    setClientPerson('a', 'Anu', anna2)

    mergePeople('a', anna, [anna2])
    rematchPeople('a')
    const people = getAlbumPeople('a')
    expect(people.map((p) => p.name)).toEqual(['Anna', 'Ben'])
    expect(state('a', i1)).toEqual([
      ['Anna', 'ref'],
      ['Anna', 'ref'],
      ['Ben', 'ref']
    ])
    // Both rejections now hold for Anna
    expect(state('a', i2)).toEqual([
      [null, null],
      [null, null]
    ])
    expect(getClientPeople('a')).toEqual({ Anu: anna })

    // Anna's own reference was once rejected for her: confirming it clears the rejection
    assignFace('a', b1.id, { personId: anna })
    rematchPeople('a')
    expect(state('a', i2)[1]).toEqual(['Anna', 'ref'])

    removePerson('a', anna)
    rematchPeople('a')
    renamePerson('a', people[1].id, 'Benny')
    expect(getAlbumPeople('a').map((p) => p.name)).toEqual(['Benny'])
    expect(state('a', i1)).toEqual([
      [null, null],
      [null, null],
      ['Benny', 'ref']
    ])
    expect(getClientPeople('a')).toEqual({})
    closeDatabase()
  })

  it('photo deletion cascades; a person without references goes', () => {
    initDatabase(':memory:')
    album('a')
    const [i1] = mk('a', 1)
    setPeopleEnabled('a', true)
    saveImageFaces(i1, [face(0)])
    const id = assignFace('a', getImageFaces('a', i1)[0].id, { newName: 'Father' })!
    expect(getAlbumPeople('a')).toMatchObject([{ id, name: 'Father' }])
    deleteImages([i1])
    rematchPeople('a')
    expect(getAlbumPeople('a')).toEqual([])
    expect(hasPerson('a', id)).toBe(false)
    closeDatabase()
  })
})

describe.skipIf(!loadable)('private notes', () => {
  it('saves, edits, deletes on empty, stays in its album and cascades', () => {
    initDatabase(':memory:')
    album('a')
    album('b')
    const [i1, i2] = mk('a', 2)
    const [j1] = mk('b', 1)
    setImageNote('a', i1, 'Retouch the stray hair')
    setImageNote('a', i2, 'Print 12x18')
    setImageNote('a', i2, 'Print 16x24')
    setImageNote('b', j1, 'Other album')
    expect(getImageNotes('a')).toEqual({ [i1]: 'Retouch the stray hair', [i2]: 'Print 16x24' })
    setImageNote('a', i1, '   ')
    expect(getImageNotes('a')).toEqual({ [i2]: 'Print 16x24' })
    expect(() => setImageNote('a', j1, 'x')).toThrow()
    deleteImages([i2])
    expect(getImageNotes('a')).toEqual({})
    expect(getImageNotes('b')).toEqual({ [j1]: 'Other album' })

    expect(getAlbumNote('a')).toBe('')
    setAlbumNote('a', 'Couple wants the haldi warm')
    expect(getAlbumNote('a')).toBe('Couple wants the haldi warm')
    setAlbumNote('a', '')
    expect(getAlbumNote('a')).toBe('')
    expect(() => setAlbumNote('zz', 'x')).toThrow()
    deleteAlbum('b')
    expect(getImageNotes('b')).toEqual({})
    closeDatabase()
  })
})

describe.skipIf(!loadable)('done marks', () => {
  it('marks and unmarks in bulk, stays in its album and cascades', () => {
    initDatabase(':memory:')
    album('a')
    album('b')
    const [i1, i2, i3] = mk('a', 3)
    const [j1] = mk('b', 1)
    const at = setImageDone('a', [i1, i2], true)
    expect(getImageDone('a')).toEqual({ [i1]: at, [i2]: at })
    setImageDone('a', [i1], true) // again: still done, time moves on
    expect(Object.keys(getImageDone('a'))).toHaveLength(2)
    setImageDone('a', [i2, i3], false) // i3 was never done: no error
    expect(Object.keys(getImageDone('a'))).toEqual([String(i1)])
    // a photo from another album rolls back the whole batch
    expect(() => setImageDone('a', [i3, j1], true)).toThrow()
    expect(getImageDone('a')[i3]).toBeUndefined()
    expect(getImageDone('b')).toEqual({})
    deleteImages([i1])
    expect(getImageDone('a')).toEqual({})
    setImageDone('b', [j1], true)
    deleteAlbum('b')
    expect(getImageDone('b')).toEqual({})
    closeDatabase()
  })
})
