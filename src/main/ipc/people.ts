/**
 * People IPC. Mutations return { success, error? } (assignFace adds the face's personId,
 * review the remaining queue length), re-match the album's faces, emit album:peopleChanged
 * and schedule a debounced push.
 */
import { ipcMain } from 'electron'
import {
  assignFace,
  getAlbum,
  getClientPeople,
  getImageFaces,
  hasPerson,
  mergePeople,
  removePerson,
  renamePerson,
  reviewFaces,
  setClientPerson,
  setPersonCover,
  setPersonHidden
} from '../database'
import {
  listPeople,
  notifyPeopleChanged,
  peopleConfig,
  peoplePayload,
  pickPhotos,
  pushPeople,
  rematch,
  reviewQueue,
  schedulePeoplePush,
  setPeopleEnabled
} from '../people'
import { tagAlbum } from '../album-analysis'
import { albumsApi } from '../api-client'
import { createLogger, getErrorMessage } from '../logger'

const logger = createLogger('IPC:People')

const cleanName = (v: unknown): string | null => {
  const n = typeof v === 'string' ? v.trim().slice(0, 80) : ''
  return n || null
}
const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`Invalid ${what}`)
  return v
}
const int = (v: unknown, what: string): number => {
  if (!Number.isInteger(v)) throw new Error(`Invalid ${what}`)
  return v as number
}
const limit = (v: unknown, fallback: number): number =>
  Number.isInteger(v) && (v as number) > 0 ? Math.min(v as number, 500) : fallback

export function registerPeopleHandlers(): void {
  ipcMain.handle('people:getConfig', (_e, albumId: string) => peopleConfig(albumId))

  ipcMain.handle('people:setEnabled', (_e, albumId: string, enabled: unknown) => {
    const config = setPeopleEnabled(albumId, enabled === true)
    if (enabled === true) tagAlbum(albumId) // tags first (no-op if done), then faces
    return config
  })

  ipcMain.handle('people:list', (_e, albumId: string) => listPeople(albumId))

  ipcMain.handle('people:pickPhotos', (_e, albumId: string, n: unknown) =>
    pickPhotos(albumId, limit(n, 12))
  )

  ipcMain.handle('people:reviewQueue', (_e, albumId: string, personId: unknown, n: unknown) =>
    reviewQueue(albumId, str(personId, 'person'), limit(n, 24))
  )

  ipcMain.handle('people:facesInImage', (_e, albumId: string, imageId: unknown) =>
    getImageFaces(albumId, int(imageId, 'image')).map((f) => ({
      faceId: f.id,
      box: f.box,
      personId: f.personId,
      name: f.name,
      source: f.source
    }))
  )

  ipcMain.handle('people:clientLinks', (_e, albumId: string) => getClientPeople(albumId))

  const mutation = <A extends unknown[]>(
    channel: string,
    run: (albumId: string, ...args: A) => object | void
  ): void => {
    ipcMain.handle(channel, (_e, albumId: string, ...args) => {
      try {
        if (!getAlbum(albumId)) throw new Error('Album not found')
        const extra = run(albumId, ...(args as A))
        rematch(albumId)
        schedulePeoplePush(albumId)
        notifyPeopleChanged(albumId)
        return { success: true, ...extra }
      } catch (error: unknown) {
        logger.error(`${channel} failed:`, getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
      }
    })
  }

  mutation('people:rename', (albumId, personId: unknown, name: unknown) =>
    renamePerson(albumId, str(personId, 'person'), str(cleanName(name), 'name'))
  )
  mutation('people:remove', (albumId, personId: unknown) =>
    removePerson(albumId, str(personId, 'person'))
  )
  mutation('people:merge', (albumId, intoId: unknown, fromIds: unknown) => {
    if (!Array.isArray(fromIds)) throw new Error('Invalid people')
    mergePeople(
      albumId,
      str(intoId, 'person'),
      fromIds.map((id) => str(id, 'person'))
    )
  })
  mutation('people:setHidden', (albumId, personId: unknown, hidden: unknown) =>
    setPersonHidden(albumId, str(personId, 'person'), hidden === true)
  )
  mutation('people:setCover', (albumId, personId: unknown, faceId: unknown) =>
    setPersonCover(albumId, str(personId, 'person'), int(faceId, 'face'))
  )
  mutation('people:assignFace', (albumId, faceId: unknown, target: unknown) => {
    const t = (target ?? {}) as Record<string, unknown>
    const to =
      typeof t.personId === 'string'
        ? { personId: t.personId }
        : typeof t.newName === 'string' && cleanName(t.newName)
          ? { newName: cleanName(t.newName)! }
          : t.none === true
            ? { none: true as const }
            : null
    if (!to) throw new Error('Invalid target')
    return { personId: assignFace(albumId, int(faceId, 'face'), to) }
  })

  // remaining = the person's review queue after these answers
  ipcMain.handle('people:review', (_e, albumId: string, personId: unknown, decisions: unknown) => {
    try {
      if (!getAlbum(albumId)) throw new Error('Album not found')
      const pid = str(personId, 'person')
      if (!Array.isArray(decisions)) throw new Error('Invalid decisions')
      reviewFaces(
        albumId,
        pid,
        decisions.map((d) => ({ faceId: int(d?.faceId, 'face'), yes: d?.yes === true }))
      )
      const remaining = rematch(albumId).get(pid)?.length ?? 0
      schedulePeoplePush(albumId)
      notifyPeopleChanged(albumId)
      return { success: true, remaining }
    } catch (error: unknown) {
      logger.error('people:review failed:', getErrorMessage(error))
      return { success: false, error: getErrorMessage(error), remaining: 0 }
    }
  })

  // Server first, so the local link never claims something the server doesn't have
  ipcMain.handle(
    'people:linkClient',
    async (_e, albumId: string, clientName: unknown, personId: unknown) => {
      try {
        if (!getAlbum(albumId)) throw new Error('Album not found')
        const name = str(clientName, 'client').slice(0, 200)
        const pid = personId == null ? null : str(personId, 'person')
        if (pid && !hasPerson(albumId, pid)) throw new Error('Person not found')
        // The server only knows pushed people (named, shown, with an uploaded photo)
        if (pid) {
          await pushPeople(albumId)
          if (!peoplePayload(albumId).people.some((p) => p.id === pid))
            throw new Error('Name this person and upload a photo of them first')
        }
        await albumsApi.putClientPerson(albumId, name, pid)
        setClientPerson(albumId, name, pid)
        notifyPeopleChanged(albumId)
        return { success: true }
      } catch (error: unknown) {
        logger.error('people:linkClient failed:', getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )
}
