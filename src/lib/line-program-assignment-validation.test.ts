import { describe, expect, it } from 'vitest'
import { getProgramAssignmentError } from './line-program-assignment-validation'
import { applyProgramPatch } from './line-program-workspace'
import { getControlAssignmentRemovalReason } from './control-assignment-history'
import type { WeldRow } from './dispatcher-types'

const base: WeldRow = { id: 1, joint: 'F1', connectionType: 'С17', stamp1K: 'A', weldDate: '2026-09-01', hasRk: 'да', hasPvk: 'да' }
describe('same removal rules as the weld card', () => {
  it.each(['годен', 'ремонт', 'вырез', 'годен (отменен)'])('protects actual %s from clearing and cancellation while permitting untouched legacy facts', result => {
    const row = { ...base, rkResult: result }
    const next = applyProgramPatch(row, { РК: '' })
    expect(next).toMatchObject({ hasRk: null, rkResult: result })
    expect(getProgramAssignmentError(row, { РК: '' })).toBe(getControlAssignmentRemovalReason(next, row))
    expect(getProgramAssignmentError(row, { РК: '' })).toMatch(/нельзя снять/)
    expect(getProgramAssignmentError(row, { РК: 'отменен' })).toMatch(/нельзя отменить/)
    expect(getProgramAssignmentError({ ...row, hasRk: null }, { ПВК: '' })).toBe('')
  })
  it.each(['ожидает заявку', 'ожидает НК', 'ожидает', null])('does not mistake %s for a result', rkResult => {
    expect(getProgramAssignmentError({ ...base, rkResult }, { РК: '' })).toBe('')
  })
  it('protects conclusion history even when optional legacy checks are disabled', () => {
    const row = { ...base, rkConclusion: 'Заключение' }
    expect(getProgramAssignmentError(row, { РК: '' })).toMatch(/нельзя снять/)
    expect(getProgramAssignmentError(row, { РК: '' }, false)).toMatch(/нельзя снять/)
  })
  it('protects performed preheat work even when its stage is disabled', () => {
    const row: WeldRow = { ...base, preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'РК', requestName: 'До ТО', result: 'годен' }] }
    expect(getProgramAssignmentError(row, { РК: '' })).toMatch(/НК до ТО/)
    expect(getProgramAssignmentError(row, { РК: 'отменен' })).toMatch(/нельзя отменить/)
    expect(getProgramAssignmentError(row, { ПВК: '' })).toBe('')
  })
  it('requires the dedicated layered-removal workflow and blocks contradictory batch actions', () => {
    const row = { ...base, connectionType: 'У17', layeredControlAssigned: true }
    expect(getProgramAssignmentError(row, { 'Послойный ПВК': '' })).toMatch(/отдельной/)
    expect(getProgramAssignmentError(row, { ПВК: '' })).toMatch(/ПВК/)
    expect(getProgramAssignmentError({ ...row, layeredControlAssigned: false }, { ПВК: '', 'Послойный ПВК': 'да' })).toMatch(/ПВК/)
  })
})
