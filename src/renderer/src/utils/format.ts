// Numbers, album dates and the file manager's name, written the same way on every screen

export const nf = (n: number): string => n.toLocaleString('en-IN')

/** An event date is a day, not an instant: "2026-10-12" (or its ISO midnight) is read as that
 * day here. new Date("2026-10-12") is UTC midnight, the 11th west of UTC. Other strings (a
 * createdAt timestamp) are instants. */
export function localDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0+)?)?Z?)?$/.exec(s)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s)
}

/** "12 Oct 2026", "Today", or '' when there is no valid date */
export function albumDay(eventDate: string | null, createdAt?: string): string {
  const s = eventDate || createdAt
  const d = s ? localDay(s) : null
  if (!d || isNaN(d.getTime())) return ''
  if (d.toDateString() === new Date().toDateString()) return 'Today'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The file manager's name on this computer: "Show in Finder", "Show in Explorer", "Show in folder" */
export const fileManager = (platform: string = window.electron.process.platform): string =>
  platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'Explorer' : 'folder'
