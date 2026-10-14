import { defineConfig } from '@playwright/test'
import base from './mixed-resource.config'

if (process.env.AUDIT_SEARCH_LOAD !== '1') throw new Error('Opt in to isolated local search measurements')
export default defineConfig({ ...base, testMatch: 'search-filter-performance.spec.ts' })
