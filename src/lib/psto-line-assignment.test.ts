import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  assertPstoCancellationDateAfterHistory,
  blocksPstoLineActivation,
  buildPstoCancelledRow,
  buildPstoRemovedRow,
  getPrimaryStagedMethodCodes,
  getPstoLineActivationBlockReason,
  getPstoLineIdentityKey,
  hasPstoLifecycleData,
  hasPrimaryPstoHistory,
  requiresPrimaryStageResolutionForAssignedPstoLine,
} from '@/lib/psto-line-assignment'

describe('PSTO line assignment', () => {
  it('uses project, subtitle and line as one unambiguous identity', () => {
    expect(getPstoLineIdentityKey({
      projectTitle: ' Проект ',
      subtitleCode: ' 400 ',
      line: ' L-1 ',
    })).toBe(JSON.stringify(['Проект', '400', 'L-1']))
  })

  it('cleanly removes a mistaken assignment only when the line has no lifecycle data', () => {
    const row = makeRequestOnlyRow({ pstoRequest: null, pstoRequestDate: null })
    const next = buildPstoRemovedRow({
      row,
      controls: [],
      disposition: 'keepPrimary',
    })

    expect(next).toMatchObject({
      pstoRequired: null,
      pstoRequest: null,
      pstoResult: null,
      tvmtRequest: null,
      tvmtResult: null,
      vikRequest: 'Заявка после ТО',
      vikResult: 'годен',
    })
  })

  it('does not treat derived waiting labels as persisted PSTO history', () => {
    expect(hasPrimaryPstoHistory(makeRequestOnlyRow({
      pstoRequest: null,
      pstoRequestDate: null,
      pstoResult: 'ожидает заявку',
      tvmtResult: 'ожидает ТВМТ',
    }))).toBe(false)

    expect(hasPrimaryPstoHistory(makeRequestOnlyRow({
      pstoRequest: null,
      pstoRequestDate: null,
      pstoResult: 'ожидает заявку',
      pstoBoq: 'да',
      pstoKs3: 'КС3-ПСТО',
      tvmtBoq: 'BoQ-ТВМТ',
      tvmtKs3: 'КС3-ТВМТ',
    }))).toBe(false)
    expect(hasPstoLifecycleData(makeRequestOnlyRow({
      pstoRequest: null,
      pstoRequestDate: null,
      pstoBoq: 'BoQ-ПСТО',
      pstoKs3: 'КС3-ПСТО',
      tvmtBoq: 'BoQ-ТВМТ',
      tvmtKs3: 'КС3-ТВМТ',
    }))).toBe(false)
  })

  it('preserves performed PSTO and TVMT history during official cancellation', () => {
    const next = buildPstoCancelledRow({
      row: makeRow(),
      controls: [preControl()],
      disposition: 'keepPrimary',
      cancellationDate: '2026-08-09',
      cancellationBasis: 'ТР №7',
    })

    expect(next).toMatchObject({
      pstoRequired: 'отменен',
      pstoCancellationDate: '2026-08-09',
      pstoControlBasis: 'ТР №7',
      pstoRequest: 'Заявка ПСТО',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtResult: 'годен',
    })
  })

  it('drops an unstarted repeat request but preserves a physically started repeat during cancellation', () => {
    const requestOnly = {
      id: 21,
      weldJointId: 1,
      sequence: 2,
      pstoRequest: 'Заявка повторной ПСТО',
      pstoRequestDate: '2026-08-07',
    }
    const started = {
      ...requestOnly,
      pstoDate: '2026-08-08',
      pstoResult: 'проведено',
    }

    const cancelledBeforeRepeat = buildPstoCancelledRow({
      row: makeRow({ tvmtResult: 'не годен', pstoRepeatCycles: [requestOnly] }),
      controls: [preControl()],
      disposition: 'keepPrimary',
      cancellationDate: '2026-08-09',
      cancellationBasis: 'ТР №8',
    })
    expect(cancelledBeforeRepeat.pstoRepeatCycles).toEqual([])

    const cancelledAfterRepeatStarted = buildPstoCancelledRow({
      row: makeRow({ tvmtResult: 'не годен', pstoRepeatCycles: [started] }),
      controls: [preControl()],
      disposition: 'keepPrimary',
      cancellationDate: '2026-08-09',
      cancellationBasis: 'ТР №8',
    })
    expect(cancelledAfterRepeatStarted.pstoRepeatCycles).toEqual([started])
  })

  it('does not allow cancellation or a move into a cancelled line before retained history', () => {
    expect(() => assertPstoCancellationDateAfterHistory([
      makeRow({
        pstoRepeatCycles: [{
          id: 2,
          weldJointId: 1,
          sequence: 2,
          pstoRequestDate: '2026-08-07',
          pstoDate: '2026-08-08',
          tvmtRequestDate: '2026-08-09',
          tvmtConclusionDate: '2026-08-10',
        }],
      }),
    ], '2026-08-09')).toThrow('2026-08-10')

    expect(() => assertPstoCancellationDateAfterHistory([
      makeRow({ tvmtConclusionDate: '2026-08-06' }),
    ], '2026-08-06')).not.toThrow()
  })

  it('includes legacy localized dates in cancellation chronology', () => {
    expect(() => assertPstoCancellationDateAfterHistory([
      makeRow({
        pstoDate: '08.08.2026',
        tvmtConclusionDate: '10.08.2026',
      }),
    ], '09.08.2026')).toThrow('2026-08-10')

    expect(() => assertPstoCancellationDateAfterHistory([
      makeRow({ tvmtConclusionDate: '10.08.2026' }),
    ], '10.08.2026')).not.toThrow()
  })

  it('promotes the selected pre-heat-treatment set for an untreated cancelled joint', () => {
    const next = buildPstoCancelledRow({
      row: makeRequestOnlyRow(),
      controls: [preControl()],
      disposition: 'promoteBeforeHeatTreatment',
      cancellationDate: '2026-08-04',
      cancellationBasis: '',
    })

    expect(next).toMatchObject({
      pstoRequired: 'отменен',
      pstoRequest: null,
      vikRequest: 'Заявка до ТО',
      vikRequestDate: '2026-08-02',
      vikResult: 'ремонт',
      vikConclusionDate: '2026-08-03',
      vikConclusion: 'ЗНК до ТО',
    })
    expect(getPrimaryStagedMethodCodes(next)).toEqual(['ВИК'])
  })

  it('promotes RK exposure data without changing its coordinate format', () => {
    const next = buildPstoCancelledRow({
      row: makeRequestOnlyRow(),
      controls: [{
        id: 3,
        weldJointId: 1,
        method: 'РК',
        requestName: 'Заявка РК до ТО',
        requestDate: '2026-08-02',
        result: 'годен',
        conclusionDate: '2026-08-03',
        conclusionName: 'ЗНК РК до ТО',
        defectDescription: '0-100: ДНО\n100-0: ДНО',
        rkExposureConfirmedDiameter: 57,
      }],
      disposition: 'promoteBeforeHeatTreatment',
      cancellationDate: '2026-08-04',
      cancellationBasis: '',
    })

    expect(next.lnkDefectDescription).toBe('0-100: ДНО\n100-0: ДНО')
    expect(next.rkExposureConfirmedDiameter).toBe(57)
  })

  it('does not mix the promoted completed set with old staged fields or pending pre-TO requests', () => {
    const next = buildPstoCancelledRow({
      row: makeRequestOnlyRow({
        rkRequest: 'Заявка РК после ТО',
        rkResult: 'годен',
        rkConclusion: 'ЗНК РК после ТО',
      }),
      controls: [
        preControl(),
        {
          id: 2,
          weldJointId: 1,
          method: 'РК',
          requestName: 'Заявка РК до ТО',
          requestDate: '2026-08-02',
          result: 'ожидает НК',
        },
      ],
      disposition: 'promoteBeforeHeatTreatment',
      cancellationDate: '2026-08-04',
      cancellationBasis: '',
    })

    expect(next.vikConclusion).toBe('ЗНК до ТО')
    expect(next.rkRequest).toBeNull()
    expect(next.rkResult).toBeNull()
    expect(next.rkConclusion).toBeNull()
    expect(getPrimaryStagedMethodCodes(next)).toEqual(['ВИК'])
  })

  it('does not inspect or alter duplicate controls when removing PSTO', () => {
    const duplicateControls = [{
      id: 7,
      weldJointId: 1,
      method: 'РК' as const,
      result: 'ремонт' as const,
      controlDate: '2026-08-05',
      conclusion: 'Дубль',
      conclusionDate: '2026-08-05',
    }]
    const next = buildPstoRemovedRow({
      row: makeRequestOnlyRow({
        pstoRequest: null,
        pstoRequestDate: null,
        duplicateControls,
      }),
      controls: [],
      disposition: 'keepPrimary',
    })

    expect(next.duplicateControls).toBe(duplicateControls)
  })

  it('requires an explicit stage decision only when a non-PSTO weld with primary LNK enters a PSTO line', () => {
    expect(requiresPrimaryStageResolutionForAssignedPstoLine(makeRow({
      pstoRequired: null,
      pstoRequest: null,
      pstoRequestDate: null,
      pstoDate: null,
      pstoResult: null,
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
    }))).toBe(true)

    expect(requiresPrimaryStageResolutionForAssignedPstoLine(makeRow({
      pstoRequired: 'да',
    }))).toBe(false)

    expect(requiresPrimaryStageResolutionForAssignedPstoLine(makeRow({
      pstoRequired: null,
      pstoRequest: 'История ПСТО',
    }))).toBe(false)
  })

  it('recognizes RK coordinates as primary-stage data even without a document name', () => {
    expect(requiresPrimaryStageResolutionForAssignedPstoLine(makeRow({
      pstoRequired: null,
      pstoRequest: null,
      pstoRequestDate: null,
      pstoDate: null,
      pstoResult: null,
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
      vikRequest: null,
      vikRequestDate: null,
      vikResult: null,
      vikConclusionDate: null,
      vikConclusion: null,
      lnkDefectDescription: '0-100: ДНО',
    }))).toBe(true)
  })

  it('does not let BoQ or KS3 hide the required stage decision', () => {
    expect(requiresPrimaryStageResolutionForAssignedPstoLine(makeRow({
      pstoRequired: null,
      pstoRequest: null,
      pstoRequestDate: null,
      pstoDate: null,
      pstoResult: null,
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
      pstoBoq: 'BoQ-ПСТО',
      pstoKs3: 'КС3-ПСТО',
    }))).toBe(true)
  })

  it('blocks both a late assignment and a failed-cycle reactivation when primary LNK exists', () => {
    const lateAssignment = makeRow({
      pstoRequired: null,
      pstoRequest: null,
      pstoRequestDate: null,
      pstoDate: null,
      pstoResult: null,
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
      vikRequest: 'Заявка ВИК основная',
      vikResult: 'ожидает НК',
    })
    const cancelledFailed = makeRow({
      pstoRequired: 'отменен',
      tvmtResult: 'не годен',
      vikRequest: 'Заявка ВИК основная',
      vikResult: 'годен',
    })

    expect(blocksPstoLineActivation(lateAssignment)).toBe(true)
    expect(blocksPstoLineActivation(cancelledFailed)).toBe(true)
    expect(getPstoLineActivationBlockReason([lateAssignment, cancelledFailed]))
      .toContain('Выберите перенос комплекта в «НК до ТО»')
  })

  it('does not disturb active lines or a cancelled line whose latest TVMT is good', () => {
    expect(blocksPstoLineActivation(makeRow({
      pstoRequired: 'да',
      vikRequest: 'Заявка ВИК основная',
    }))).toBe(false)
    expect(blocksPstoLineActivation(makeRow({
      pstoRequired: 'отменен',
      tvmtResult: 'годен',
      vikRequest: 'Заявка ВИК основная',
      vikResult: 'годен',
    }))).toBe(false)
  })

  it('does not treat derived waiting labels as an existing primary LNK set', () => {
    expect(requiresPrimaryStageResolutionForAssignedPstoLine(makeRow({
      pstoRequired: null,
      pstoRequest: null,
      pstoRequestDate: null,
      pstoDate: null,
      pstoResult: null,
      tvmtRequest: null,
      tvmtRequestDate: null,
      tvmtResult: null,
      tvmtConclusionDate: null,
      tvmtConclusion: null,
      vikRequest: null,
      vikRequestDate: null,
      vikResult: 'ожидает заявку',
      vikConclusionDate: null,
      vikConclusion: null,
    }))).toBe(false)
  })
})

function makeRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    pstoRequired: 'да',
    pstoRequest: 'Заявка ПСТО',
    pstoRequestDate: '2026-08-04',
    pstoDate: '2026-08-05',
    pstoResult: 'проведено',
    tvmtRequest: 'Заявка ТВМТ',
    tvmtRequestDate: '2026-08-05',
    tvmtResult: 'годен',
    tvmtConclusionDate: '2026-08-06',
    tvmtConclusion: 'ТВМТ-1',
    vikRequest: 'Заявка после ТО',
    vikRequestDate: '2026-08-07',
    vikResult: 'годен',
    vikConclusionDate: '2026-08-08',
    vikConclusion: 'ЗНК после ТО',
    ...overrides,
  } as WeldRow
}

function makeRequestOnlyRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return makeRow({
    pstoDate: null,
    pstoResult: null,
    heatTreatmentDiagram: null,
    tvmtRequest: null,
    tvmtRequestDate: null,
    tvmtResult: null,
    tvmtConclusionDate: null,
    tvmtConclusion: null,
    ...overrides,
  })
}

function preControl() {
  return {
    id: 1,
    weldJointId: 1,
    method: 'ВИК',
    requestName: 'Заявка до ТО',
    requestDate: '2026-08-02',
    result: 'ремонт',
    conclusionDate: '2026-08-03',
    conclusionName: 'ЗНК до ТО',
    defectDescription: 'Дефект',
  }
}
