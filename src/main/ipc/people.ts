/**
 * People IPC. Mutations return { success, error? } (assignFace adds the face's personId),
 * emit album:peopleChanged and schedule a debounced push.
 */
import { ipcMain } from 'electron'
import {
  assignFace,
  getAlbum,
  getClientPeople,
  getImageFaces,
  hasPerson,
  mergePeople,
  renamePerson,
  setClientPerson,
  setPersonCover,
  setPersonHidden
} from '../database'
import {
  listPeople,
  notifyPeopleChanged,
  peopleConfig,
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

export function registerPeopleHandlers(): void {
  ipcMain.handle('people:getConfig', (_e, albumId: string) => peopleConfig(albumId))

  ipcMain.handle('people:setEnabled', (_e, albumId: string, enabled: unknown) => {
    const config = setPeopleEnabled(albumId, enabled === true)
    if (enabled === true) tagAlbum(albumId) // tags first (no-op if done), then faces
    return config
  })

  ipcMain.handle('people:list', (_e, albumId: string) => listPeople(albumId))

  ipcMain.handle('people:facesInImage', (_e, albumId: string, imageId: unknown) =>
    getImageFaces(albumId, int(imageId, 'image')).map((f) => ({
      faceId: f.id,
      box: f.box,
      personId: f.personId,
      name: f.name
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
    renamePerson(albumId, str(personId, 'person'), cleanName(name))
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

  // Server first, so the local link never claims something the server doesn't have
  ipcMain.handle(
    'people:linkClient',
    async (_e, albumId: string, clientName: unknown, personId: unknown) => {
      try {
        if (!getAlbum(albumId)) throw new Error('Album not found')
        const name = str(clientName, 'client').slice(0, 200)
        const pid = personId == null ? null : str(personId, 'person')
        if (pid && !hasPerson(albumId, pid)) throw new Error('Person not found')
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
