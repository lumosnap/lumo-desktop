/**
 * E2E tests for Settings API
 */
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { resolve } from 'path'

test.describe('Settings API', () => {
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

  test('should get all settings via IPC', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Call the settings API through the renderer's exposed API
    const settings = await window.evaluate(async () => {
      // @ts-expect-error - window.api is exposed via preload
      return await window.api.settings.getAll()
    })

    expect(settings.success).toBe(true)
    expect(settings.settings).toBeDefined()
    expect(typeof settings.settings?.autoStart).toBe('boolean')
    expect(typeof settings.settings?.minimizeToTray).toBe('boolean')
  })

  test('should get minimize-to-tray setting', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const result = await window.evaluate(async () => {
      // @ts-expect-error - window.api is exposed via preload
      return await window.api.settings.getMinimizeToTray()
    })

    expect(result.success).toBe(true)
    expect(result.enabled).toBe(true) // Default is true
  })

  test('should set minimize-to-tray setting', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Disable minimize to tray
    const setResult = await window.evaluate(async () => {
      // @ts-expect-error - window.api is exposed via preload
      return await window.api.settings.setMinimizeToTray(false)
    })

    expect(setResult.success).toBe(true)
    expect(setResult.enabled).toBe(false)

    // Verify it was set
    const getResult = await window.evaluate(async () => {
      // @ts-expect-error - window.api is exposed via preload
      return await window.api.settings.getMinimizeToTray()
    })

    expect(getResult.enabled).toBe(false)

    // Reset back to default
    await window.evaluate(async () => {
      // @ts-expect-error - window.api is exposed via preload
      return await window.api.settings.setMinimizeToTray(true)
    })
  })

  test('should get auto-start setting', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const result = await window.evaluate(async () => {
      // @ts-expect-error - window.api is exposed via preload
      return await window.api.settings.getAutoStart()
    })

    expect(result.success).toBe(true)
    expect(typeof result.enabled).toBe('boolean')
    expect(typeof result.openAsHidden).toBe('boolean')
  })

  // Note: We don't test setAutoStart as it modifies system login items
  // which could affect the test environment
})
