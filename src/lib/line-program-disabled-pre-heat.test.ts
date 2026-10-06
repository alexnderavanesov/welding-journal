import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { buildPercentageLineSummaries } from './percentage-line-summary'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'
import { applyProgramPatch } from './line-program-workspace'
import { buildLayeredControlAssignment } from './layered-control-rules'

const rows = (): WeldRow[] => Array.from({ length: 20 }, (_, i) => ({
  id: i + 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `F${i + 1}`,
  weldDate: '2026-09-01', connectionType: 'СШ', stamp1K: 'A', hasVik: 'да',
  category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10,
}))
const policy = (input: WeldRow[], enabled: boolean) => input.map((row) => ({ ...row, preHeatTreatmentLnkEnabled: enabled }))

describe('disabled pre-TO history stays stored but does not participate in the line program', () => {
  it.each(['ВИК', 'РК', 'УЗК', 'ПВК'])('excludes rejected %s from surcharge, candidates and the fourth-rejection threshold, then restores it on enable', (method) => {
    const input = rows()
    for (let i = 0; i < 4; i++) input[i].preHeatTreatmentControls = [{ id: i + 1, weldJointId: i + 1, method, result: 'ремонт' }]
    const original = structuredClone(input)
    const enabled = calculateLineProgram(policy(input, true), 30, 10)[0]
    const surchargeMethod = method === 'РК' || method === 'УЗК'
    expect(enabled.rejectedRowIds).toEqual(surchargeMethod ? [1, 2, 3, 4] : [])
    expect(enabled.fullControlRequired).toBe(surchargeMethod)
    expect(enabled.common.required).toBe(surchargeMethod ? 20 : 6)
    const disabledRows = policy(input, false)
    const disabled = calculateLineProgram(disabledRows, 30, 10)[0]
    expect(disabled.rejectedRowIds).toEqual([])
    expect(disabled.fullControlRequired).toBe(false)
    expect(disabled.common.required).toBe(6)
    expect(disabled.common.candidateRowIds).toHaveLength(20)
    expect(() => applyProgramPatch(disabledRows[0], { РК: 'да' })).not.toThrow()
    expect(buildPercentageLineSummaries(disabledRows)[0].stamps[0].rejectedControlRows).toBe(0)
    expect(buildPercentageLineControlTasks(disabledRows).some((task) => ['suspend-welder', 'rejected-rows'].includes(task.issue))).toBe(false)
    expect(calculateLineProgram(policy(disabledRows, true), 30, 10)[0]).toEqual(enabled)
    expect(input).toEqual(original)
  })

  it.each([['ПВК', 'pvk', 'hasPvk'], ['РК', 'common', 'hasRk'], ['УЗК', 'common', 'hasUzk']] as const)(
    'does not credit performed %s before TO while off; main facts and assignments retain their own meaning', (method, kind, assignment) => {
      const input = rows()
      input[0] = { ...input[0], [assignment]: 'отменен', preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method, result: 'годен' }] }
      input[1] = { ...input[1], [assignment]: 'да', preHeatTreatmentControls: [{ id: 2, weldJointId: 2, method: 'ВИК', result: 'вырез' }] }
      input[2] = { ...input[2], [assignment]: 'да', [method === 'ПВК' ? 'pvkResult' : method === 'РК' ? 'rkResult' : 'uzkResult']: 'годен',
        preHeatTreatmentControls: [{ id: 3, weldJointId: 3, method, result: 'годен' }] }
      const on = calculateLineProgram(policy(input, true), 30, 10)[0][kind]
      expect(on.completedRowIds).toEqual([1, 3])
      expect(on.coveredRowIds).toEqual([1, 3])
      const off = calculateLineProgram(policy(input, false), 30, 10)[0][kind]
      expect(off.completedRowIds).toEqual([3])
      expect(off.coveredRowIds).toEqual([2, 3])
    },
  )

  it('keeps main and duplicate rejections, and never uses an ignored pre-TO date for suspension', () => {
    const input = rows()
    for (let i = 0; i < 4; i++) input[i] = { ...input[i], rkResult: 'ремонт', rkConclusionDate: `2026-09-${11 + i}`,
      preHeatTreatmentControls: [{ id: i + 1, weldJointId: i + 1, method: 'ВИК', result: 'ремонт', conclusionDate: `2026-09-0${i + 2}` }] }
    input[4].duplicateControls = [{ id: 1, weldJointId: 5, method: 'ПВК', result: 'вырез', controlDate: '2026-09-15', conclusionDate: '2026-09-15', conclusion: 'D' }]
    const disabled = policy(input, false)
    expect(calculateLineProgram(disabled, 30, 10)[0].rejectedRowIds).toEqual([1, 2, 3, 4])
    expect(buildPercentageLineControlTasks(disabled).find((task) => task.issue === 'suspend-welder')?.suspensionFrom).toBe('2026-09-14')
  })

  it('requires a PVK replacement while off when only pre-TO was performed and main VIK is rejected', () => {
    const input = rows()
    input[0] = { ...input[0], hasPvk: 'да', vikResult: 'ремонт', pvkResult: 'нет потребности',
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ПВК', result: 'годен' }] }
    for (const enabled of [true, false, true]) {
      const calculation = calculateLineProgram(policy(input, enabled), 30, 10)[0]
      expect(calculation.common.required).toBe(6) // VIK never creates RK/UZK surcharge.
      expect(calculation.pvk.completedRowIds).toEqual(enabled ? [1] : [])
      expect(calculation.pvk.coveredRowIds).toEqual([])
      expect(calculation.pvk.missing).toBe(2)
    }
  })

  it('does not reinterpret ignoring history in the program as permission for a layered assignment over existing rejection', () => {
    const row: WeldRow = { ...rows()[0], connectionType: 'У17', preHeatTreatmentLnkEnabled: false,
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'ремонт' }] }
    expect(() => buildLayeredControlAssignment(row, true)).toThrow('нельзя сохранить')
    expect(() => applyProgramPatch(row, { 'Послойный ПВК': 'да' })).toThrow('нельзя сохранить')
  })
})
