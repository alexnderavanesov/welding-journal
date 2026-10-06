import { expect, it } from 'vitest'
import { normalizeRebuildCursor, selectRebuildBatch, REBUILD_POSITION_LIMIT } from './system-document-rebuild-batch'

const entry = (documentId: number, positionCount = 1) => ({ documentId, title: `D${documentId}`, positionCount, metadataBytes: 100 })
it.each([100, 200, 300])('takes at most %i whole documents and continues by stable ID', limit => {
  const entries = Array.from({ length: limit + 1 }, (_, i) => entry(i + 1))
  const batch = selectRebuildBatch(entries, { afterId: 0, throughId: 1000 }, limit)
  expect(batch.documentIds).toHaveLength(limit)
  expect(batch.nextCursor).toEqual({ afterId: limit, throughId: 1000 })
})
it('stops before a document that would overflow positions, without splitting or losing it', () => {
  const batch = selectRebuildBatch([entry(10, 40_000), entry(11, 30_000)], { afterId: 0, throughId: 11 })
  expect(batch.documentIds).toEqual([10])
  expect(batch.nextCursor).toEqual({ afterId: 10, throughId: 11 })
})
it('reports an oversized document unchanged, while allowing subsequent documents', () => {
  const batch = selectRebuildBatch([entry(1, REBUILD_POSITION_LIMIT + 1), entry(2)], { afterId: 0, throughId: 2 })
  expect(batch.blocked[0].documentId).toBe(1)
  expect(batch.documentIds).toEqual([2])
  expect(batch.nextCursor).toBeNull()
})
it('also caps metadata independently of record count', () => {
  const batch = selectRebuildBatch([1, 2].map(id => ({ ...entry(id), metadataBytes: 5 * 1024 * 1024 })), { afterId: 0, throughId: 2 })
  expect(batch.documentIds).toEqual([1])
  expect(batch.nextCursor?.afterId).toBe(1)
})
it.each([{ afterId: -1, throughId: 2 }, { afterId: 3, throughId: 2 }, { afterId: 0.5, throughId: 2 }])('rejects malformed cursors %j', cursor => {
  expect(() => normalizeRebuildCursor(cursor)).toThrow('Некорректная область')
})
