import { defineConfig } from '@playwright/test'
import base from './mixed-resource.config'

// Before/after latency comparison only, never a substitute for mixed acceptance.
if (process.env.AUDIT_ORDINARY_LATENCY !== '1') throw new Error('Opt in to the ordinary latency comparison')
export default defineConfig({ ...base, testMatch: ['memory-working-set.spec.ts', 'workflow-input-responsiveness.spec.ts'] })
