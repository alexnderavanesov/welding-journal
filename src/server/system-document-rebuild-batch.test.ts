import { expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { loadRebuildBatch, readRebuildIdentities, assertRebuildFactBudget } from './system-document-rebuild-batch'
import { REBUILD_DOCUMENT_LIMIT, REBUILD_FACT_BYTES_LIMIT } from '@/lib/system-document-rebuild-batch'

it('binds storage types as one PostgreSQL array and limits catalog before loading facts', async () => {
  const execute = vi.fn().mockResolvedValueOnce({ rows: [{ id: 900000 }] }).mockResolvedValueOnce({ rows: [] })
  const batch = await loadRebuildBatch({ execute } as never)
  expect(batch.documentIds).toEqual([])
  expect(execute).toHaveBeenCalledTimes(2)
  const queries = execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query))
  expect(queries[0].sql).toContain('any($1::text[])')
  expect(queries[0].params[0]).toEqual(expect.arrayContaining(['system:pstoRequest', 'system:tvmtConclusion']))
  expect(queries[1].sql).toContain('limit $')
  expect(queries[1].params.at(-1)).toBe(REBUILD_DOCUMENT_LIMIT + 1)
  expect(queries[1].sql).not.toContain('select "weld_joints".*')
})

it('splits by full fact bytes before Node receives any wide weld/cycle data', async () => {
  const execute = vi.fn().mockResolvedValueOnce({ rows: [1, 2].map(documentId => ({ documentId, title: `D${documentId}`, positionCount: 10, metadataBytes: 100 })) })
    .mockResolvedValueOnce({ rows: [1, 2].map(documentId => ({ documentId, bytes: 40 * 1024 * 1024 })) })
  const batch = await loadRebuildBatch({ execute } as never, { afterId: 0, throughId: 2 })
  expect(batch.documentIds).toEqual([1])
  expect(batch.nextCursor).toEqual({ afterId: 1, throughId: 2 })
  expect(execute).toHaveBeenCalledTimes(2)
})

it('does not pull unprobed candidates into a batch after an oversized fact record', async () => {
  const execute = vi.fn().mockResolvedValueOnce({ rows: [1, 2].map(documentId => ({ documentId, title: `D${documentId}`, positionCount: 40_000, metadataBytes: 100 })) })
    .mockResolvedValueOnce({ rows: [{ documentId: 1, bytes: REBUILD_FACT_BYTES_LIMIT + 1 }] })
  const batch = await loadRebuildBatch({ execute } as never, { afterId: 0, throughId: 2 })
  expect(batch.documentIds).toEqual([])
  expect(batch.blocked.map(item => item.documentId)).toEqual([1])
  expect(batch.nextCursor).toEqual({ afterId: 1, throughId: 2 })
})

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
