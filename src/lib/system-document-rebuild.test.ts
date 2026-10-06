import { describe, expect, it } from 'vitest'

import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import {
  buildSystemDocumentRebuildDocuments,
  getSystemDocumentRebuildDecisionError,
  getSystemDocumentRebuildSelectionSummary,
} from '@/lib/system-document-rebuild'
import type { WeldRow } from '@/lib/dispatcher-types'

const rows = [
  { id: 1, projectTitle: 'П', subtitleCode: '01', line: 'L', joint: '1' },
  { id: 2, projectTitle: 'П', subtitleCode: '01', line: 'L', joint: '2' },
] as WeldRow[]

describe('system document rebuild preview', () => {
  it('refuses multiplied large output without returning a truncated set of groups', () => {
    const longRows = Array.from({ length: 10 }, (_, i) => ({ ...rows[0], id: i + 1, joint: `${i}-${'X'.repeat(500_000)}` }))
    expect(() => buildSystemDocumentRebuildDocuments({
      sources: [{ document: { documentId: 1, type: 'pstoRequest', title: 'Ручной', date: '2026-09-01', rowIds: longRows.map(row => row.id) } as never, rows: longRows }],
      settings: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS, splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, pstoRequest: 'joint' } },
      nextNumbers: {},
    })).toThrow('Предпросмотр пакета слишком объёмный')
    expect(longRows).toHaveLength(10)
  })

  it('reserves numbers owned outside the selected packet as well', () => {
    const preview = buildSystemDocumentRebuildDocuments({
      sources: [{ document: { documentId: 1, type: 'lnkConclusion', methodCode: 'РК', title: 'Заключение-РК-24.08.2026-005',
        date: '2026-08-24', rowIds: [1, 2] } as never, rows }],
      settings: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS, splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, lnkConclusionRk: 'joint' } },
      nextNumbers: { lnkConclusionRk: 6 }, occupiedNumbers: new Map([['lnkConclusionRk', new Set([6, 7])]]),
    })
    expect(preview.documents[0].groups.map(group => group.previewName)).toEqual(['ЗНК-РК-24.08.2026-005', 'ЗНК-РК-24.08.2026-008'])
  })

  it('splits one system RK conclusion into separate numbered documents', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
        lnkConclusionRk: 'joint' as const,
      },
    }
    const preview = buildSystemDocumentRebuildDocuments({
      sources: [{
        document: {
          documentId: 15,
          id: 'system-document:15',
          type: 'lnkConclusion',
          methodCode: 'РК',
          title: 'Заключение-РК-24.08.2026-005',
          date: '2026-08-24',
          label: 'Заключение ЛНК',
          fileName: 'doc.xlsx',
          methodCodes: ['РК'],
          rowCount: 2,
          positionCount: 2,
          projects: ['П'],
          subtitleCodes: ['01'],
          lines: ['L'],
          periodFrom: '',
          periodTo: '',
          updatedAt: '',
          rowIds: [1, 2],
        },
        rows,
      }],
      settings,
      nextNumbers: { lnkConclusionRk: 5 },
    })

    expect(preview.changedDocumentCount).toBe(1)
    expect(preview.resultingDocumentCount).toBe(2)
    expect(preview.documents[0].groups.map((group) => group.previewName)).toEqual([
      'ЗНК-РК-24.08.2026-005',
      'ЗНК-РК-24.08.2026-006',
    ])
  })

  it('requires a decision instead of automatically splitting a custom name', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
        pstoRequest: 'joint' as const,
      },
    }
    const preview = buildSystemDocumentRebuildDocuments({
      sources: [{
        document: {
          documentId: 7,
          id: 'system-document:7',
          type: 'pstoRequest',
          title: 'Срочная заявка подрядчика',
          date: '2026-08-24',
          label: 'Заявка ПСТО',
          fileName: 'doc.xlsx',
          methodCodes: [],
          rowCount: 2,
          positionCount: 2,
          projects: ['П'],
          subtitleCodes: ['01'],
          lines: ['L'],
          periodFrom: '',
          periodTo: '',
          updatedAt: '',
          rowIds: [1, 2],
        },
        rows,
      }],
      settings,
      nextNumbers: {},
    })

    expect(preview.documents[0].requiresCustomNameDecision).toBe(true)
    expect(preview.documents[0].willChangeAutomatically).toBe(false)

    const selectedTemplateIds = new Set([preview.documents[0].templateId])
    expect(getSystemDocumentRebuildSelectionSummary({
      documents: preview.documents,
      selectedTemplateIds,
      decisions: [{ documentId: 7, action: 'keep' }],
    })).toMatchObject({
      affectedRowCount: 0,
      resultingDocumentCount: 1,
      changedDocuments: [],
    })
    expect(getSystemDocumentRebuildSelectionSummary({
      documents: preview.documents,
      selectedTemplateIds,
      decisions: [{ documentId: 7, action: 'rebuild' }],
    })).toMatchObject({
      affectedRowCount: 2,
      resultingDocumentCount: 2,
      changedDocuments: [preview.documents[0]],
    })
    expect(getSystemDocumentRebuildDecisionError({
      documents: preview.documents,
      selectedTemplateIds,
      decisions: [{
        documentId: 7,
        action: 'rebuild',
        groupNames: Object.fromEntries(preview.documents[0].groups.map((group) => [group.key, 'Одинаковое имя'])),
      }],
    })).toContain('должны различаться')

    expect(getSystemDocumentRebuildDecisionError({
      documents: preview.documents,
      selectedTemplateIds,
      decisions: [{ documentId: 7, action: 'keep' }],
    })).toBe('')
  })

  it('blocks rebuilding a document with an incomplete split identity', () => {
    const preview = buildSystemDocumentRebuildDocuments({
      sources: [{
        document: {
          documentId: 22,
          id: 'system-document:22',
          type: 'pstoRequest',
          title: 'Заявка-ПСТО-24.08.2026-005',
          date: '2026-08-24',
          label: 'Заявка ПСТО',
          fileName: 'doc.xlsx',
          methodCodes: [],
          rowCount: 2,
          positionCount: 2,
          projects: ['П'],
          subtitleCodes: ['01'],
          lines: [],
          periodFrom: '',
          periodTo: '',
          updatedAt: '',
          rowIds: [1, 2],
        },
        rows: [rows[0], { ...rows[1], line: '' }],
      }],
      settings: {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
        splitModes: {
          ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
          pstoRequest: 'line',
        },
      },
      nextNumbers: { pstoRequest: 6 },
    })

    expect(getSystemDocumentRebuildDecisionError({
      documents: preview.documents,
      selectedTemplateIds: new Set(['pstoRequest']),
      decisions: [{ documentId: 22, action: 'rebuild' }],
    })).toContain('Заполните поля разделения')
  })

  it('leaves pre-TO documents outside the rebuild', () => {
    const preview = buildSystemDocumentRebuildDocuments({
      sources: [{
        document: {
          documentId: 30,
          id: 'system-document:30',
          type: 'lnkConclusion',
          methodCode: 'ВИК',
          sourceKind: 'beforeHeatTreatment',
          title: 'ЗНК-ВИК-до-ТО-001',
          date: '2026-08-24',
          label: 'Заключение ВИК до ТО',
          fileName: 'doc.xlsx',
          methodCodes: ['ВИК'],
          rowCount: 1,
          positionCount: 1,
          projects: ['П'],
          subtitleCodes: ['01'],
          lines: ['L'],
          periodFrom: '',
          periodTo: '',
          updatedAt: '',
          rowIds: [1],
        },
        rows: [rows[0]],
      }],
      settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      nextNumbers: {},
    })

    expect(preview.documents).toEqual([])
    expect(preview.checkedDocumentCount).toBe(0)
  })
})
