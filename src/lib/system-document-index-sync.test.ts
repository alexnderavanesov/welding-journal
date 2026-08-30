import { describe, expect, it } from 'vitest'

import {
  filterLegacyCycleSummariesShadowedBySourcedDocuments,
  isLegacyPrimaryCycleSummary,
} from '@/lib/system-document-index-sync'
import type { SystemDocumentSummary } from '@/lib/system-document-types'

function summary(
  values: Partial<SystemDocumentSummary> & Pick<SystemDocumentSummary, 'type' | 'title'>,
): SystemDocumentSummary {
  return {
    id: values.title,
    documentId: 0,
    label: values.title,
    fileName: `${values.title}.xlsx`,
    date: '2026-08-29',
    methodCodes: [],
    rowCount: 1,
    positionCount: 1,
    projects: [],
    subtitleCodes: [],
    lines: [],
    periodFrom: '',
    periodTo: '',
    updatedAt: '',
    rowIds: [1],
    ...values,
  }
}

describe('system document index cycle synchronization', () => {
  it('recognizes PSTO and TVMT summaries as fields managed by the cycle registry', () => {
    expect(isLegacyPrimaryCycleSummary(summary({
      type: 'pstoRequest',
      title: 'ПСТО-001',
    }))).toBe(true)
    expect(isLegacyPrimaryCycleSummary(summary({
      type: 'lnkRequest',
      title: 'ТВМТ-001',
      methodCodes: ['ТВМТ'],
    }))).toBe(true)
    expect(isLegacyPrimaryCycleSummary(summary({
      type: 'lnkRequest',
      title: 'ЛНК-001',
      methodCodes: ['ВИК', 'РК'],
    }))).toBe(false)
  })

  it('does not rebuild legacy PSTO and TVMT documents beside matching sourced cycle documents', () => {
    const mainRequest = summary({
      type: 'lnkRequest',
      title: 'ЛНК-001',
      methodCodes: ['ВИК', 'РК'],
    })
    const tvmtRequest = summary({
      type: 'lnkRequest',
      title: 'ТВМТ-001',
      methodCodes: ['ТВМТ'],
    })
    const pstoRequest = summary({
      type: 'pstoRequest',
      title: 'ПСТО-001',
    })

    expect(filterLegacyCycleSummariesShadowedBySourcedDocuments(
      [mainRequest, tvmtRequest, pstoRequest],
      [
        { ...tvmtRequest, sourceKind: 'pstoCycle', methodCode: 'ТВМТ' },
        { ...pstoRequest, sourceKind: 'pstoCycle' },
      ],
    )).toEqual([mainRequest])
  })

  it('keeps legacy cycle documents until a sourced replacement actually exists', () => {
    const pstoRequest = summary({ type: 'pstoRequest', title: 'ПСТО-001' })

    expect(filterLegacyCycleSummariesShadowedBySourcedDocuments(
      [pstoRequest],
      [{ ...pstoRequest, title: 'ПСТО-002', sourceKind: 'pstoCycle' }],
    )).toEqual([pstoRequest])
  })
})
