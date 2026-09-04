import { describe, expect, it } from 'vitest'

import {
  assertLocalMigrationDatabaseUrl,
  assertMigrationBranch,
  assertRemoteMigrationPublishedCommit,
  assertRemoteMigrationWorkspace,
} from '@/lib/migration-branch-guard'

describe('migration branch guard', () => {
  it('allows migrations only from main', () => {
    expect(() => assertMigrationBranch('main')).not.toThrow()
    expect(() => assertMigrationBranch('codex/psto-control-cycle')).toThrow(
      'Миграции разрешено запускать только из ветки main',
    )
    expect(() => assertMigrationBranch('')).toThrow('detached HEAD')
  })

  it('allows the local migration command to use only loopback databases', () => {
    expect(() => assertLocalMigrationDatabaseUrl('postgres://user:pass@localhost:5432/db')).not.toThrow()
    expect(() => assertLocalMigrationDatabaseUrl('postgresql://user:pass@127.0.0.1/db')).not.toThrow()
    expect(() => assertLocalMigrationDatabaseUrl('postgres://user:pass@[::1]:5432/db')).not.toThrow()
    expect(() => assertLocalMigrationDatabaseUrl('postgres://user:pass@db.example.com/db')).toThrow(
      /DATABASE_URL указывает не на localhost/,
    )
  })

  it('requires a clean main workspace before any remote migration', () => {
    expect(() => assertRemoteMigrationWorkspace('main', '')).not.toThrow()
    expect(() => assertRemoteMigrationWorkspace('feature', '')).toThrow(/только из ветки main/)
    expect(() => assertRemoteMigrationWorkspace('main', ' M src/db/schema.ts')).toThrow(
      /незакоммиченные изменения/,
    )
  })

  it('requires the exact commit published at origin/main', () => {
    const commit = 'ABCDEF0123456789'
    expect(() => assertRemoteMigrationPublishedCommit(commit, commit.toLowerCase())).not.toThrow()
    expect(() => assertRemoteMigrationPublishedCommit(commit, '1234567890')).toThrow(
      /не совпадает с опубликованным origin\/main/,
    )
    expect(() => assertRemoteMigrationPublishedCommit('', '')).toThrow(/не совпадает/)
  })
})
