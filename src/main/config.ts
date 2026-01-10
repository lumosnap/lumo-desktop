import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface AppConfig {
  storageLocation: string | null
  masterFolderPath: string | null // Root folder where user puts source photo subfolders
  isFirstLaunch: boolean
  userId: string | null
  minimizeToTray: boolean // Whether to minimize to tray instead of closing
}

const defaultConfig: AppConfig = {
  storageLocation: null,
  masterFolderPath: null,
  isFirstLaunch: true,
  userId: null,
  minimizeToTray: true // Default to true for background operation
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

  // Load config if exists, otherwise create with defaults
  if (existsSync(configPath)) {
    try {
      const data = readFileSync(configPath, 'utf-8')
      config = { ...defaultConfig, ...JSON.parse(data) }
    } catch (error) {
      console.error('Failed to load config, using defaults:', error)
      config = { ...defaultConfig }
      saveConfig()
    }
  } else {
    saveConfig()
  }

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
    saveConfig()
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

export function getMasterFolder(): string | null {
  return config.masterFolderPath
}

export function setMasterFolder(path: string): void {
  setConfig({ masterFolderPath: path })
}

export function isMasterFolderConfigured(): boolean {
  return config.masterFolderPath !== null && existsSync(config.masterFolderPath)
}

