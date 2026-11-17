// Words for giving an album a folder: an account album (albums:attachCloud) and a missing
// album's folder chosen again (album:relink)
import type { AttachCloudResult, CloudAlbum } from '../../../main/ipc/cloud'
import { nf } from './format'

export const folderName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() || p

type Found = NonNullable<CloudAlbum['found']>
/** The row's button when its folder is on a plugged-in drive: the drive's label, else the folder */
export const addFromLabel = (f: Found): string => `Add from “${f.drive || folderName(f.folder)}”`
/** The line under the row's meta: where the folder is */
export const foundWhere = (f: Found): string =>
  `In “${folderName(f.folder)}” on ${f.drive ? `“${f.drive}”` : 'a plugged-in drive'}`

/** Albums on a drive now that were not on one in the list before */
export function newlyFound(before: CloudAlbum[], after: CloudAlbum[]): CloudAlbum[] {
  const had = new Set(before.filter((c) => c.found).map((c) => c.id))
  return after.filter((c) => c.found && !had.has(c.id))
}

/** The toast when the drives just plugged in have account albums that aren't here */
export function foundNote(list: CloudAlbum[]): string {
  const drives = new Set(list.map((c) => c.found?.drive ?? null))
  const [drive] = drives
  const one = drives.size === 1
  if (list.length === 1) {
    const on = drive ? `“${drive}”` : 'a drive you plugged in'
    return `Found “${list[0].title}” on ${on}. It isn’t on this computer yet.`
  }
  const who =
    one && drive
      ? `“${drive}” has`
      : one
        ? 'A drive you plugged in has'
        : 'The drives you plugged in have'
  return `${who} ${nf(list.length)} of your albums that aren’t on this computer.`
}

export type AttachCode = Extract<AttachCloudResult, { success: false }>['error']
/** The codes that leave the row with a line under it */
export type RowCode = Exclude<AttachCode, 'LOCAL' | 'NOT_FOUND'>

const photos = (n: number): string => `${nf(n)} photo${n === 1 ? '' : 's'}`

/** The toast after a folder was matched: what was found, what stays online */
export function attachedNote(r: {
  title: string
  matched: number
  remote: number
  total: number
}): string {
  const here = `“${r.title}” is on this computer now`
  if (!r.total) return `${here}.`
  if (!r.remote) return `${here}, with all ${photos(r.total)}.`
  if (!r.matched)
    return `${here}. Its ${photos(r.total)} ${r.total === 1 ? 'is' : 'are'} only online.`
  return `${here}. ${photos(r.matched)} found, ${nf(r.remote)} only online.`
}

/** The line under the album's row when the folder can't be used. LOCAL and NOT_FOUND have none:
 * the row goes and a toast says why */
export function attachError(code: RowCode): string {
  switch (code) {
    case 'IN_USE':
      return 'Another album on this computer uses that folder. Choose a different one.'
    case 'OTHER_ALBUM':
      return 'That folder has the photos of a different album. Choose the folder for this one.'
    case 'NO_FOLDER':
      return 'That folder isn’t there any more. Plug the drive back in, or choose another folder.'
    case 'BUSY':
      return 'LumoSnap is already matching this album or that folder. Try again when it finishes.'
    case 'AUTH':
      return 'Your sign-in expired. Sign in again, then choose the folder.'
    case 'SERVER':
      return 'LumoSnap’s server had a problem. Nothing online was changed. Choose the folder again in a few minutes.'
    case 'OFFLINE':
      return 'LumoSnap couldn’t reach your account. Nothing online was changed. Choose the folder again when you’re online.'
    case 'FAILED':
      return 'LumoSnap couldn’t use that folder. Nothing online was changed. Try again in a few minutes.'
  }
}

/** The line in the Choose folder dialog when album:relinkPreview or album:relink says no.
 * IN_USE with the other album's name shows that name from the preview instead */
export function relinkError(code: string | undefined): string {
  switch (code) {
    case 'IN_USE':
      return 'Another album on this computer uses that folder. Choose a different one.'
    case 'ADOPTING':
      return 'LumoSnap is still matching this album with the one on your account. Try again when it finishes.'
    case 'NOT_FOUND':
      return 'This album isn’t on this computer any more.'
    case 'BUSY':
      return 'This album is uploading. Choose the folder again when it finishes.'
    case 'CONFIRM_MISSING':
      return 'The folder changed since LumoSnap compared it. Check the new counts.'
    default:
      // ponytail: raw disk or server text goes to the console, not the screen
      console.warn('album relink failed:', code)
      return 'LumoSnap couldn’t use that folder. Nothing online was changed. Try again in a few minutes.'
  }
}
