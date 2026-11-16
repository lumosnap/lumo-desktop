import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface AppConfig {
  storageLocation: string | null
  isFirstLaunch: boolean
  userId: string | null
  minimizeToTray: boolean // Whether to minimize to tray instead of closing
  // Rollout flags (plan: multi-computer). Turn on in this order, at least one release apart.
  portableSnapshot: boolean // write <album>/.lumosnap/ (manifest + previews) after syncs and pushes
  reattach: boolean // a folder with a manifest re-attaches to its album instead of making a new one
  flagsOn?: boolean // the two flags above were turned on by default (config files from before keep false)
}

const defaultConfig: AppConfig = {
  storageLocation: null,
  isFirstLaunch: true,
  userId: null,
  minimizeToTray: true, // Default to true for background operation
  portableSnapshot: true,
  reattach: true,
  flagsOn: true
}

let config: AppConfig = { ...defaultConfig }
let configPath: string

export function initConfig(): void {
  const userDataPath = app.getPath('userData')
  configPath = join(userDataPath, 'config.json')

  // Ensure userData directory exists
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true })
  }

  // Load config if exists, otherwise create with defaults. Saving here only logs: a locked or
  // read-only config.json (antivirus, a restored backup) must not stop the app starting
  const trySave = (): void => {
    try {
      saveConfig()
    } catch {
      // logged in saveConfig; the next change tries again
    }
  }
  let save = true
  if (existsSync(configPath)) {
    try {
      const data = readFileSync(configPath, 'utf-8')
      const saved = JSON.parse(data)
      // Earlier builds saved both flags at their old default (false): turn them on once
      save = !saved.flagsOn
      if (save) {
        delete saved.portableSnapshot
        delete saved.reattach
      }
      config = { ...defaultConfig, ...saved, flagsOn: true }
    } catch (error) {
      console.error('Failed to load config, using defaults:', error)
      config = { ...defaultConfig }
    }
  }
  if (save) trySave()

  // Auto-configure default storage location if not set
  if (!config.storageLocation) {
    const documentsPath = app.getPath('documents')
    const defaultStoragePath = join(documentsPath, 'LumoSnap')

    // Ensure the default storage directory exists
    if (!existsSync(defaultStoragePath)) {
      mkdirSync(defaultStoragePath, { recursive: true })
    }

    config.storageLocation = defaultStoragePath
    config.isFirstLaunch = false
    trySave()
    console.log('[Config] Auto-configured default storage location:', defaultStoragePath)
  }
}

function saveConfig(): void {
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to save config:', error)
    throw error
  }
}

export function getConfig(): AppConfig {
  return { ...config }
}

export function setConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void
export function setConfig(updates: Partial<AppConfig>): void
export function setConfig<K extends keyof AppConfig>(
  keyOrUpdates: K | Partial<AppConfig>,
  value?: AppConfig[K]
): void {
  if (typeof keyOrUpdates === 'string') {
    config = { ...config, [keyOrUpdates]: value }
  } else {
    config = { ...config, ...keyOrUpdates }
  }
  saveConfig()
}

export function isConfigured(): boolean {
  return config.storageLocation !== null && !config.isFirstLaunch
}

export function getStorageLocation(): string | null {
  return config.storageLocation
}

export function setStorageLocation(path: string): void {
  setConfig({ storageLocation: path, isFirstLaunch: false })
}

export function resetConfig(): void {
  config = { ...defaultConfig }
  saveConfig()
}

export function getConfigPath(): string {
  return configPath
}
