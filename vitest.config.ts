import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Run tests in Node environment for main process
    environment: 'node',

    // Include main process test files
    include: ['src/main/**/*.test.ts'],

    // Exclude E2E tests (handled by Playwright)
    exclude: ['e2e/**', 'node_modules/**'],

    // Global test settings
    globals: true,
    testTimeout: 10000,

    // Coverage settings
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/**/*.test.ts', 'src/main/index.ts', 'src/main/__mocks__/**'],
      thresholds: {
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60
      }
    },

    // Deps configuration for proper module resolution
    deps: {
      inline: ['electron']
    }
  },

  resolve: {
    alias: {
      '@main': resolve(__dirname, './src/main'),
      // Mock electron for tests
      electron: resolve(__dirname, './src/main/__mocks__/electron.ts')
    }
  }
})
