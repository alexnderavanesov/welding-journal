import { describe, expect, it } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getSystemWorkflowStageTransitionReason, mergeWeldRecordsWithPrevious } from './weld-save-validation'
import { prepareServerWeldInput } from './weld-persistence'

const context = { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, pstoLineAssignments: new Map() }
describe('authoritative assignment history boundary', () => {
  it.each(['годен', 'ремонт', 'вырез', 'ожидает НК'])('persistence never erases cancelled %s documents', rkResult => {
    const row = { hasRk: 'отменен', rkRequest: 'РК-1', rkRequestDate: '2026-09-01', rkResult, rkConclusion: rkResult === 'ожидает НК' ? null : 'ЗНК-1', rkConclusionDate: rkResult === 'ожидает НК' ? null : '2026-09-02', lnkDefectDescription: 'Описание' }
    expect(prepareServerWeldInput(row)).toMatchObject(row)
  })
  it.each([
    { rkRequest: 'РК-1' },
    { preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'РК', requestName: 'ДО-1' }] },
    { duplicateControls: [{ id: 1, weldJointId: 1, method: 'РК' as const, result: 'вырез' as const, conclusion: 'ДУБЛЬ', conclusionDate: '2026-09-01', controlDate: '2026-09-01' }] },
  ])('checks merged partial edits against stored stage history: %o', history => {
    const previous = { id: 1, hasRk: 'да', ...history } as unknown as WeldJoint
    const [record] = mergeWeldRecordsWithPrevious([{ id: 1, hasRk: null }], new Map([[1, previous]]))
    expect(getSystemWorkflowStageTransitionReason(record, previous, context)).toContain('нельзя снять')
  })
  it('preserves cancelled request-only PSTO history during normalization', () => {
    const row: WeldRow = { id: 1, pstoRequired: 'отменен', pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-09-01', pstoResult: 'ожидает' }
    expect(prepareServerWeldInput(row)).toMatchObject(row)
  })
})
