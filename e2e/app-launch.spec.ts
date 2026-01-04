/**
 * E2E test for app launch
 */
import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

test.describe('App Launch', () => {
  test('should launch the application', async () => {
    // Launch Electron app
    const electronApp = await electron.launch({
      args: [resolve(__dirname, '../out/main/index.js')]
    })

    // Get the first window
    const window = await electronApp.firstWindow()

    // Wait for app to load
    await window.waitForLoadState('domcontentloaded')

    // Verify window is visible
    expect(await window.isVisible('body')).toBe(true)

    // Get window title
    const title = await window.title()
    expect(title).toBeTruthy()

    // Take a screenshot for debugging
    await window.screenshot({ path: 'e2e/screenshots/app-launch.png' })

    // Close the app
    await electronApp.close()
  })

  test('should have correct window dimensions', async () => {
    const electronApp = await electron.launch({
      args: [resolve(__dirname, '../out/main/index.js')]
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Get viewport size from the page
    const viewportSize = window.viewportSize()

    // Check minimum dimensions
    expect(viewportSize?.width).toBeGreaterThanOrEqual(800)
    expect(viewportSize?.height).toBeGreaterThanOrEqual(600)

    await electronApp.close()
  })

  test('should be able to access main process', async () => {
    const electronApp = await electron.launch({
      args: [resolve(__dirname, '../out/main/index.js')]
    })

    // Evaluate in main process context
    const appName = await electronApp.evaluate(async ({ app }) => {
      return app.getName()
    })

    expect(appName).toBe('Lumosnap')

    await electronApp.close()
  })
})
