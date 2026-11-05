import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { getControlAssignmentHistory, getControlAssignmentPerformedHistory, getControlAssignmentRemovalReason } from './control-assignment-history'
import { clearRequestsForRemovedControlAssignments } from './control-assignment-request-removal'
import { getProgramAssignmentError } from './line-program-assignment-validation'
import { getWeldFormSaveBlockReason } from './weld-form-save-reasons'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { applyPstoChainPolicy } from './psto-chain-policy'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { hasPstoExecutionHistory } from './psto-cycle'

const base: WeldRow = { id: 1, joint: 'F1', connectionType: 'С17', hasRk: 'да', hasUzk: 'да', hasPvk: 'да' }
const pre = { id: 10, weldJointId: 1, method: 'РК' }

describe('T-10/T-22: future decisions and performed facts', () => {
  it.each(['годен', 'ремонт', 'вырез'])('protects own %s against both cancellation and empty with optional checks disabled', result => {
    for (const facts of [
      { rkResult: result },
      { preHeatTreatmentLnkEnabled: false, preHeatTreatmentControls: [{ ...pre, result }] },
      { duplicateControls: [{ ...pre, method: 'РК' as const, result: result as 'годен', conclusion: 'ЗНК', conclusionDate: '2026-11-01', controlDate: '2026-11-01' }] },
    ]) {
      const row: WeldRow = { ...base, ...facts }
      expect(getProgramAssignmentError(row, { РК: 'отменен' }, false)).toContain('нельзя отменить')
      expect(getProgramAssignmentError(row, { РК: '' }, false)).toContain('нельзя снять')
      expect(getWeldFormSaveBlockReason({ ...row, hasRk: 'отменен' }, row, { ...DEFAULT_SAVE_CHECK_SETTINGS, controlHistoryProtection: false })).toContain('нельзя отменить')
      expect(getProgramAssignmentError(row, { УЗК: 'отменен' }, false)).toBe('')
    }
  })
  it('does not permit simultaneous deletion of facts as an assignment-change bypass', () => {
    const row = { ...base, rkResult: 'годен', rkConclusion: 'РК-1' }
    expect(getControlAssignmentRemovalReason({ ...row, hasRk: null, rkResult: null, rkConclusion: null }, row)).toContain('нельзя снять')
    expect(getControlAssignmentRemovalReason({ ...row, hasRk: 'отменен', rkResult: null, rkConclusion: null }, row)).toContain('нельзя отменить')
  })
  it('protects existing LNK result traces even when the result label is missing', () => {
    for (const facts of [
      { lnkDefectDescription: 'Дефект 1' }, { rkExposureConfirmedDiameter: 108 },
      { preHeatTreatmentControls: [{ ...pre, defectDescription: 'Дефект 1' }] },
      { preHeatTreatmentControls: [{ ...pre, rkExposureConfirmedDiameter: 108 }] },
    ]) {
      const row: WeldRow = { ...base, pstoRequired: 'да', ...facts }
      expect(getControlAssignmentRemovalReason({ ...row, hasRk: null }, row)).toContain('нельзя снять')
      expect(getControlAssignmentRemovalReason({ ...row, hasRk: 'отменен' }, row)).toContain('нельзя отменить')
      expect(getControlAssignmentRemovalReason({ ...row, hasUzk: null }, row)).toBe('')
      // Preliminary NK traces protect their stage, but do not fabricate performed PSTO.
      expect(getControlAssignmentPerformedHistory(row, 'pstoRequired')).toBeNull()
      if (row.preHeatTreatmentControls) expect(getControlAssignmentRemovalReason({ ...row, pstoRequired: null }, row)).toContain('нельзя снять')
    }
  })
  it('keeps old contradictory facts intact on unrelated correction and rejects a new combination', () => {
    const old = { ...base, hasRk: 'отменен', rkResult: 'годен' }
    expect(getControlAssignmentRemovalReason({ ...old, responsible: 'исправлено' }, old)).toBe('')
    expect(getControlAssignmentRemovalReason({ ...old, hasRk: null }, old)).toContain('нельзя снять')
    expect(getControlAssignmentRemovalReason(old, { ...old, rkResult: null })).toContain('нельзя отменить')
  })
  it('request-only removal clears exactly the selected method at both stages', () => {
    const row: WeldRow = { ...base, rkRequest: 'А1', rkRequestDate: '2026-11-01', rkResult: 'ожидает НК',
      uzkRequest: 'А1', uzkRequestDate: '2026-11-01', uzkResult: 'годен',
      preHeatTreatmentControls: [{ ...pre, requestName: 'ДО1', requestDate: '2026-11-01' }, { ...pre, id: 11, method: 'УЗК', result: 'годен', conclusionName: 'УЗК' }] }
    const next = { ...row, hasRk: null }
    expect(getControlAssignmentHistory(row, 'hasRk')).toBeTruthy()
    expect(getControlAssignmentPerformedHistory(row, 'hasRk')).toBeNull()
    expect(getProgramAssignmentError(row, { РК: '' })).toBe('')
    clearRequestsForRemovedControlAssignments(next, row)
    expect(next).toMatchObject({ hasRk: null, rkRequest: null, rkRequestDate: null, rkResult: null, uzkRequest: 'А1', uzkResult: 'годен' })
    expect(next.preHeatTreatmentControls?.[0]).toMatchObject({ requestName: null, requestDate: null })
    expect(next.preHeatTreatmentControls?.[1]).toEqual(row.preHeatTreatmentControls?.[1])
    expect(row.rkRequest).toBe('А1')
  })
  it('request-only PSTO/TVMT does not constitute execution and is cleared in primary/repeat sources', () => {
    const row: WeldRow = { ...base, pstoRequired: 'да', pstoRequest: 'П1', tvmtRequest: 'Т1',
      preHeatTreatmentControls: [{ ...pre, requestName: 'ДО1' }],
      pstoRepeatCycles: [{ id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'П2', tvmtRequest: 'Т2' }] }
    expect(hasPstoExecutionHistory(row)).toBe(false)
    const next = { ...row, pstoRequired: null }
    expect(getControlAssignmentRemovalReason(next, row)).toBe('')
    clearRequestsForRemovedControlAssignments(next, row)
    expect(next).toMatchObject({ pstoRequest: null, tvmtRequest: null, preHeatTreatmentControls: [{ requestName: null }],
      pstoRepeatCycles: [{ id: 12, pstoRequest: null, tvmtRequest: null }] })
  })
  it('protects contradictory actual PSTO requisites even without the result label', () => {
    for (const facts of [{ pstoDate: '2026-11-01' }, { heatTreatmentDiagram: 'Д1' }]) {
      const row = { ...base, pstoRequired: 'да', ...facts }
      expect(getControlAssignmentRemovalReason({ ...row, pstoRequired: null }, row)).toContain('нельзя снять')
      expect(getControlAssignmentRemovalReason({ ...row, pstoRequired: 'отменен' }, row)).toContain('нельзя отменить')
    }
  })
  it('retains three performed assignments while cancelling seven future ones and new records', () => {
    const rows = Array.from({ length: 10 }, (_, i): WeldRow => ({ ...base, id: i + 1, joint: `F${i + 1}`, pstoRequired: 'да',
      ...(i < 3 ? { pstoResult: 'проведено', pstoDate: '2026-11-01', heatTreatmentDiagram: 'Д1', tvmtResult: i === 0 ? 'не годен' : null } : { pstoRequest: 'П1' }) }))
    const policy = { programState: 'cancelled' as const, rowCount: 10, assignedCount: 10, cancellationDate: '2026-11-04', cancellationBasis: 'Решение' }
    const next = rows.map(row => applyPstoChainPolicy(row, policy, DEFAULT_SYSTEM_INDEX_SETTINGS))
    expect(next.filter(row => row.pstoRequired === 'да')).toHaveLength(3)
    expect(next.filter(row => row.pstoRequired === 'отменен')).toHaveLength(7)
    expect(next[0]).toMatchObject({ pstoResult: 'проведено', heatTreatmentDiagram: 'Д1', tvmtResult: 'не годен' })
    expect(next.every((row, i) => !getControlAssignmentRemovalReason(row, rows[i]))).toBe(true)
    expect(applyPstoChainPolicy({ ...base, id: 11 }, policy, DEFAULT_SYSTEM_INDEX_SETTINGS).pstoRequired).toBe('отменен')
  })
})
