import { fileURLToPath, URL } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    // Generated browser artifacts/builds contain no unit sources and must not
    // be traversed (including cloud-synced traces from interrupted runs).
    exclude: [...configDefaults.exclude, 'e2e/**', 'test-results/**', 'playwright-report/**', '.output/**', 'outputs/**'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
