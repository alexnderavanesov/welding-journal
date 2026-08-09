import { describe, expect, it } from 'vitest'

import {
  getInitialSystemDocumentSequenceNumbers,
  normalizeSystemDocumentSequenceUpdate,
} from '@/server/system-document-sequences'

describe('system document sequence update', () => {
  it('accepts several LNK request fields in one system request', () => {
    expect(
      normalizeSystemDocumentSequenceUpdate({
        type: 'lnkRequest',
        date: '2026-08-06',
        fieldKeys: ['vikRequest', 'rkRequest'],
        provisionalName: 'Заявка-06.08.2026-001',
      }),
    ).toEqual({
      type: 'lnkRequest',
      date: '2026-08-06',
      fieldKeys: ['vikRequest', 'rkRequest'],
      provisionalName: 'Заявка-06.08.2026-001',
    })
  })

  it('requires the matching conclusion field for the selected LNK method', () => {
    expect(() =>
      normalizeSystemDocumentSequenceUpdate({
        type: 'lnkConclusion',
        date: '2026-08-06',
        methodCode: 'РК',
        fieldKeys: ['uzkConclusion'],
        provisionalName: 'Заключение-РК-06.08.2026-001',
      }),
    ).toThrow('Не указан вид контроля заключения ЛНК.')
  })

  it('rejects an empty provisional system name', () => {
    expect(() =>
      normalizeSystemDocumentSequenceUpdate({
        type: 'pstoRequest',
        date: '2026-08-06',
        fieldKeys: ['pstoRequest'],
        provisionalName: '',
      }),
    ).toThrow('Не указано предварительное имя системного документа.')
  })

  it('continues LNK conclusion numbering independently for every form', () => {
    const sequences = getInitialSystemDocumentSequenceNumbers([
      {
        id: 1,
        vikConclusion: 'Заключение-ВИК-06.08.2026-007',
        vikConclusionDate: '2026-08-06',
      },
      {
        id: 2,
        rkConclusion: 'Заключение-РК-06.08.2026-002',
        rkConclusionDate: '2026-08-06',
      },
      {
        id: 3,
        rfaConclusion: 'Заключение-РФА-06.08.2026-004',
        rfaConclusionDate: '2026-08-06',
      },
      {
        id: 4,
        tvmtConclusion: 'Заключение-ТВМТ-06.08.2026-006',
        tvmtConclusionDate: '2026-08-06',
      },
    ])

    expect(sequences.lnkConclusionVik).toBe(8)
    expect(sequences.lnkConclusionRk).toBe(3)
    expect(sequences.lnkConclusionUzk).toBe(1)
    expect(sequences.lnkConclusionPvk).toBe(1)
    expect(sequences.lnkConclusionOther).toBe(7)
  })
})
