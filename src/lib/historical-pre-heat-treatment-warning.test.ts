import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildJointNextActions } from '@/lib/joint-next-actions'
import { getPrimaryLnkStageAccess, getPreHeatTreatmentPendingFinalStatus } from '@/lib/lnk-control-stage'
import { getPreHeatTreatmentRequestBlockReason } from '@/lib/pre-heat-treatment-control-updates'
import { buildPrimaryLnkStageDebtSystemWarnings } from '@/lib/repeated-joint-check-tasks'
import { buildLnkResultRows } from '@/lib/lnk-result-create-updates'
import { getSystemWorkflowStageTransitionReason } from '@/server/weld-save-validation'
import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'
import { getPstoWorkflowResultBlockReason } from '@/lib/psto-status'
import type { WeldJoint } from '@/db/schema'

// Record 626's significant facts, not a database copy: own completed PSTO/TVMT,
// primary results, no pre-TO records and the old exemption flag.
const historical: WeldRow & { preHeatTreatmentLnkExempt: boolean } = {
  id: 626, joint: 'F52', line: 'L-history', weldDate: '2026-07-10',
  pstoRequired: 'да', preHeatTreatmentLnkExempt: true, preHeatTreatmentLnkEnabled: true,
  pstoRequest: 'P-626', pstoRequestDate: '2026-07-10', pstoDate: '2026-07-10',
  pstoResult: 'проведено', heatTreatmentDiagram: 'D-626',
  tvmtRequest: 'T-626', tvmtRequestDate: '2026-07-10', tvmtResult: 'годен',
  tvmtConclusion: 'TC-626', tvmtConclusionDate: '2026-07-10',
  hasVik: 'да', hasRk: 'да', hasPvk: 'да',
  vikRequest: 'V-До ТО', vikRequestDate: '2026-07-11', vikResult: 'годен',
  vikConclusion: 'VC-626', vikConclusionDate: '2026-07-11',
  rkRequest: 'R-До ТО', rkRequestDate: '2026-07-11', rkResult: 'годен',
  rkConclusion: 'RC-626', rkConclusionDate: '2026-07-11',
  pvkRequest: 'PV-До ТО', pvkRequestDate: '2026-07-11', pvkResult: 'годен',
  pvkConclusion: 'PVC-626', pvkConclusionDate: '2026-07-11', finalStatus: 'годен',
}
const settings = { ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: true, allowPrimaryLnkBeforePreviousStagesComplete: false }
const methods = ['ВИК', 'РК', 'ПВК'] as const

