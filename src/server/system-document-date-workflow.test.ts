import { describe, expect, it } from 'vitest'

import {
  assertSystemDocumentDatePlanCoversAssignments,
  isSystemDocumentDateIdentityConflict,
  normalizeSystemDocumentDateChangeData,
} from '@/server/system-document-date-workflow'
import { assertExpectedInteractiveWeldVersions } from '@/server/weld-row-version'

describe('system document date workflow contract', () => {
  it('normalizes one exact document identity, cycle scope, date, and row versions', () => {
    expect(normalizeSystemDocumentDateChangeData({
      reference: {
        documentId: 17.9,
        type: 'pstoConclusion',
        title: '  Диаграмма повтор 2  ',
        date: '2026-08-09T00:00:00.000Z',
        sourceKind: 'pstoCycle',
        cycleSequences: [2, 2, 3.8, 0],
      },
      nextDate: '2026-08-10T12:00:00.000Z',
      expectedVersions: [
        { id: 5.9, version: ' v5 ' },
        { id: -1, version: 'ignored' },
      ],
    })).toEqual({
      reference: {
        documentId: 17,
        type: 'pstoConclusion',
        title: 'Диаграмма повтор 2',
        date: '2026-08-09',
        sourceKind: 'pstoCycle',
        cycleSequences: [2, 3],
      },
      nextDate: '2026-08-10',
      expectedVersions: [{ id: 5, version: 'v5' }],
    })
  })

  it('rejects a request without a complete document identity', () => {
    expect(() => normalizeSystemDocumentDateChangeData({
      reference: {
        type: 'lnkRequest',
        title: '',
        date: '2026-08-09',
      },
      nextDate: '2026-08-10',
      expectedVersions: [],
    })).toThrow('Не указано текущее наименование документа')
  })

  it('accepts a named document with a missing current date for repair', () => {
    expect(normalizeSystemDocumentDateChangeData({
      reference: {
        type: 'lnkRequest',
        title: 'Заявка без даты',
        date: '',
      },
      nextDate: '2026-08-10',
      expectedVersions: [{ id: 5, version: 'v5' }],
    })).toEqual({
      reference: {
        type: 'lnkRequest',
        title: 'Заявка без даты',
        date: '',
      },
      nextDate: '2026-08-10',
      expectedVersions: [{ id: 5, version: 'v5' }],
    })
  })

  it('rejects one stale row version before an all-position document update can start', () => {
    expect(() => assertExpectedInteractiveWeldVersions(
      [5, 6],
      [
        { id: 5, version: 'old-v5' },
        { id: 6, version: 'v6' },
      ],
      [
        { id: 5, line: 'L-1', joint: 'F5', rowVersion: 'new-v5' },
        { id: 6, line: 'L-1', joint: 'F6', rowVersion: 'v6' },
      ],
    )).toThrow('Стык L-1 · F5 уже изменен другим пользователем')
  })

  it('rejects a partial plan when one assigned weld no longer contains the document position', () => {
    expect(() => assertSystemDocumentDatePlanCoversAssignments([5, 6], [5])).toThrow(
      'Состав или реквизиты документа уже изменились',
    )
    expect(() => assertSystemDocumentDatePlanCoversAssignments([5, 5, 6], [6, 5])).not.toThrow()
  })

  it('allows the same name and date in a different document identity scope', () => {
    const pstoCycleMetadata = JSON.stringify({
      sourceKind: 'pstoCycle',
      cycleSequences: [2],
      sourcePositions: [],
    })

    expect(isSystemDocumentDateIdentityConflict(pstoCycleMetadata, {
      type: 'pstoConclusion',
      title: 'Общее имя',
      date: '2026-08-10',
    })).toBe(false)
    expect(isSystemDocumentDateIdentityConflict(pstoCycleMetadata, {
      type: 'pstoConclusion',
      title: 'Общее имя',
      date: '2026-08-10',
      sourceKind: 'pstoCycle',
      cycleSequences: [3],
    })).toBe(true)
    expect(isSystemDocumentDateIdentityConflict(null, {
      type: 'pstoConclusion',
      title: 'Общее имя',
      date: '2026-08-10',
      sourceKind: 'pstoCycle',
      cycleSequences: [2],
    })).toBe(true)
  })
})
