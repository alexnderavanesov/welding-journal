import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildPstoAssignedKeepPrimaryValidationRow,
  assertPstoCancellationDateAfterHistory,
  assertPstoLineAssignmentActionAllowed,
  buildPstoCancelledRow,
  buildPstoMovedToCancelledLineRow,
  buildPstoMovedToUnassignedLineRow,
  buildPstoRemovedRow,
  getPrimaryStagedMethodCodes,
  getPstoLineAssignmentState,
  getPstoLineIdentityKey,
  hasPstoLifecycleData,
  hasPrimaryPstoHistory,
  hasPrimaryLnkHistoryBeforePstoAssignment,
  normalizePstoLineMoveTargetIdentity,
  normalizeSubmittedWeldLineIdentity,
} from '@/lib/psto-line-assignment'

describe('PSTO line assignment', () => {
  it('normalizes submitted line identity before locking without changing control facts or adding omitted fields', () => {
    expect(normalizePstoLineMoveTargetIdentity({ projectTitle: ' P\n one ', subtitleCode: ' S  1 ', line: ' L  1 ' }))
      .toEqual({ projectTitle: 'P one', subtitleCode: 'S 1', line: 'L 1' })
    expect(normalizeSubmittedWeldLineIdentity({ id: 1, line: ' L  1 ', vikConclusion: '  Историческое имя  ' }))
      .toEqual({ id: 1, line: 'L 1', vikConclusion: '  Историческое имя  ' })
    expect(normalizePstoLineMoveTargetIdentity({ line: ' - ' }).line).toBe('')
  })
  it('rejects an impossible official cancellation date before persistence', () => {
    expect(() => assertPstoCancellationDateAfterHistory([], '2026-02-31')).toThrow(
      'Укажите корректную дату решения об отмене ПСТО.',
    )
    expect(() => assertPstoCancellationDateAfterHistory([], '2023-12-31')).toThrow(
      'Дата решения об отмене ПСТО не может быть раньше 01.01.2024.',
    )
  })

  it('uses project, subtitle and line as one unambiguous identity', () => {
    const key = getPstoLineIdentityKey({
      projectTitle: ' Проект ',
      subtitleCode: ' 400 ',
      line: ' Lin123 ',
    })

    expect(key).toBe(JSON.stringify(['проект', '400', 'lin123']))
    expect(getPstoLineIdentityKey({
      projectTitle: 'проект',
      subtitleCode: '400',
      line: 'LIN123',
    })).toBe(key)
  })

  it('classifies the current line state using canonical and legacy assignment values', () => {
    expect(getPstoLineAssignmentState([
      { pstoRequired: 'да' },
      { pstoRequired: 'замена РК/УЗК' },
    ])).toBe('assigned')
    expect(getPstoLineAssignmentState([
      { pstoRequired: 'отменен' },
      { pstoRequired: 'отменен' },
    ])).toBe('cancelled')
    expect(getPstoLineAssignmentState([{ pstoRequired: null }])).toBe('unassigned')
    expect(getPstoLineAssignmentState([
      { pstoRequired: 'да' },
      { pstoRequired: null },
    ])).toBe('mixed')
  })

  it('rejects stale PSTO line actions that no longer match the stored state', () => {
    expect(() => assertPstoLineAssignmentActionAllowed('assign', 'assigned')).toThrow('уже назначено')
    expect(() => assertPstoLineAssignmentActionAllowed('assign', 'cancelled')).toThrow('Возобновить')
    expect(() => assertPstoLineAssignmentActionAllowed('reactivate', 'unassigned')).toThrow('полностью отмененной')
    expect(() => assertPstoLineAssignmentActionAllowed('remove', 'mixed')).toThrow('полностью назначенной')
    expect(() => assertPstoLineAssignmentActionAllowed('cancel', 'unassigned')).toThrow('полностью назначенной')
    expect(() => assertPstoLineAssignmentActionAllowed('assign', 'mixed')).not.toThrow()
    expect(() => assertPstoLineAssignmentActionAllowed('cancel', 'assigned')).not.toThrow()
  })

  it('builds a validation baseline that preserves the main control while accepting assigned PSTO', () => {
    const previous = makeRequestOnlyRow({
      pstoRequired: null,
      pstoControlBasis: 'старое основание',
      pstoCancellationDate: '2026-08-01',
    })

    expect(buildPstoAssignedKeepPrimaryValidationRow(previous)).toMatchObject({
      pstoRequired: 'да',
      pstoControlBasis: null,
      pstoCancellationDate: null,
      vikRequest: 'Заявка после ТО',
      vikResult: 'годен',
    })
  })

  it('cleanly removes a mistaken assignment only when the line has no lifecycle data', () => {
    const row = makeRequestOnlyRow({ pstoRequest: null, pstoRequestDate: null })
    const next = buildPstoRemovedRow(row)

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

  it('cancels an untreated line without inventing result history', () => {
    const next = buildPstoCancelledRow({
      row: makeRequestOnlyRow({
        pstoRequest: null,
        pstoRequestDate: null,
        pstoResult: 'ожидает заявку',
        tvmtResult: 'ожидает ТВМТ',
      }),
      cancellationDate: '2026-08-09',
      cancellationBasis: '',
    })

    expect(next).toMatchObject({
      pstoRequired: 'отменен',
      pstoRequest: null,
      pstoResult: 'ожидает заявку',
      tvmtResult: 'ожидает ТВМТ',
    })
  })

  it('preserves both request-only and physically started repeats during cancellation', () => {
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
      cancellationDate: '2026-08-09',
      cancellationBasis: 'ТР №8',
    })
    expect(cancelledBeforeRepeat.pstoRepeatCycles).toEqual([requestOnly])

    const cancelledAfterRepeatStarted = buildPstoCancelledRow({
      row: makeRow({ tvmtResult: 'не годен', pstoRepeatCycles: [started] }),
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
    ], '2026-08-09')).toThrow('последнего сохраненного события (10.08.2026)')

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
    ], '09.08.2026')).toThrow('последнего сохраненного события (10.08.2026)')

    expect(() => assertPstoCancellationDateAfterHistory([
      makeRow({ tvmtConclusionDate: '10.08.2026' }),
    ], '10.08.2026')).not.toThrow()
  })

  it.each(['unassigned', 'cancelled'] as const)('a line move to %s preserves both stages including RK details and unofficial results', target => {
    const controls = [{ id: 12, weldJointId: 1, method: 'РК', requestName: 'PRE-RK', result: 'годен', conclusionName: 'PRE-C', defectDescription: '0-100', rkExposureConfirmedDiameter: 159 }]
    const row = makeRow({ officiality: 'неофициальный', preHeatTreatmentControls: controls, rkRequest: 'MAIN-RK', rkResult: 'ремонт', lnkDefectDescription: '100-200', rkExposureConfirmedDiameter: 219 })
    const input = { row, controls, cancellationDate: '2026-08-09', cancellationBasis: 'Решение' }
    const next = target === 'cancelled' ? buildPstoMovedToCancelledLineRow(input) : buildPstoMovedToUnassignedLineRow(input)
    const { pstoRequired, pstoControlBasis, pstoCancellationDate, ...facts } = row
    expect(next).toEqual({ ...facts, pstoRequired: target === 'cancelled' ? 'отменен' : null, pstoControlBasis: target === 'cancelled' ? 'Решение' : null, pstoCancellationDate: target === 'cancelled' ? '2026-08-09' : null })
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
    const next = buildPstoRemovedRow(makeRequestOnlyRow({
        pstoRequest: null,
        pstoRequestDate: null,
        duplicateControls,
    }))

    expect(next.duplicateControls).toBe(duplicateControls)
  })

  it('recognizes historical main control when a non-PSTO weld with primary LNK enters a PSTO line', () => {
    expect(hasPrimaryLnkHistoryBeforePstoAssignment(makeRow({
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

    expect(hasPrimaryLnkHistoryBeforePstoAssignment(makeRow({
      pstoRequired: 'да',
    }))).toBe(false)

    expect(hasPrimaryLnkHistoryBeforePstoAssignment(makeRow({
      pstoRequired: null,
      pstoRequest: 'История ПСТО',
    }))).toBe(false)
  })

  it('does not let an obsolete exemption bypass line assignment safeguards', () => {
    const row = makeRow({
      pstoRequired: null,
      ...{ preHeatTreatmentLnkExempt: true },
      vikRequest: 'Заявка ВИК основная',
      vikResult: 'годен',
    })

    expect(hasPrimaryLnkHistoryBeforePstoAssignment(row)).toBe(false)
  })

  it('recognizes RK coordinates as primary-stage data even without a document name', () => {
    expect(hasPrimaryLnkHistoryBeforePstoAssignment(makeRow({
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

  it('recognizes a simple defect description as primary-stage data', () => {
    expect(hasPrimaryLnkHistoryBeforePstoAssignment(makeRow({
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
      vikDefectDescription: 'Исторический дефект',
    }))).toBe(true)
  })

  it('does not let BoQ or KS3 hide the existing main control', () => {
    expect(hasPrimaryLnkHistoryBeforePstoAssignment(makeRow({
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

  it('does not treat derived waiting labels as an existing primary LNK set', () => {
    expect(hasPrimaryLnkHistoryBeforePstoAssignment(makeRow({
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
