import { expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { readRebuildIdentities, assertRebuildFactBudget } from './system-document-rebuild-batch'
import { REBUILD_FACT_BYTES_LIMIT } from '@/lib/system-document-rebuild-batch'

it('streams global identities without returning metadata or positions', async () => {
  const execute = vi.fn().mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({ rows: [{ documentId: 1, storageType: 'system:pstoRequest', title: 'P', date: '2026-10-01' }] })
  const documents = []
  for await (const document of readRebuildIdentities({ execute } as never)) documents.push(document)
  expect(documents[0].type).toBe('pstoRequest')
  const query = new PgDialect().sqlToQuery(execute.mock.calls[1][0])
  expect(query.sql).toContain('limit 1000')
  expect(query.sql).not.toContain('sourcePositions')
})

it('refuses facts which grew beyond the budget since the catalog check', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ bytes: REBUILD_FACT_BYTES_LIMIT + 1 }] })
  await expect(assertRebuildFactBudget({ execute } as never, [1], [2])).rejects.toThrow('не изменены и не обрезаны')
})

it('counts weld, cycle and before-heat-treatment facts together before materializing them', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ bytes: REBUILD_FACT_BYTES_LIMIT + 1 }] })
  await expect(assertRebuildFactBudget({ execute } as never, [1], [2], [3])).rejects.toThrow('64 МиБ')
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
  expect(query.sql).toContain('pre_heat_treatment_controls')
  expect(query.params).toEqual([[1], [2], [3]])
  expect(execute).toHaveBeenCalledTimes(1)
})

it('limits occupied-number metadata to the selected counters, not every document kind', async () => {
  const execute = vi.fn().mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({ rows: [] })
  for await (const _document of readRebuildIdentities({ execute } as never, ['tvmtRequest'])) { /* no records */ }
  for (const [query] of execute.mock.calls) {
    expect(new PgDialect().sqlToQuery(query).params[0]).toEqual(['system:tvmtRequest'])
  }
})
