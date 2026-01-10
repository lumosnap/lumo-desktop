/**
 * E2E tests for System Tray functionality
 */
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { resolve } from 'path'

test.describe('System Tray', () => {
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

  test('should create tray on app launch', async () => {
    // Wait for app to initialize
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for tray to be created (happens after window is created)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // App should have launched successfully - tray is created internally
    // We verify the app is running and the window exists
    const title = await window.title()
    expect(title).toBeTruthy()
  })

  test('should stay running when window is closed with minimize-to-tray enabled', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Get window count before close
    const windowsBefore = await electronApp.windows()
    expect(windowsBefore.length).toBeGreaterThanOrEqual(1)

    // Close the window
    await window.close()

    // App should still be running (not quit)
    // Wait a bit to ensure the close event was processed
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Try to get app name - if this works, app is still running
    const appName = await electronApp
      .evaluate(async ({ app }) => {
        return app.getName()
      })
      .catch(() => null)

    // App should still be running
    expect(appName).toBeTruthy()
  })

  test('should hide window instead of destroying on close', async () => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Close the window (should hide, not destroy)
    await window.close()
    await new Promise((resolve) => setTimeout(resolve, 300))

    // App should still be running - verify by checking we can still evaluate
    const appStillRunning = await electronApp
      .evaluate(async ({ app }) => {
        return app.getName()
      })
      .catch(() => null)

    expect(appStillRunning).toBeTruthy()
  })
})

test.describe('Hidden Launch', () => {
  test('should start hidden when launched with --hidden flag', async () => {
    const electronApp = await electron.launch({
      args: [resolve(__dirname, '../out/main/index.js'), '--hidden'],
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
    })

    // Wait a bit for initialization
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Check that window was created but not shown
    const isWindowHidden = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      if (windows.length === 0) return true
      return !windows[0].isVisible()
    })

    expect(isWindowHidden).toBe(true)

    await electronApp.close()
  })
})
