import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { assertAppSettingVersion } from '@/server/app-settings'

describe('app setting concurrency', () => {
  it('takes the background refresh lock before invalidating and pruning dispatcher settings', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/app-settings.ts'), 'utf8')
    const lockIndex = source.indexOf('pg_advisory_xact_lock(${DISPATCHER_BACKGROUND_INDEX_LOCK_ID})')
    const dirtyIndex = source.indexOf('await markDispatcherTaskIndexDirty(tx)')
    const pruneIndex = source.indexOf('await pruneEnabledDispatcherBackgroundTasks(')

    expect(lockIndex).toBeGreaterThanOrEqual(0)
    expect(dirtyIndex).toBeGreaterThan(lockIndex)
    expect(pruneIndex).toBeGreaterThan(dirtyIndex)
  })

  it('accepts the revision that was loaded by the editor', () => {
    expect(() => assertAppSettingVersion('current', 'current')).not.toThrow()
    expect(() => assertAppSettingVersion(null, null)).not.toThrow()
  })

  it('rejects stale and missing revisions', () => {
    expect(() => assertAppSettingVersion('current', 'stale')).toThrow(/изменена другим пользователем/i)
    expect(() => assertAppSettingVersion('current', undefined)).toThrow(/изменена другим пользователем/i)
    expect(() => assertAppSettingVersion(null, undefined)).toThrow(/изменена другим пользователем/i)
  })
})