describe('all joints follow current pre-TO settings, regardless of the obsolete flag', () => {
  it.each([true, false])('form and server use only current settings for a new primary result (obsolete flag=%s)', (flag) => {
    const before = { ...historical, preHeatTreatmentLnkExempt: flag, vikResult: 'ожидает НК', vikConclusion: null, vikConclusionDate: null }
    const after = { ...before, vikResult: 'годен', vikConclusion: 'NEW', vikConclusionDate: '2026-07-11' }
    const context = { controlProcessSettings: settings,
      pstoLineAssignments: new Map([[getPstoLineIdentityKey(before), { rowCount: 1, assignedCount: 1, cancelledCount: 0 }]]) }
    expect(getSystemWorkflowStageTransitionReason(after, before as unknown as WeldJoint, context)).toContain('НК до ТО')
    const create = (allow: boolean, controlDate = '2026-07-11') => buildLnkResultRows({ records: [before],
      methodKey: 'vikRequest', controlDate, resultById: { 626: 'годен' }, conclusionName: 'NEW',
      controlProcessSettings: { ...settings, allowPrimaryLnkBeforePreviousStagesComplete: allow },
    })
    expect(() => create(false)).toThrow('НК до ТО')
    expect(create(true)[0]).toMatchObject({ vikResult: 'годен', finalStatus: 'ожидает заявку' })
    expect(() => create(true, '2026-07-09')).toThrow()
    expect(getSystemWorkflowStageTransitionReason(after, before as unknown as WeldJoint, {
      ...context, controlProcessSettings: { ...settings, allowPrimaryLnkBeforePreviousStagesComplete: true },
    })).toBe('')
    // An unchanged saved result is not deleted or rejected on an unrelated edit.
    expect(getSystemWorkflowStageTransitionReason({ ...historical, weldingJournalNote: 'уточнение' }, historical as unknown as WeldJoint, context)).toBe('')
  })

  it('the first PSTO result UI and server both require pre-TO after it is re-enabled', () => {
    const before = { ...historical, pstoDate: null, pstoResult: 'ожидает ПСТО', heatTreatmentDiagram: null,
      tvmtRequest: null, tvmtRequestDate: null, tvmtResult: null, tvmtConclusion: null, tvmtConclusionDate: null }
    const context = { controlProcessSettings: settings,
      pstoLineAssignments: new Map([[getPstoLineIdentityKey(before), { rowCount: 1, assignedCount: 1, cancelledCount: 0 }]]) }
    expect(getPstoWorkflowResultBlockReason(before)).toContain('НК до ТО')
    expect(getSystemWorkflowStageTransitionReason({ ...before, pstoResult: 'проведено' }, before as unknown as WeldJoint, context)).toContain('НК до ТО')
    const disabled = { ...before, preHeatTreatmentLnkEnabled: false }
    expect(getPstoWorkflowResultBlockReason(disabled)).toBe('')
  })
  it('warns for case 626, allows factual backfill, but requires pre-TO in strict mode', () => {
    const before = structuredClone(historical)
    const warnings = buildPrimaryLnkStageDebtSystemWarnings([historical], settings)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].systemWarningCode).toBe('СП-01')
    for (const method of methods) {
      expect(warnings[0].details).toContain(`заявка ${method} до ТО`)
      expect(getPrimaryLnkStageAccess(historical, method, settings).status).toBe('blocked')
      expect(getPrimaryLnkStageAccess(historical, method, { ...settings, allowPrimaryLnkBeforePreviousStagesComplete: true }).status).toBe('allowed-with-warning')
      expect(getPreHeatTreatmentRequestBlockReason(historical, method)).toBe('')
    }
    expect(warnings[0].details).not.toMatch(/ожидает (?:ПСТО|ТВМТ)/)
    expect(warnings[0].rootCauseActions?.[0].target).toMatchObject({
      kind: 'lnk-control', stage: 'beforeHeatTreatment', documentPart: 'request', intent: 'complete-stage',
    })
    expect(getPreHeatTreatmentPendingFinalStatus(historical)).toBe('ожидает заявку')
    expect(historical).toEqual(before)
  })

  it('advances from missing requests to results and clears only after all assigned pre-TO controls are good', () => {
    const requested = { ...historical, preHeatTreatmentControls: methods.map((method, i) => ({
      id: i + 1, weldJointId: historical.id, method, requestName: `PRE-${method}`, requestDate: '2026-07-10',
    })) }
    const pending = buildPrimaryLnkStageDebtSystemWarnings([requested], settings)
    expect(pending[0]?.rootCauseActions?.[0].label).toBe('Внести результат НК до ТО')
    const partial = { ...requested, preHeatTreatmentControls: requested.preHeatTreatmentControls.map((c, i) => ({ ...c, result: i < 2 ? 'годен' : null })) }
    expect(buildPrimaryLnkStageDebtSystemWarnings([partial], settings)[0]?.details).toContain('результат ПВК до ТО')
    expect(buildPrimaryLnkStageDebtSystemWarnings([partial], settings)[0]?.details).not.toMatch(/заявка ВИК до ТО|результат РК до ТО/)
    const complete = { ...requested, preHeatTreatmentControls: requested.preHeatTreatmentControls.map((c) => ({ ...c, result: 'годен' })) }
    expect(buildPrimaryLnkStageDebtSystemWarnings([complete], settings)).toEqual([])
    expect(buildJointNextActions(complete, [], settings)[0]?.title).toBe('Работа по стыку завершена')
  })

  it('off/on hides only pre-TO debt and respects fresh settings over stale row metadata', () => {
    const disabled = { ...settings, preHeatTreatmentLnkEnabled: false }
    expect(buildPrimaryLnkStageDebtSystemWarnings([historical], disabled)).toEqual([])
    expect(buildPrimaryLnkStageDebtSystemWarnings([{ ...historical, preHeatTreatmentLnkEnabled: false }], settings)).toHaveLength(1)
    const pendingTvmt = { ...historical, tvmtResult: 'ожидает НК', tvmtConclusion: null, tvmtConclusionDate: null }
    const warning = buildPrimaryLnkStageDebtSystemWarnings([pendingTvmt], disabled)[0]
    expect(warning?.details).toContain('ожидает ТВМТ')
    expect(warning?.details).not.toContain('до ТО')
  })

  it('routes strict mode to missing pre-TO and permissive mode to actual primary work', () => {
    expect(buildJointNextActions(historical, [], settings)[0]?.kind).toBe('preLnkRequest')
    const permissive = { ...settings, allowPrimaryLnkBeforePreviousStagesComplete: true }
    expect(buildJointNextActions(historical, [], permissive)[0]).toMatchObject({
      title: 'Результаты основного НК внесены', tone: 'warning', description: expect.stringContaining('СП-01'),
    })
    const partial = { ...historical, rkResult: 'ожидает НК', rkConclusion: null, rkConclusionDate: null }
    expect(buildJointNextActions(partial, [], settings)[0]?.kind).toBe('preLnkRequest')
    expect(buildJointNextActions(partial, [], permissive)[0]).toMatchObject({ kind: 'primaryLnkResult', methodCode: 'РК' })
  })

  it('does not describe missing required pre-TO as an unnecessary stage', () => {
    const requestOnly = { ...historical, pstoDate: null, pstoResult: null, pstoRequest: null,
      pstoRequestDate: '2026-07-10', tvmtRequest: null, tvmtRequestDate: null, tvmtResult: null,
      tvmtConclusion: null, tvmtConclusionDate: null, heatTreatmentDiagram: null,
      vikResult: null, vikConclusion: null, vikConclusionDate: null,
      rkResult: null, rkConclusion: null, rkConclusionDate: null,
      pvkResult: null, pvkConclusion: null, pvkConclusionDate: null,
    }
    expect(buildJointNextActions(requestOnly, [], settings)[0]?.description).not.toContain('НК до ТО для этого стыка не требуется')
  })

  it('does not warn for early requests alone, unassigned methods or disabled unrelated stages', () => {
    const requestsOnly = { ...historical, vikResult: 'ожидает НК', vikConclusion: null, vikConclusionDate: null,
      rkResult: 'ожидает НК', rkConclusion: null, rkConclusionDate: null,
      pvkResult: 'ожидает НК', pvkConclusion: null, pvkConclusionDate: null }
    expect(buildPrimaryLnkStageDebtSystemWarnings([requestsOnly], settings)).toEqual([])
    expect(buildPrimaryLnkStageDebtSystemWarnings([{ ...historical, hasVik: 'нет', hasRk: 'нет', hasPvk: 'нет' }], settings)).toEqual([])
    expect(buildJointNextActions(historical, [], { ...settings, preHeatTreatmentLnkEnabled: false })[0]?.tone).toBe('success')
  })

  it('still blocks an actual rejected pre-TO result rather than offering to overwrite it', () => {
    const rejected = { ...historical, preHeatTreatmentControls: [{ id: 1, weldJointId: 626, method: 'ВИК', result: 'вырез' }] }
    expect(buildPrimaryLnkStageDebtSystemWarnings([rejected], settings)).toEqual([])
    expect(getPrimaryLnkStageAccess(rejected, 'ВИК', settings).status).toBe('blocked')
  })
})
