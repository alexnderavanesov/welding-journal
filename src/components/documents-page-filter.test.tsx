import { describe, expect, it } from 'vitest'
import {
  getDocumentActionErrorMessage,
  getDocumentNavigationColumnFilters,
  getDocumentNavigationViewId,
} from '@/components/documents-page'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'

describe('getDocumentActionErrorMessage', () => {
  it('does not expose database queries in document errors', () => {
    expect(getDocumentActionErrorMessage(
      new Error('Server error: Failed query: select * from "weld_joints"'),
      'Не удалось выполнить действие с документом.',
    )).toBe('Не удалось выполнить действие с документом.')
  })

  it('preserves user-facing validation messages', () => {
    expect(getDocumentActionErrorMessage(
      new Error('Название документа уже занято.'),
      'Не удалось выполнить действие с документом.',
    )).toBe('Название документа уже занято.')
  })
})

describe('document navigation filters', () => {
  it('opens generated journal documents in their view with an exact title filter', () => {
    const request = {
      requestId: 1,
      kind: 'generated' as const,
      documentId: 42,
      type: 'weldingJournal' as const,
      title: 'ЖСР-17',
    }

    expect(getDocumentNavigationViewId(request)).toBe('weldingJournal')
    expect(parseWeldColumnChoiceFilter(getDocumentNavigationColumnFilters(request).title)).toEqual({
      kind: 'values',
      values: ['ЖСР-17'],
    })
  })

  it('selects the exact LNK, PSTO, and layered document registries', () => {
    expect(getDocumentNavigationViewId({
      requestId: 2,
      kind: 'system',
      type: 'lnkConclusion',
      title: 'ВИК-12',
      date: '2026-09-18',
      methodCode: 'ВИК',
    })).toBe('lnkConclusion')
    expect(getDocumentNavigationViewId({
      requestId: 3,
      kind: 'system',
      type: 'pstoConclusion',
      title: 'ПСТО-8',
      date: '2026-09-18',
    })).toBe('pstoConclusion')
    expect(getDocumentNavigationViewId({
      requestId: 4,
      kind: 'generated',
      documentId: 84,
      type: 'layeredVikLayers',
      title: 'ВИК слоев-84',
    })).toBe('layeredVik')
  })
})
