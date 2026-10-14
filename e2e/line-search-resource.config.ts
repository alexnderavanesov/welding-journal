import { defineConfig } from '@playwright/test'
import base from './mixed-resource.config'

if (process.env.AUDIT_LINE_SEARCH_LOAD !== '1') throw new Error('Opt in to isolated local line-search measurements')
export default defineConfig({ ...base, testMatch: 'line-program-search-load.spec.ts' })
