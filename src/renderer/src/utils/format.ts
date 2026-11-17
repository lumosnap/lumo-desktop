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

/** A plan's monthly price. The worker sends whole dollars as a decimal string ("5", "4.99",
 * "0.00"): "$5", "$4.99", or "Free" for nothing (or a price that isn't a number) */
export function planPrice(priceMonthly: string): string {
  const n = parseFloat(priceMonthly)
  if (!(n > 0)) return 'Free'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2
  })
}

/** The plan a profile is on. Without a subscription the worker says "Trial", a name no plan
 * has: that person is on the free plan (the one with their photo limit). Another unknown name
 * (a retired paid plan) is no plan here, not the free one */
export function currentPlanOf<
  P extends { displayName: string; priceMonthly: string; imageLimit: number }
>(plans: P[], profile: { planName: string; imageLimit: number } | null | undefined): P | undefined {
  if (!profile) return undefined
  return (
    plans.find((p) => p.displayName === profile.planName) ??
    (profile.planName === 'Trial'
      ? plans.find(
          (p) => planPrice(p.priceMonthly) === 'Free' && p.imageLimit === profile.imageLimit
        )
      : undefined)
  )
}

/** A size the way Windows Explorer writes it (1024 bytes to a KB): "512 bytes", "840 KB",
 * "2.3 GB"; one decimal under 10 */
export function fileSize(bytes: number): string {
  if (!(bytes >= 0)) return ''
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${bytes} bytes`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  // 1023.6 MB would round to "1024 MB": that is 1.0 GB
  while (v >= 1023.5 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 9.95 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
