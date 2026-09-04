import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('dispatcher warning concurrency', () => {
  it('locks control-process settings before revoking an early-coil decision', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/dispatcher-warnings.ts'), 'utf8')
    const handlerStart = source.indexOf('export const revokeDispatcherAcceptedWarning')
    const handlerSource = source.slice(handlerStart)
    const processLockIndex = handlerSource.indexOf('await loadControlProcessSettingsFromTransaction(tx)')
    const revokeIndex = handlerSource.indexOf('await revokeEarlyCoilDecisionInTransaction(tx, data.key)')

    expect(processLockIndex).toBeGreaterThanOrEqual(0)
    expect(revokeIndex).toBeGreaterThan(processLockIndex)
  })

  it('stops an early-coil revoke when its source moves while the old line is being locked', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/early-coil-workflow.ts'), 'utf8')
    const revokeStart = source.indexOf('export async function revokeEarlyCoilDecisionInTransaction')
    const revokeSource = source.slice(revokeStart)
    const missingAfterLockGuard = revokeSource.indexOf('if (sourceReference && !sourceRow)')
    const missingSourceCleanup = revokeSource.indexOf('if (!sourceRow)')

    expect(missingAfterLockGuard).toBeGreaterThanOrEqual(0)
    expect(missingSourceCleanup).toBeGreaterThan(missingAfterLockGuard)
  })
})
