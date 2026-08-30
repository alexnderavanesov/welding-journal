import { describe, expect, it } from 'vitest'

import { matchesSourcedSystemDocumentReference } from '@/server/system-document-index'
import { normalizeSystemDocumentReference } from '@/server/system-documents'

describe('system document source navigation', () => {
  it('preserves a supported source stage in a navigation request', () => {
    expect(normalizeSystemDocumentReference({
      type: 'pstoRequest',
      title: 'Повторная заявка ПСТО',
      date: '2026-08-20',
      sourceKind: 'pstoRepeat',
      cycleSequences: [3, 2, 3],
    })).toEqual({
      type: 'pstoRequest',
      title: 'Повторная заявка ПСТО',
      date: '2026-08-20',
      sourceKind: 'pstoRepeat',
      cycleSequences: [2, 3],
    })
  })

  it('rejects an unknown source stage instead of opening a primary document', () => {
    expect(() => normalizeSystemDocumentReference({
      type: 'pstoRequest',
      title: 'Заявка ПСТО',
      date: '2026-08-20',
      sourceKind: 'unknown' as 'pstoRepeat',
    })).toThrow('Неизвестный этап системного документа')
  })

  it('matches sourced documents by both stage and control method', () => {
    const metadata = JSON.stringify({
      label: 'Заключение ТВМТ',
      sourceKind: 'pstoRepeat',
      methodCode: 'ТВМТ',
      methodCodes: ['ТВМТ'],
      positionCount: 1,
      projects: [],
      subtitleCodes: [],
      lines: [],
      periodFrom: '',
      periodTo: '',
      sourcePositions: [],
    })

    expect(matchesSourcedSystemDocumentReference(metadata, {
      sourceKind: 'pstoRepeat',
      methodCode: 'ТВМТ',
    })).toBe(true)
    expect(matchesSourcedSystemDocumentReference(metadata, {
      sourceKind: 'beforeHeatTreatment',
      methodCode: 'ТВМТ',
    })).toBe(false)
    expect(matchesSourcedSystemDocumentReference(metadata, {
      sourceKind: 'pstoRepeat',
      methodCode: 'РК',
    })).toBe(false)
  })
})
