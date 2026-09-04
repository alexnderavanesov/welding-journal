import { describe, expect, it } from 'vitest'

import { assertMigrationBranch } from '@/lib/migration-branch-guard'

describe('migration branch guard', () => {
  it('allows migrations only from main', () => {
    expect(() => assertMigrationBranch('main')).not.toThrow()
    expect(() => assertMigrationBranch('codex/psto-control-cycle')).toThrow(
      'Миграции разрешено запускать только из ветки main',
    )
    expect(() => assertMigrationBranch('')).toThrow('detached HEAD')
  })
})
