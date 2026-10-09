import { defineConfig } from '@playwright/test'
import base from './mixed-resource.config'

// Same complete 200k / 800k-position scenario, now also under the existing
// 2 CPU / 2 GiB / no-swap cap. No shortened packets or raised test timeouts.
if (process.env.AUDIT_REBUILD_RESOURCE !== '1' || process.env.AUDIT_REBUILD_ROWS !== '200000' || process.env.AUDIT_REBUILD_PACKETS) {
  throw new Error('Opt in to the full resource-limited document rebuild')
}
export default defineConfig({ ...base, testMatch: 'system-document-rebuild-scale.spec.ts' })
