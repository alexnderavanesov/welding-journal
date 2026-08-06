import { describe, expect, it } from 'vitest'

import {
  buildCurrentSystemDocumentName,
  buildSystemDocumentRenameRows,
  buildSystemDocumentSummaries,
  getSystemDocumentReferenceForField,
  getSystemDocumentNumber,
  getSystemDocumentTargetReport,
  isSystemDocumentNameForRows,
} from '@/lib/system-document-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import type { WeldRow } from '@/lib/dispatcher-types'

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
    })
    expect(getSystemDocumentReferenceForField(source, 'heatTreatmentDiagram')).toEqual({
      type: 'pstoConclusion',
      title: 'Заключение-ПСТО-001',
      date: '2026-08-03',
    })
  })

  it('builds exact LNK request and conclusion references from the clicked document fields', () => {
    const source = row(1, {
      rkRequest: 'Заявка-РК-001',
      rkRequestDate: '2026-08-02',
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
    expect(getSystemDocumentReferenceForField(source, 'uzkConclusionDate')).toBeNull()
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
    expect(result.records[0]?.[fieldKey]).toBe('Новое имя')
  })
})
