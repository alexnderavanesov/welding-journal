import { defineConfig } from '@playwright/test'
import base from './mixed-resource.config'

// Complete 200k / 800k-position scenario under the explicitly selected local
// CPU/memory budget, without swap or shortened packets.
if (process.env.AUDIT_REBUILD_RESOURCE !== '1' || process.env.AUDIT_REBUILD_ROWS !== '200000' || process.env.AUDIT_REBUILD_PACKETS) {
  throw new Error('Opt in to the full resource-limited document rebuild')
}
export default defineConfig({ ...base, testMatch: 'system-document-rebuild-scale.spec.ts' })
