import { describe, expect, it, vi } from 'vitest'
import { assertTechnologyCardRevision, deleteTechnologyCardInTransaction, markTechnologyCardsUsed, normalizeTechnologyCardPageRequest } from '@/server/technology-card-registry'
import { lockTechnologyCardRegistry } from '@/server/technology-card-registry-lock'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

describe('technology card registry boundaries', () => {
  it('requires a positive exact revision even when a client submits an empty or coerced version', () => {
    expect(() => assertTechnologyCardRevision(2, 2)).not.toThrow()
    for (const revision of [null, '', '2', undefined, 0, 1, 3, 2.1, Number.NaN]) {
      expect(() => assertTechnologyCardRevision(2, revision)).toThrow('уже изменена')
    }
  })

  it('bounds page sizes and keeps literal search text', () => {
    expect(normalizeTechnologyCardPageRequest()).toEqual({ afterId: 0, limit: 50, search: '', archive: 'active' })
    expect(normalizeTechnologyCardPageRequest({ afterId: -4, limit: 200_000, search: '  ТК №12%_  ', archive: 'all' })).toEqual({ afterId: 0, limit: 100, search: 'ТК №12%_', archive: 'all' })
  })

  it('rejects an unconfirmed deletion before any DB operation', async () => {
    const tx = { execute: vi.fn() }
    await expect(deleteTechnologyCardInTransaction(tx as never, { id: 12, expectedRevision: 1, confirmed: false })).rejects.toThrow('Подтвердите')
    expect(tx.execute).not.toHaveBeenCalled()
  })

  it('uses matching shared/exclusive transaction locks for assignment and registry writes', async () => {
    const tx = { execute: vi.fn(async (_query: SQL) => undefined) }
    await lockTechnologyCardRegistry(tx)
    await lockTechnologyCardRegistry(tx, 'exclusive')
    const queries = tx.execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query).sql)
    expect(queries).toEqual([
      "select pg_advisory_xact_lock_shared(hashtext('technology-card-registry'))",
      "select pg_advisory_xact_lock(hashtext('technology-card-registry'))",
    ])
  })

  it('does not query for a batch without any assigned cards', async () => {
    const tx = { execute: vi.fn() }
    await markTechnologyCardsUsed(tx as never, Array.from({ length: 2000 }, () => ({ technologyCardNumber: null })))
    expect(tx.execute).not.toHaveBeenCalled()
  })
})
