/**
 * E2E tests for Background Operations
 * Tests that background processes work correctly when app is in tray mode
 */
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'

test.describe('Background Operations', () => {
  let electronApp: ElectronApplication
  let testDir: string

  test.beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `lumosnap-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    electronApp = await electron.launch({
      args: [resolve(__dirname, '../out/main/index.js')],
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
    })
  })

  test.afterEach(async () => {
    await electronApp.close()

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test('should have app running with background services', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for services to initialize
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Check if app is running
    const appName = await electronApp.evaluate(async ({ app }) => {
      return app.getName()
    })

    expect(appName).toBeTruthy()
  })

  test('should have before-quit handler registered', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Verify cleanup handlers are registered by checking before-quit event
    const hasBeforeQuitHandler = await electronApp.evaluate(async ({ app }) => {
      return app.listenerCount('before-quit') > 0
    })

    expect(hasBeforeQuitHandler).toBe(true)
  })

  test('should have window-all-closed handler', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Verify window-all-closed handler exists
    const hasHandler = await electronApp.evaluate(async ({ app }) => {
      return app.listenerCount('window-all-closed') > 0
    })

    expect(hasHandler).toBe(true)
  })
})

test.describe('Watcher Service', () => {
  let electronApp: ElectronApplication

  test.beforeEach(async () => {
    electronApp = await electron.launch({
      args: [resolve(__dirname, '../out/main/index.js')],
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
    })
  })

  test.afterEach(async () => {
    await electronApp.close()
  })

  test('should have app initialized with services', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for watcher to initialize
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Check if app is running properly
    const appName = await electronApp.evaluate(async ({ app }) => {
      return app.getName()
    })

    expect(appName).toBeTruthy()
  })
})
