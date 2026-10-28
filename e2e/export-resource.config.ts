import { defineConfig } from '@playwright/test'
import base from './mixed-resource.config'

if (process.env.AUDIT_EXPORT_CONCURRENCY !== '1') throw new Error('Opt in to simultaneous complete exports')
export default defineConfig({ ...base, testMatch: 'report-concurrent-export-load.spec.ts' })
