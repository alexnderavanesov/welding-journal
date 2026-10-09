import { defineConfig } from '@playwright/test'

// Pure local document rendering; no app server, database or fixture setup.
export default defineConfig({ testDir: './tests', testMatch: 'compact-print-layout.spec.ts',
  workers: 1, retries: 0, reporter: 'list', use: { viewport: { width: 1600, height: 1000 } } })
