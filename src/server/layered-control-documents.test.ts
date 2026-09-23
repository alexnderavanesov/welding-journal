import { describe, expect, it, vi } from 'vitest'

import {
  getLayeredControlDocumentTypesToRetain,
  getLayeredControlHistoryGuardError,
  persistLayeredControlDocumentWrites,
} from '@/server/layered-control-documents'

const previous = {
  id: 1,
  joint: 'F1',
  connectionType: 'У17',
  weldDate: '2026-09-01',
  hasVik: 'да',
}

describe('layered control history guard', () => {
  it('allows an explicit cancellation and preserves the historical documents', () => {
    expect(getLayeredControlHistoryGuardError({
      previous,
      current: { ...previous, hasVik: 'отменен' },
    })).toBeNull()

    expect(getLayeredControlDocumentTypesToRetain(
      { ...previous, hasVik: 'отменен' },
      previous,
    )).toEqual(['layeredVikEdges', 'layeredVikLayers'])
  })

  it('allows changing the welding date without consuming a new document number', () => {
    expect(getLayeredControlHistoryGuardError({
      previous,
      current: { ...previous, weldDate: '2026-09-02' },
    })).toBeNull()
  })

  it('requires cancellation instead of silently clearing an assignment', () => {
    expect(getLayeredControlHistoryGuardError({
      previous,
      current: { ...previous, hasVik: '' },
    })).toContain('выберите «отменен»')
  })

  it('protects the source date and U-joint type after conclusions exist', () => {
    expect(getLayeredControlHistoryGuardError({
      current: { ...previous, weldDate: '' },
      methodsWithDocuments: ['ВИК'],
    })).toContain('Нельзя очистить дату сварки')
    expect(getLayeredControlHistoryGuardError({
      current: { ...previous, connectionType: 'С17' },
      methodsWithDocuments: ['ВИК'],
    })).toContain('Нельзя изменить У-стык')
  })

  it('does not treat eligibility as history while document creation is disabled', () => {
    expect(getLayeredControlHistoryGuardError({
      previous,
      current: { ...previous, hasVik: '' },
      protectPreviousEligibility: false,
    })).toBeNull()

    expect(getLayeredControlHistoryGuardError({
      previous,
      current: { ...previous, hasVik: '' },
      methodsWithDocuments: ['ВИК'],
      protectPreviousEligibility: false,
    })).toContain('выберите «отменен»')
  })
})

describe('layered control document database load', () => {
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
