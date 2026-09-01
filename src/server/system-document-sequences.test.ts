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
        tvmtRequest: 'Заявка-06.08.2026-009',
        tvmtRequestDate: '2026-08-06',
        tvmtConclusion: 'Заключение-ТВМТ-06.08.2026-006',
        tvmtConclusionDate: '2026-08-06',
      },
    ])

    expect(sequences.lnkConclusionVik).toBe(8)
    expect(sequences.lnkConclusionRk).toBe(3)
    expect(sequences.lnkConclusionUzk).toBe(1)
    expect(sequences.lnkConclusionPvk).toBe(1)
    expect(sequences.lnkConclusionOther).toBe(5)
    expect(sequences.tvmtRequest).toBe(10)
    expect(sequences.tvmtConclusion).toBe(7)
  })

  it('continues LNK numbering after documents from the before-heat-treatment stage', () => {
    const sequences = getInitialSystemDocumentSequenceNumbers([
      {
        id: 1,
        vikRequest: 'Заявка-06.08.2026-009',
        vikRequestDate: '2026-08-06',
        vikConclusion: 'ЗНК-ВИК-06.08.2026-008',
        vikConclusionDate: '2026-08-06',
        preHeatTreatmentControls: [
          {
            id: 21,
            weldJointId: 1,
            method: 'ВИК',
            requestName: 'Заявка-07.08.2026-015',
            requestDate: '2026-08-07',
            conclusionName: 'ЗНК-ВИК-07.08.2026-018',
            conclusionDate: '2026-08-07',
          },
        ],
      },
    ])

    expect(sequences.lnkRequest).toBe(16)
    expect(sequences.lnkConclusionVik).toBe(19)
  })

  it('continues PSTO and independent TVMT numbering after documents in repeat cycles', () => {
    const sequences = getInitialSystemDocumentSequenceNumbers([
      {
        id: 1,
        pstoRequest: 'ПСТО-06.08.26-004',
        pstoRequestDate: '2026-08-06',
        heatTreatmentDiagram: 'ПСТО-Д-06.08.26-003',
        pstoDate: '2026-08-06',
        tvmtRequest: 'Заявка-06.08.2026-009',
        tvmtRequestDate: '2026-08-06',
        tvmtConclusion: 'ЗНК-ТВМТ-06.08.2026-006',
        tvmtConclusionDate: '2026-08-06',
        pstoRepeatCycles: [
          {
            id: 11,
            weldJointId: 1,
            sequence: 2,
            pstoRequest: 'ПСТО-07.08.26-014',
            pstoRequestDate: '2026-08-07',
            heatTreatmentDiagram: 'ПСТО-Д-07.08.26-011',
            pstoDate: '2026-08-07',
            tvmtRequest: 'Заявка-07.08.2026-017',
            tvmtRequestDate: '2026-08-07',
            tvmtConclusion: 'ЗНК-ТВМТ-07.08.2026-012',
            tvmtConclusionDate: '2026-08-07',
          },
        ],
      },
    ])

    expect(sequences.pstoRequest).toBe(15)
    expect(sequences.pstoConclusion).toBe(12)
    expect(sequences.tvmtRequest).toBe(18)
    expect(sequences.tvmtConclusion).toBe(13)
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
