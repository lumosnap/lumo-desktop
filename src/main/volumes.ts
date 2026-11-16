/**
 * What kind of drive a path is on (network share, removable). A leaf: node builtins and the
 * logger only, so portable.ts can use it without loading the app's IPC and Electron modules.
 */
import { execFile } from 'child_process'
import { realpathSync } from 'fs'
import { userInfo } from 'os'
import { promisify } from 'util'
import { createLogger, getErrorMessage } from './logger'

const logger = createLogger('Volumes')
const run = promisify(execFile)

/** Windows' system drive letter ("C"). Its folders are the internal disk. */
export const systemLetter = (): string => (process.env.SystemDrive ?? 'C:')[0].toUpperCase()
/** The signed-in user's name, as it appears in /media/<user> */
export const currentUser = (): string => process.env.USER ?? userInfo().username

type WinDrive = { type: number; label: string }
let drivesNow: Promise<Map<string, WinDrive> | null> | null = null
let lastDrives = new Map<string, WinDrive>() // for the sync checks below
let drivesRead = false
/** Windows: the drive types have been read once (isNetworkDrive knows mapped shares) */
export const drivesKnown = (): boolean => drivesRead
/**
 * Windows drives by letter: DriveType (2 removable, 3 fixed, 4 network) and label. One
 * PowerShell call per drive event or poll, shared; null when it failed (asked again next time).
 */
export function windowsDrives(): Promise<Map<string, WinDrive> | null> {
  drivesNow ??= run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk | ForEach-Object { "$($_.DeviceID)|$($_.DriveType)|$($_.VolumeName)" }'
    ],
    { timeout: 10_000, windowsHide: true }
  ).then(
    ({ stdout }) => {
      const drives = new Map<string, WinDrive>()
      for (const line of stdout.split(/\r?\n/)) {
        const [id, type, ...rest] = line.split('|')
        const letter = id?.match(/^([A-Za-z]):$/)?.[1]
        if (letter)
          drives.set(letter.toUpperCase(), { type: Number(type), label: rest.join('|').trim() })
      }
      lastDrives = drives
      drivesRead = true
      return drives
    },
    (error) => {
      logger.warn('Could not read drives:', getErrorMessage(error))
      drivesNow = null
      return null
    }
  )
  return drivesNow
}

let networkMounts: string[] = [] // macOS: mount points of smbfs/afpfs/nfs/webdav shares
export async function readMacMounts(): Promise<void> {
  try {
    const { stdout } = await run('mount', [], { timeout: 5000 })
    networkMounts = stdout
      .split('\n')
      .map((l) => l.match(/ on (.+) \((smbfs|afpfs|nfs|webdav)[,)]/)?.[1])
      .filter((m): m is string => !!m)
  } catch (error) {
    logger.warn('Could not read mounts:', getErrorMessage(error))
  }
}

/** The path is on a network share. From a cache refreshed on drive events; false until read. */
export function isNetworkDrive(path: string): boolean {
  if (process.platform === 'win32') {
    if (/^\\\\[^?.]/.test(path)) return true // \\server\share
    const letter = path.match(/^([A-Za-z]):/)?.[1]?.toUpperCase()
    return !!letter && lastDrives.get(letter)?.type === 4
  }
  if (process.platform === 'darwin')
    return networkMounts.some((m) => path === m || path.startsWith(`${m}/`))
  return false // ponytail: Linux network mounts (cifs/nfs) not told apart
}

/** The path is on a drive other than the system disk (a card, a USB drive) */
export function isRemovableVolume(path: string): boolean {
  if (process.platform === 'win32') {
    const letter = path.match(/^([A-Za-z]):/)?.[1]?.toUpperCase()
    return !!letter && (lastDrives.get(letter)?.type === 2 || letter !== systemLetter())
  }
  if (process.platform === 'darwin') {
    const root = path.match(/^\/Volumes\/[^/]+/)?.[0]
    if (!root) return false
    try {
      return realpathSync(root) !== '/' // the startup disk is linked in /Volumes too
    } catch {
      return true // unplugged: it was a drive
    }
  }
  return /^\/(run\/)?media\//.test(path)
}

/** Drives changed: the next windowsDrives() reads them again */
export function forgetDrives(): void {
  drivesNow = null
}
