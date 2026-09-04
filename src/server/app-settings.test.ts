import { describe, expect, it } from 'vitest'

import { assertAppSettingVersion } from '@/server/app-settings'

describe('app setting concurrency', () => {
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
