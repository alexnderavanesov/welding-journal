import { describe, expect, it } from 'vitest'

import {
  buildCurrentSystemDocumentName,
  buildSystemDocumentRenameRows,
  buildSystemDocumentSummaries,
  getSystemDocumentReferenceForField,
  getSystemDocumentNumber,
  getSystemDocumentRenameNumber,
  getSystemDocumentTargetReport,
  isSystemDocumentNameForRows,
} from '@/lib/system-document-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

function row(id: number, values: Partial<WeldRow>): WeldRow {
  return {
    id,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'Линия А',
    joint: `S${id}`,
    weldDate: '2026-08-01',
    ...values,
  } as WeldRow
}

describe('system document grouping', () => {
  it.each([
    ['lnkRequest', 'lnk'],
    ['lnkConclusion', 'lnk'],
    ['pstoRequest', 'heatTreatment'],
    ['pstoConclusion', 'heatTreatment'],
  ] as const)('opens %s rows in the matching report', (type, report) => {
    expect(getSystemDocumentTargetReport(type)).toBe(report)
  })

  it('opens TVMT documents in heat treatment while keeping other LNK documents in LNK', () => {
    const [tvmtRequest] = buildSystemDocumentSummaries([
      row(1, { tvmtRequest: 'ТВМТ-1', tvmtRequestDate: '2026-08-02' }),
    ], 'lnkRequest')
    const [vikRequest] = buildSystemDocumentSummaries([
      row(1, { vikRequest: 'ВИК-1', vikRequestDate: '2026-08-02' }),
    ], 'lnkRequest')

    expect(getSystemDocumentTargetReport(tvmtRequest)).toBe('heatTreatment')
    expect(tvmtRequest).toMatchObject({ methodCode: 'ТВМТ', label: 'Заявка ТВМТ' })
    expect(getSystemDocumentTargetReport(vikRequest)).toBe('lnk')
  })

  it('does not merge TVMT and LNK requests with the same name and date', () => {
    const documents = buildSystemDocumentSummaries([
      row(1, {
        vikRequest: 'Общее имя',
        vikRequestDate: '2026-08-02',
        tvmtRequest: 'Общее имя',
        tvmtRequestDate: '2026-08-02',
      }),
    ], 'lnkRequest')

    expect(documents).toHaveLength(2)
    expect(documents.map((document) => document.methodCode ?? 'ЛНК').sort()).toEqual(['ЛНК', 'ТВМТ'])
  })

  it('combines LNK request methods with the same name and date into one document', () => {
    const documents = buildSystemDocumentSummaries(
      [
        row(1, {
          vikRequest: 'Заявка-001',
          vikRequestDate: '2026-08-02',
          rkRequest: 'Заявка-001',
          rkRequestDate: '2026-08-02',
        }),
        row(2, {
          uzkRequest: 'Заявка-001',
          uzkRequestDate: '2026-08-02',
        }),
      ],
      'lnkRequest',
    )

    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      title: 'Заявка-001',
      date: '2026-08-02',
      rowCount: 2,
      positionCount: 3,
      methodCodes: ['ВИК', 'РК', 'УЗК'],
    })
  })

  it('keeps requests with different dates as different documents', () => {
    const documents = buildSystemDocumentSummaries(
      [
        row(1, { vikRequest: 'Заявка-001', vikRequestDate: '2026-08-02' }),
        row(2, { vikRequest: 'Заявка-001', vikRequestDate: '2026-08-03' }),
      ],
      'lnkRequest',
    )

    expect(documents).toHaveLength(2)
  })

  it('keeps LNK conclusions separated by control method', () => {
    const documents = buildSystemDocumentSummaries(
      [
        row(1, {
          vikConclusion: 'Заключение-001',
          vikConclusionDate: '2026-08-03',
          rkConclusion: 'Заключение-001',
          rkConclusionDate: '2026-08-03',
        }),
      ],
      'lnkConclusion',
    )

    expect(documents).toHaveLength(2)
    expect(documents.map((document) => document.methodCode)).toEqual(['ВИК', 'РК'])
  })

  it('removes only one split conclusion when its position is cleared', () => {
    const rows = Array.from({ length: 9 }, (_, index) => index + 13).map((number) =>
      row(number, {
        vikConclusion: `ЗНК-ВИК-25.08.2026-${String(number).padStart(3, '0')}`,
        vikConclusionDate: '2026-08-25',
      }),
    )
    const rowsAfterDeleting17 = rows.map((sourceRow) =>
      sourceRow.id === 17
        ? { ...sourceRow, vikConclusion: null, vikConclusionDate: null }
        : sourceRow,
    )

    expect(buildSystemDocumentSummaries(rowsAfterDeleting17, 'lnkConclusion').map((document) => document.title))
      .toEqual([
        'ЗНК-ВИК-25.08.2026-021',
        'ЗНК-ВИК-25.08.2026-020',
        'ЗНК-ВИК-25.08.2026-019',
        'ЗНК-ВИК-25.08.2026-018',
        'ЗНК-ВИК-25.08.2026-016',
        'ЗНК-ВИК-25.08.2026-015',
        'ЗНК-ВИК-25.08.2026-014',
        'ЗНК-ВИК-25.08.2026-013',
      ])
  })

  it('builds PSTO request and conclusion references from report fields', () => {
    const source = row(1, {
      pstoRequest: 'Заявка-ПСТО-001',
      pstoRequestDate: '2026-08-02',
      heatTreatmentDiagram: 'Заключение-ПСТО-001',
      pstoDate: '2026-08-03',
    })

    expect(getSystemDocumentReferenceForField(source, 'pstoRequest')).toEqual({
      type: 'pstoRequest',
      title: 'Заявка-ПСТО-001',
      date: '2026-08-02',
      sourceKind: 'pstoCycle',
      cycleSequences: [1],
    })
    expect(getSystemDocumentReferenceForField(source, 'heatTreatmentDiagram')).toEqual({
      type: 'pstoConclusion',
      title: 'Заключение-ПСТО-001',
      date: '2026-08-03',
      sourceKind: 'pstoCycle',
      cycleSequences: [1],
    })
  })

  it('builds exact LNK request and conclusion references from the clicked document fields', () => {
    const source = row(1, {
      rkRequest: 'Заявка-РК-001',
      rkRequestDate: '2026-08-02',
      tvmtRequest: 'Заявка-ТВМТ-001',
      tvmtRequestDate: '2026-08-02',
      uzkConclusion: 'Заключение-УЗК-001',
      uzkConclusionDate: '2026-08-03',
    })

    expect(getSystemDocumentReferenceForField(source, 'rkRequest')).toEqual({
      type: 'lnkRequest',
      title: 'Заявка-РК-001',
      date: '2026-08-02',
    })
    expect(getSystemDocumentReferenceForField(source, 'uzkConclusion')).toEqual({
      type: 'lnkConclusion',
      title: 'Заключение-УЗК-001',
      date: '2026-08-03',
      methodCode: 'УЗК',
    })
    expect(getSystemDocumentReferenceForField(source, 'tvmtRequest')).toEqual({
      type: 'lnkRequest',
      title: 'Заявка-ТВМТ-001',
      date: '2026-08-02',
      methodCode: 'ТВМТ',
      sourceKind: 'pstoCycle',
      cycleSequences: [1],
    })
    expect(getSystemDocumentReferenceForField(source, 'uzkConclusionDate')).toBeNull()
  })

  it('builds source-scoped references for pre-heat-treatment document fields', () => {
    const source = row(1, {
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'РК',
        requestName: 'Заявка РК до ТО',
        requestDate: '2026-08-02',
        result: 'годен',
        conclusionDate: '2026-08-03',
        conclusionName: 'ЗНК-РК до ТО',
      }],
    })

    expect(getSystemDocumentReferenceForField(source, 'preRkRequest')).toEqual({
      type: 'lnkRequest',
      title: 'Заявка РК до ТО',
      date: '2026-08-02',
      sourceKind: 'beforeHeatTreatment',
    })
    expect(getSystemDocumentReferenceForField(source, 'preRkConclusion')).toEqual({
      type: 'lnkConclusion',
      title: 'ЗНК-РК до ТО',
      date: '2026-08-03',
      methodCode: 'РК',
      sourceKind: 'beforeHeatTreatment',
    })
  })

  it('builds source-scoped references from the current repeat PSTO and TVMT cycle', () => {
    const source = row(1, {
      pstoRequest: 'Заявка ПСТО основная',
      pstoRequestDate: '2026-08-01',
      heatTreatmentDiagram: 'Диаграмма основная',
      pstoDate: '2026-08-02',
      tvmtRequest: 'Заявка ТВМТ основная',
      tvmtRequestDate: '2026-08-03',
      tvmtConclusion: 'Заключение ТВМТ основное',
      tvmtConclusionDate: '2026-08-04',
      pstoRepeatCycles: [{
        id: 21,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Заявка ПСТО повтор 2',
        pstoRequestDate: '2026-08-05',
        heatTreatmentDiagram: 'Диаграмма повтор 2',
        pstoDate: '2026-08-06',
        tvmtRequest: 'Заявка ТВМТ повтор 2',
        tvmtRequestDate: '2026-08-07',
        tvmtConclusion: 'Заключение ТВМТ повтор 2',
        tvmtConclusionDate: '2026-08-08',
      }],
    })

    expect(getSystemDocumentReferenceForField(source, 'pstoRequest')).toEqual({
      type: 'pstoRequest',
      title: 'Заявка ПСТО повтор 2',
      date: '2026-08-05',
      sourceKind: 'pstoCycle',
      cycleSequences: [2],
    })
    expect(getSystemDocumentReferenceForField(source, 'heatTreatmentDiagram')).toEqual({
      type: 'pstoConclusion',
      title: 'Диаграмма повтор 2',
      date: '2026-08-06',
      sourceKind: 'pstoCycle',
      cycleSequences: [2],
    })
    expect(getSystemDocumentReferenceForField(source, 'tvmtRequest')).toEqual({
      type: 'lnkRequest',
      title: 'Заявка ТВМТ повтор 2',
      date: '2026-08-07',
      methodCode: 'ТВМТ',
      sourceKind: 'pstoCycle',
      cycleSequences: [2],
    })
    expect(getSystemDocumentReferenceForField(source, 'tvmtConclusion')).toEqual({
      type: 'lnkConclusion',
      title: 'Заключение ТВМТ повтор 2',
      date: '2026-08-08',
      methodCode: 'ТВМТ',
      sourceKind: 'pstoCycle',
      cycleSequences: [2],
    })
  })

  it('reads a system document number using the current naming rule', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Заявка №{{№}} от {{Дата}}',
      },
    }

    expect(
      getSystemDocumentNumber(
        {
          type: 'lnkRequest',
          title: 'Заявка №014 от 02.08.2026',
          date: '2026-08-02',
        },
        settings,
      ),
    ).toBe('014')
  })

  it('keeps reading the number from an earlier default system name after the rule changes', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Заявка №{{№}}',
      },
    }

    expect(
      getSystemDocumentNumber(
        {
          type: 'lnkRequest',
          title: 'Заявка-21.07.2026-002',
          date: '2026-07-21',
        },
        settings,
      ),
    ).toBe('002')
  })

  it('keeps the original number when literal digits are added next to the number token', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Заявка НК №{{Шифр}}-{{№}}',
        systemPatternHistory: ['Заявка НК №{{Шифр}}-{{№}}3333333'],
      },
    }

    expect(
      getSystemDocumentNumber(
        {
          type: 'lnkRequest',
          title: 'Заявка НК №400-0033333333',
          date: '2026-08-06',
          projects: ['Риформинг'],
          subtitleCodes: ['400'],
          lines: ['LIN-001'],
        } as Parameters<typeof getSystemDocumentNumber>[0],
        settings,
      ),
    ).toBe('003')
  })

  it('restores the allocated number when digits were appended manually to a system name', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Заявка НК №{{Шифр}}-{{№}}',
      },
    }

    expect(
      getSystemDocumentRenameNumber(
        {
          type: 'lnkRequest',
          title: 'Заявка НК №400-0055',
          date: '2026-08-08',
          projects: ['Риформинг'],
          subtitleCodes: ['400'],
          lines: ['LIN-001'],
        } as Parameters<typeof getSystemDocumentRenameNumber>[0],
        settings,
        6,
      ),
    ).toBe('005')
  })

  it('restores a one-digit allocated number after one digit was appended', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Заявка НК №{{Шифр}}-{{№}}',
      },
    }

    expect(
      getSystemDocumentRenameNumber(
        {
          type: 'lnkRequest',
          title: 'Заявка НК №400-55',
          date: '2026-08-08',
          projects: ['Риформинг'],
          subtitleCodes: ['400'],
          lines: ['LIN-001'],
        } as Parameters<typeof getSystemDocumentRenameNumber>[0],
        settings,
        6,
      ),
    ).toBe('005')
  })

  it('does not accept an implausible appended digit sequence as a document number', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Заявка НК №{{Шифр}}-{{№}}',
      },
    }

    expect(
      getSystemDocumentRenameNumber(
        {
          type: 'lnkRequest',
          title: 'Заявка НК №400-555555',
          date: '2026-08-08',
          projects: ['Риформинг'],
          subtitleCodes: ['400'],
          lines: ['LIN-001'],
        } as Parameters<typeof getSystemDocumentRenameNumber>[0],
        settings,
        6,
      ),
    ).toBe('005')
  })

  it('keeps an unchanged system number after the counter has advanced', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Заявка НК №{{Шифр}}-{{№}}',
      },
    }

    expect(
      getSystemDocumentRenameNumber(
        {
          type: 'lnkRequest',
          title: 'Заявка НК №400-005',
          date: '2026-08-08',
          projects: ['Риформинг'],
          subtitleCodes: ['400'],
          lines: ['LIN-001'],
        } as Parameters<typeof getSystemDocumentRenameNumber>[0],
        settings,
        6,
      ),
    ).toBe('005')
  })

  it('does not treat digits in a custom document name as a system number', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Заявка №{{№}}',
      },
    }

    expect(
      getSystemDocumentNumber(
        {
          type: 'lnkRequest',
          title: 'Заявка заказчика 3434',
          date: '2026-07-21',
        },
        settings,
      ),
    ).toBe('')
  })

  it('recognizes a system request created with the current custom naming rule', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: '{{Проект}}-{{Шифр}}-{{№}}',
      },
    }
    const rows = [
      row(1, {
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        vikRequest: 'Риформинг-400-017',
        vikRequestDate: '2026-08-06',
      }),
    ]

    expect(
      isSystemDocumentNameForRows(rows, 'lnkRequest', 'Риформинг-400-017', settings),
    ).toBe(true)
    expect(
      isSystemDocumentNameForRows(rows, 'lnkRequest', 'Заявка заказчика 17', settings),
    ).toBe(false)
  })

  it('recognizes a system request created with an earlier naming rule', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      pstoRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Новая заявка ПСТО №{{№}}',
        systemPatternHistory: ['Старая заявка ПСТО №{{№}}'],
      },
    }
    const rows = [
      row(1, {
        pstoRequest: 'Старая заявка ПСТО №009',
        pstoRequestDate: '2026-08-06',
      }),
    ]

    expect(
      isSystemDocumentNameForRows(rows, 'pstoRequest', 'Старая заявка ПСТО №009', settings),
    ).toBe(true)
  })

  it('builds a current system name with the preserved document number and current row scope', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      lnkRequest: {
        defaultMode: 'system' as const,
        systemPattern: 'Заявка №{{№}} · {{Проект}} · {{Линия}}',
      },
    }

    expect(
      buildCurrentSystemDocumentName(
        {
          type: 'lnkRequest',
          title: 'Заявка-21.07.2026-002',
          date: '2026-07-21',
        },
        [
          row(1, { projectTitle: 'Проект 1', line: 'Линия А' }),
          row(2, { projectTitle: 'Проект 1', line: 'Линия Б' }),
        ],
        settings,
        2,
      ),
    ).toBe('Заявка №002 · Проект 1 · Линия А, Линия Б')
  })

  it('renames every matching method position of one LNK request without touching another date', () => {
    const sourceRows = [
      row(1, {
        vikRequest: 'Старое имя',
        vikRequestDate: '2026-08-02',
        rkRequest: 'Старое имя',
        rkRequestDate: '2026-08-02',
        uzkRequest: 'Старое имя',
        uzkRequestDate: '2026-08-03',
      }),
    ]

    const result = buildSystemDocumentRenameRows(
      {
        type: 'lnkRequest',
        title: 'Старое имя',
        date: '2026-08-02',
      },
      sourceRows,
      'Новое имя',
    )

    expect(result.fieldKeys).toEqual(['vikRequest', 'rkRequest'])
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      vikRequest: 'Новое имя',
      rkRequest: 'Новое имя',
      uzkRequest: 'Старое имя',
    })
  })

  it('renames only the selected LNK conclusion method', () => {
    const result = buildSystemDocumentRenameRows(
      {
        type: 'lnkConclusion',
        title: 'Старое заключение',
        date: '2026-08-03',
        methodCode: 'РК',
      },
      [
        row(1, {
          vikConclusion: 'Старое заключение',
          vikConclusionDate: '2026-08-03',
          rkConclusion: 'Старое заключение',
          rkConclusionDate: '2026-08-03',
        }),
      ],
      'Новое заключение',
    )

    expect(result.fieldKeys).toEqual(['rkConclusion'])
    expect(result.records[0]).toMatchObject({
      vikConclusion: 'Старое заключение',
      rkConclusion: 'Новое заключение',
    })
  })

  it.each([
    {
      type: 'pstoRequest' as const,
      title: 'Старая заявка ПСТО',
      date: '2026-08-02',
      values: {
        pstoRequest: 'Старая заявка ПСТО',
        pstoRequestDate: '2026-08-02',
      },
      fieldKey: 'pstoRequest',
    },
    {
      type: 'pstoConclusion' as const,
      title: 'Старое заключение ПСТО',
      date: '2026-08-03',
      values: {
        heatTreatmentDiagram: 'Старое заключение ПСТО',
        pstoDate: '2026-08-03',
      },
      fieldKey: 'heatTreatmentDiagram',
    },
  ])('renames the matching $type field', ({ type, title, date, values, fieldKey }) => {
    const result = buildSystemDocumentRenameRows(
      { type, title, date },
      [row(1, values)],
      'Новое имя',
    )

    expect(result.fieldKeys).toEqual([fieldKey])
    expect(result.records[0]?.[fieldKey as WeldFieldKey]).toBe('Новое имя')
  })

  it('renames a TVMT request without touching an equally named LNK request', () => {
    const result = buildSystemDocumentRenameRows(
      {
        type: 'lnkRequest',
        title: 'Общее имя',
        date: '2026-08-02',
        methodCode: 'ТВМТ',
      },
      [row(1, {
        vikRequest: 'Общее имя',
        vikRequestDate: '2026-08-02',
        tvmtRequest: 'Общее имя',
        tvmtRequestDate: '2026-08-02',
      })],
      'Новое ТВМТ',
    )

    expect(result.fieldKeys).toEqual(['tvmtRequest'])
    expect(result.records[0]).toMatchObject({
      vikRequest: 'Общее имя',
      tvmtRequest: 'Новое ТВМТ',
    })
  })
})
