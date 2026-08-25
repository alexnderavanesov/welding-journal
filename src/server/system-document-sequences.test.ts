import { describe, expect, it } from 'vitest'

import {
  applyReservedSystemDocumentNames,
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

  it('keeps independent provisional names valid for one transactional batch', () => {
    const updates = ['Заключение-РК-012', 'Заключение-РК-013'].map((provisionalName) =>
      normalizeSystemDocumentSequenceUpdate({
        type: 'lnkConclusion',
        date: '2026-08-24',
        methodCode: 'РК',
        fieldKeys: ['rkConclusion'],
        provisionalName,
      }),
    )

    expect(updates.map((update) => update.provisionalName)).toEqual([
      'Заключение-РК-012',
      'Заключение-РК-013',
    ])
  })

  it('does not let a skipped occupied number capture the next split group', () => {
    const records = [
      { id: 1, rkConclusion: 'ЗНК-РК-001' },
      { id: 2, rkConclusion: 'ЗНК-РК-002' },
    ]
    const reservations = [
      {
        name: 'ЗНК-РК-002',
        request: normalizeSystemDocumentSequenceUpdate({
          type: 'lnkConclusion',
          date: '2026-08-25',
          methodCode: 'РК',
          fieldKeys: ['rkConclusion'],
          provisionalName: 'ЗНК-РК-001',
        }),
      },
      {
        name: 'ЗНК-РК-003',
        request: normalizeSystemDocumentSequenceUpdate({
          type: 'lnkConclusion',
          date: '2026-08-25',
          methodCode: 'РК',
          fieldKeys: ['rkConclusion'],
          provisionalName: 'ЗНК-РК-002',
        }),
      },
    ]

    expect(applyReservedSystemDocumentNames(records, reservations)).toEqual([
      { id: 1, rkConclusion: 'ЗНК-РК-002' },
      { id: 2, rkConclusion: 'ЗНК-РК-003' },
    ])
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

  it('does not reuse a removed number from the middle of a split conclusion series', () => {
    const rows = Array.from({ length: 9 }, (_, index) => index + 13)
      .filter((number) => number !== 17)
      .map((number) => ({
        id: number,
        vikConclusion: `ЗНК-ВИК-25.08.2026-${String(number).padStart(3, '0')}`,
        vikConclusionDate: '2026-08-25',
      }))

    expect(getInitialSystemDocumentSequenceNumbers(rows).lnkConclusionVik).toBe(22)
  })
})
