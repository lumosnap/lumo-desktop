/**
 * Centralized Logger for LumoSnap Desktop
 *
 * Uses electron-log for consistent logging across main and renderer processes.
 * Logs are written to:
 * - Linux: ~/.config/Lumosnap/logs/main.log
 * - macOS: ~/Library/Logs/Lumosnap/main.log
 * - Windows: %USERPROFILE%\AppData\Roaming\Lumosnap\logs\main.log
 */

import log from 'electron-log/main'

// Configure log file settings
log.transports.file.level = 'info'
log.transports.file.maxSize = 10 * 1024 * 1024 // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

// Configure console output (for development)
log.transports.console.level = 'debug'
log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}'

// Catch unhandled errors
log.errorHandler.startCatching({
  showDialog: false,
  onError: ({ error }) => {
    log.error('Caught unhandled error:', error)
  }
})

interface ScopedLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  verbose: (...args: unknown[]) => void
}

/**
 * Create a scoped logger for a specific module
 */
export function createLogger(scope: string): ScopedLogger {
  return {
    info: (...args: unknown[]) => log.info(`[${scope}]`, ...args),
    warn: (...args: unknown[]) => log.warn(`[${scope}]`, ...args),
    error: (...args: unknown[]) => log.error(`[${scope}]`, ...args),
    debug: (...args: unknown[]) => log.debug(`[${scope}]`, ...args),
    verbose: (...args: unknown[]) => log.verbose(`[${scope}]`, ...args)
  }
}

// Export the base logger for direct use
export default log

// Export typed error extraction helper
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

// Export error classification helper
export function classifyError(error: unknown): 'network' | 'auth' | 'server' | 'unknown' {
  const message = getErrorMessage(error).toLowerCase()

  if (
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('timeout')
  ) {
    return 'network'
  }
  if (message.includes('unauthorized') || message.includes('401') || message.includes('auth')) {
    return 'auth'
  }
  if (message.includes('500') || message.includes('502') || message.includes('503')) {
    return 'server'
  }
  return 'unknown'
}
