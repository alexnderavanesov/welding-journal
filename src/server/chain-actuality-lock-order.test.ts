import { expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { previewChainActualityInTransaction, prepareChainActualityInTransaction } from './chain-actuality'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

const state = vi.hoisted(() => ({ locks: [] as string[] }))
vi.mock('./physical-chain-context', () => ({
  loadPhysicalChainContext: async () => {
    state.locks.push('chain rows')
    throw new Error('Stop before loading chain rows')
  },
}))

it.each(['preview', 'save'] as const)('takes process locks before chain rows for an actuality %s', async action => {
  state.locks = []
  const dialect = new PgDialect()
  const tx = { execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
    const { sql, params } = dialect.sqlToQuery(query)
    expect(sql).toContain('pg_advisory_xact_lock_shared')
    state.locks.push(String(params[0]))
  } } as unknown as SystemDocumentSequenceTransaction
  const input = { rowId: 1, active: false }
  const run = action === 'preview' ? previewChainActualityInTransaction(tx, input)
    : prepareChainActualityInTransaction(tx, { ...input, token: 'a'.repeat(64), confirmed: true })
  await expect(run).rejects.toThrow('Stop before loading chain rows')
  // Settings transitions take these two locks before updating the same rows.
  // Reversing them in a read-only preview can deadlock both operations.
  expect(state.locks).toEqual(['control-processes:preHeatTreatmentLnk', 'control-processes:layeredControl', 'chain rows'])
})
