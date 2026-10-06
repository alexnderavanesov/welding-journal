import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { documentTemplates, generatedDocumentWeldJoints, weldJoints } from '@/db/schema'

import {
  getLayeredControlDocumentTypesToRetain,
  getLayeredControlHistoryGuardError,
  persistLayeredControlDocumentWrites,
  syncLayeredControlDocumentsForWeldChangesInTransaction,
} from '@/server/layered-control-documents'

const previous = {
  id: 1,
  joint: 'F1',
  connectionType: 'У17',
  weldDate: '2026-09-01',
  hasVik: 'да',
  hasPvk: 'да',
  layeredControlAssigned: true,
  pvkResult: 'годен',
}

describe('layered control history guard', () => {
  it.each(['ожидает заявку', 'ожидает НК', 'ожидает'])('does not treat %s as a completed layered bundle', pvkResult => {
    const planned = { ...previous, pvkResult }
    expect(getLayeredControlHistoryGuardError({ previous: planned, current: { ...planned, weldDate: '', pvkResult: null } })).toBeNull()
    expect(getLayeredControlDocumentTypesToRetain(planned, planned)).toEqual([])
    // Real linked documents remain protected even if their historical source result is missing.
    expect(getLayeredControlHistoryGuardError({ previous: planned, current: { ...planned, weldDate: '' }, methodsWithDocuments: ['ПВК'] })).toContain('Нельзя очистить дату сварки')
  })
  it('retains the complete bundle independently of legacy VIK assignment', () => {
    expect(getLayeredControlHistoryGuardError({
      previous,
      current: { ...previous, hasVik: 'отменен' },
    })).toBeNull()

    expect(getLayeredControlDocumentTypesToRetain(
      { ...previous, hasVik: 'отменен' },
      previous,
    )).toEqual(['layeredVikEdges', 'layeredVikLayers', 'layeredPvkEdges', 'layeredPvkLayers'])
  })

  it('allows changing the welding date without consuming a new document number', () => {
    expect(getLayeredControlHistoryGuardError({
      previous,
      current: { ...previous, weldDate: '2026-09-02' },
    })).toBeNull()
  })

  it('requires separate removal before clearing or cancelling PVK assignment', () => {
    expect(getLayeredControlHistoryGuardError({
      previous,
      current: { ...previous, hasPvk: '' },
    })).toContain('ПВК = «да»')
    expect(getLayeredControlHistoryGuardError({ previous, current: { ...previous, hasPvk: 'отменен' } })).toContain('ПВК = «да»')
  })

  it('protects the source date and U-joint type after conclusions exist', () => {
    expect(getLayeredControlHistoryGuardError({
      current: { ...previous, weldDate: '' },
      methodsWithDocuments: ['ВИК'],
    })).toContain('Нельзя очистить дату сварки')
    expect(getLayeredControlHistoryGuardError({
      current: { ...previous, connectionType: 'С17' },
      methodsWithDocuments: ['ВИК'],
    })).toContain('только для У-стыков')
  })

  it('never treats an ordinary U-joint as explicit history, but protects an assigned bundle', () => {
    expect(getLayeredControlHistoryGuardError({
      previous: { ...previous, layeredControlAssigned: false },
      current: { ...previous, layeredControlAssigned: false, pvkResult: '' },
      protectPreviousEligibility: false,
    })).toBeNull()

    expect(getLayeredControlHistoryGuardError({
      previous,
      current: { ...previous, pvkResult: '' },
      methodsWithDocuments: ['ВИК'],
      protectPreviousEligibility: false,
    })).toContain('Сначала уберите послойный контроль')
  })
})

describe('layered control document database load', () => {
  it.each([24, 200_000])('checks all %i persisted welds in bounded batches without per-row calls', async count => {
    const visited: number[] = []
    const execute = vi.fn().mockResolvedValue({ rows: [] })
    const select = vi.fn(() => ({ from: (table: unknown) => {
      if (table === generatedDocumentWeldJoints) return { innerJoin: () => ({ where: async () => [] }) }
      if (table === documentTemplates) return { where: async () => [] }
      expect(table).toBe(weldJoints)
      return { where: async (query: SQL) => {
        const ids = new PgDialect().sqlToQuery(query).params[0] as number[]
        expect(ids.length).toBeLessThanOrEqual(5000)
        visited.push(...ids)
        return ids.map(id => ({ id, connectionType: 'С17', layeredControlAssigned: false }))
      } }
    } }))
    await syncLayeredControlDocumentsForWeldChangesInTransaction({ select, execute } as never,
      Array.from({ length: count }, (_, index) => ({ id: count - index })), new Map())
    expect(visited).toEqual(Array.from({ length: count }, (_, index) => index + 1))
    expect(select).toHaveBeenCalledTimes(3 * Math.ceil(count / 5000))
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it.each([2, 100])('inserts %i documents and all assignments with two database calls', async (documentCount) => {
    const execute = vi.fn()
      .mockResolvedValueOnce({
        rows: Array.from({ length: documentCount }, (_, index) => ({
          id: 2_000 + index,
          type: 'layeredVikEdges',
          documentNumber: index + 1,
        })).reverse(),
      })
      .mockResolvedValue({ rows: [] })

    await persistLayeredControlDocumentWrites(
      { execute } as never,
      Array.from({ length: documentCount }, (_, index) => layeredWrite(index, null)),
    )

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it.each([2, 100])('updates %i changed documents with one batch operation', async (documentCount) => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn()

    await persistLayeredControlDocumentWrites(
      { insert, execute } as never,
      Array.from({ length: documentCount }, (_, index) => layeredWrite(index, 3_000 + index)),
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
  })
})

function layeredWrite(index: number, targetDocumentId: number | null) {
  return {
    rowId: index + 1,
    type: 'layeredVikEdges' as const,
    targetDocumentId,
    title: `ВИК кромок ${index + 1}`,
    fileName: `ВИК кромок ${index + 1}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    periodFrom: '2026-09-04',
    periodTo: '2026-09-04',
    rowCount: 1,
    wdiTotal: 1,
    documentNumber: index + 1,
    shouldUpdate: targetDocumentId != null,
  }
}
