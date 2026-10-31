// Work state of a photo's notes. A photo with no note (yours or the client's) has none.
export type NoteState = 'open' | 'done'
export type NoteFilter = NoteState | null

interface Noted {
  id: number
  notesCount?: number
  comments?: Array<{ notes: string | null; createdAt: string }>
}

/**
 * 'open' until marked done; a client note written after the mark opens it again,
 * because it asks for something new. Your own edits don't: you were there.
 */
export function noteState(img: Noted, myNote?: string, doneAt?: number): NoteState | null {
  const clientNotes = (img.comments ?? []).filter((c) => c.notes?.trim())
  if (!myNote?.trim() && !clientNotes.length && !img.notesCount) return null
  if (!doneAt) return 'open'
  return clientNotes.some((c) => Date.parse(c.createdAt) > doneAt) ? 'open' : 'done'
}

export function withNoteState<T extends Noted>(
  imgs: T[],
  want: NoteFilter,
  notes: Record<number, string>,
  done: Record<number, number>
): T[] {
  return want ? imgs.filter((i) => noteState(i, notes[i.id], done[i.id]) === want) : imgs
}
