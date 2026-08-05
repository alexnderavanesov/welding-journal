import { describe, expect, it } from 'vitest'

import {
  buildSystemDocumentSummaries,
  getSystemDocumentReferenceForField,
} from '@/lib/system-document-types'
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
})
