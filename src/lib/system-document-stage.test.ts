import { describe, expect, it } from 'vitest'

import {
  getScopedSystemDocumentMethodValues,
  getScopedSystemDocumentStageValues,
  getSystemDocumentMethodCodes,
  getSystemDocumentStageLabel,
  getSystemDocumentStageTransferLabel,
} from '@/lib/system-document-stage'
import type { SystemDocumentSummary } from '@/lib/system-document-types'

describe('system document stages', () => {
  it('uses the explicit LNK stage names and scopes TVMT by method', () => {
    expect(getScopedSystemDocumentStageValues('lnk')).toEqual(['До ТО', 'Основной'])
    expect(getScopedSystemDocumentStageValues('tvmt')).toEqual([])
    expect(getScopedSystemDocumentMethodValues('tvmt')).toEqual(['ТВМТ'])
  })

  it('labels primary and repeated cycle documents without limiting the cycle count', () => {
    expect(getSystemDocumentStageLabel(summary({ type: 'pstoRequest' }))).toBe('Цикл 1')
    expect(getSystemDocumentStageLabel(summary({ type: 'lnkConclusion', methodCodes: ['ВИК'] }))).toBe('Основной')
    expect(getSystemDocumentStageLabel(summary({
      type: 'pstoConclusion',
      sourceKind: 'pstoRepeat',
      cycleSequences: [4],
    }))).toBe('Цикл 4')
    expect(getSystemDocumentStageLabel(summary({
      type: 'lnkConclusion',
      methodCodes: ['ТВМТ'],
      sourceKind: 'pstoCycle',
      cycleSequences: [2, 3],
    }))).toBe('Циклы 2, 3')
    expect(getSystemDocumentStageLabel(summary({
      type: 'pstoRequest',
      sourceKind: 'pstoCycle',
      cycleSequences: [1, 3],
    }))).toBe('Циклы 1, 3')
  })

  it('normalizes repeated method metadata and uses the approved transfer labels', () => {
    const beforeHeatTreatment = summary({
      sourceKind: 'beforeHeatTreatment',
      methodCodes: ['ВИК', ' ВИК ', 'РК'],
    })

    expect(getSystemDocumentMethodCodes(beforeHeatTreatment)).toEqual(['ВИК', 'РК'])
    expect(getSystemDocumentStageTransferLabel(beforeHeatTreatment)).toBe('Перенести в «Основной»')
    expect(getSystemDocumentStageTransferLabel(summary({ methodCodes: ['ВИК'] })))
      .toBe('Перенести в «До ТО»')
  })
})

function summary(overrides: Partial<SystemDocumentSummary>): SystemDocumentSummary {
  return {
    id: 'document-1',
    documentId: 1,
    type: 'lnkConclusion',
    label: 'Заключение ЛНК',
    title: 'Документ',
    fileName: 'Документ.xlsx',
    date: '2026-08-29',
    methodCodes: [],
    rowIds: [1],
    rowCount: 1,
    positionCount: 1,
    projects: [],
    subtitleCodes: [],
    lines: [],
    periodFrom: '',
    periodTo: '',
    updatedAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  }
}
