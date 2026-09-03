import { describe, expect, it } from 'vitest'

import {
  getLayeredControlDocumentTypesToRetain,
  getLayeredControlHistoryGuardError,
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
