import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPrimaryLnkStageDebtSystemWarnings } from '@/lib/repeated-joint-check-tasks'
import { getPstoStageCompletionNextAction } from '@/lib/workflow-root-cause-navigation'

const disabled = { ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: false }
const primaryResult = {
  id: 701, joint: 'F701', pstoRequired: 'да', hasVik: 'да',
  vikRequest: '1503-2', vikRequestDate: '2026-03-15',
  vikResult: 'годен', vikConclusion: 'V-701', vikConclusionDate: '2026-03-25',
} as WeldRow
const pstoDone = { pstoRequest: 'P-701', pstoResult: 'проведено', pstoDate: '2026-03-17' }
const cycleDone = { ...pstoDone, tvmtRequest: 'T-701', tvmtResult: 'годен' }

describe('SP-01 with the pre-TO stage disabled', () => {
  it.each([
    { name: 'missing PSTO request', fields: {}, text: 'ожидает заявку ПСТО', stage: 'pstoRequest', sequence: 1 },
    { name: 'pending PSTO', fields: { pstoRequest: 'P-701' }, text: 'ожидает ПСТО', stage: 'pstoResult', sequence: 1 },
    { name: 'missing TVMT request', fields: pstoDone, text: 'ожидает заявку ТВМТ', stage: 'tvmtRequest', sequence: 1 },
    { name: 'pending TVMT', fields: { ...pstoDone, tvmtRequest: 'T-701' }, text: 'ожидает ТВМТ', stage: 'tvmtResult', sequence: 1 },
    { name: 'failed TVMT', fields: { ...cycleDone, tvmtResult: 'не годен' }, text: 'требуется повторная ПСТО', stage: 'pstoRequest', sequence: 2 },
    { name: 'pending repeat TVMT', fields: { ...cycleDone, tvmtResult: 'не годен', pstoRepeatCycles: [{ id: 90, weldJointId: 701, sequence: 2, ...pstoDone, tvmtRequest: 'T-2' }] }, text: 'ожидает ТВМТ', stage: 'tvmtResult', sequence: 2, cycleId: 90 },
  ])('$name points only to the missing required cycle stage', ({ fields, text, stage, sequence, ...scenario }) => {
    const row = { ...primaryResult, ...fields } as WeldRow
    const original = structuredClone(row)
    const tasks = buildPrimaryLnkStageDebtSystemWarnings([row], disabled)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].systemWarningCode).toBe('СП-01')
    expect(tasks[0].details).toContain(text)
    expect(tasks[0].details).not.toContain('до ТО')
    expect(tasks[0].rootCauseActions).toHaveLength(1)
    expect(tasks[0].rootCauseActions?.[0].target).toMatchObject({
      kind: 'psto-cycle', rowId: 701, stage, sequence, intent: 'complete-stage',
      ...('cycleId' in scenario ? { cycleId: scenario.cycleId } : {}),
    })
    const target = tasks[0].rootCauseActions![0].target
    if (target.kind !== 'psto-cycle') throw new Error('Expected a cycle completion target')
    expect(getPstoStageCompletionNextAction(target, row)?.kind).toBe(stage)
    expect(getPstoStageCompletionNextAction({ ...target, rowId: row.id + 1 }, row)).toBeNull()
    expect(getPstoStageCompletionNextAction({ ...target, cycleId: 999 }, row)).toBeNull()
    expect(getPstoStageCompletionNextAction({ ...target, sequence: sequence + 1 }, row)).toBeNull()
    expect(getPstoStageCompletionNextAction(target, { ...row, ...cycleDone, pstoRepeatCycles: [] })).toBeNull()
    expect(getPstoStageCompletionNextAction({ ...target, intent: undefined }, row)).toBeNull()
    expect(row).toEqual(original)
  })

  it.each([false, true])('a request or waiting status alone is not a skipped stage (pre-TO=%s)', (enabled) => {
    for (const result of [null, 'ожидает НК', 'ожидает заявку']) {
      const row = { ...primaryResult, vikResult: result, vikConclusion: null, vikConclusionDate: null }
      expect(buildPrimaryLnkStageDebtSystemWarnings([row], { ...disabled, preHeatTreatmentLnkEnabled: enabled })).toEqual([])
    }
  })

  it.each(['нет', 'отменено'])('does not require a cycle without execution history when PSTO is %s', (pstoRequired) => {
    expect(buildPrimaryLnkStageDebtSystemWarnings([{ ...primaryResult, pstoRequired }], disabled)).toEqual([])
  })

  it('still requires TVMT for a performed cycle after cancellation, but not a new cycle after failed TVMT', () => {
    const historical = { ...primaryResult, ...pstoDone, pstoRequired: 'отменено' }
    expect(buildPrimaryLnkStageDebtSystemWarnings([historical], disabled)[0]?.details).toContain('ожидает заявку ТВМТ')
    expect(buildPrimaryLnkStageDebtSystemWarnings([{ ...historical, tvmtRequest: 'T-701', tvmtResult: 'не годен' }], disabled)).toEqual([])
  })

  it('ignores stale enabled metadata and rejected pre-TO history without changing stored data', () => {
    const row = { ...primaryResult, preHeatTreatmentLnkEnabled: true, preHeatTreatmentControls: [
      { id: 1, weldJointId: 701, method: 'ВИК', result: 'вырез' },
    ] }
    expect(buildPrimaryLnkStageDebtSystemWarnings([row], disabled)[0]?.details).toContain('ожидает заявку ПСТО')
    expect(buildPrimaryLnkStageDebtSystemWarnings([{ ...row, ...cycleDone }], disabled)).toEqual([])
    expect(row.preHeatTreatmentLnkEnabled).toBe(true)
    expect(row.preHeatTreatmentControls[0].result).toBe('вырез')
  })

  it('clears after the current cycle completes, but enabling pre-TO restores its own requirements', () => {
    const row = { ...primaryResult, ...cycleDone, preHeatTreatmentLnkEnabled: false }
    expect(buildPrimaryLnkStageDebtSystemWarnings([row])).toEqual([])
    expect(buildPrimaryLnkStageDebtSystemWarnings([row], disabled)).toEqual([])
    expect(buildPrimaryLnkStageDebtSystemWarnings([row], DEFAULT_CONTROL_PROCESS_SETTINGS)[0]?.details).toContain('заявка ВИК до ТО')
    expect(buildPrimaryLnkStageDebtSystemWarnings([{ ...row, tvmtResult: 'не годен', pstoRepeatCycles: [
      { id: 90, weldJointId: 701, sequence: 2, ...cycleDone },
    ] }], disabled)).toEqual([])
  })

  it('aggregates only assigned methods with actual results into one warning', () => {
    const row = { ...primaryResult, hasRk: 'да', rkResult: 'годен', hasUzk: 'да', uzkRequest: 'U-701', hasPvk: 'нет', pvkResult: 'годен' }
    const tasks = buildPrimaryLnkStageDebtSystemWarnings([row], disabled)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].details).toContain('ВИК, РК')
    expect(tasks[0].details).not.toMatch(/УЗК|ПВК|до ТО/)
  })
})
