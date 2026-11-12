import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { assertLnkResultAllowed, getLnkResultRestrictionReasons, getLnkResultRuleIssues } from './lnk-result-policy'
import { getPrimaryLnkRequestAccess, getPrimaryLnkStageAccess } from './lnk-control-stage'
import { buildPreHeatTreatmentRequestWrites, getPreHeatTreatmentRequestBlockReason, getPreHeatTreatmentResultBlockReason } from './pre-heat-treatment-control-updates'
import { buildLnkRequestDraftRows, buildLnkRequestCorrectionRow } from './lnk-request-mutation-updates'
import { evaluateEarlyCoilCandidate } from './early-coil-candidate'
import { getCoilTransitionModeForSource } from './joint-chain-transitions'
import { buildRepeatedJointTasks } from './repeated-joint-tasks'
import { buildRepeatedJointDraft } from './repeated-joint-draft'
import { buildLayeredControlAssignment, getLayeredControlContextActionBlockReason } from './layered-control-rules'
import { getSupportJointRuleIssues } from './support-joint-rules'
import { parseDispatcherTaskIndexPayload, serializeDispatcherTaskIndexPayload } from './dispatcher-task-index-payload'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'

const support = (values: Partial<WeldRow> = {}): WeldRow => ({ id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L',
  joint: 'ОП-1', connectionType: 'Т1', d1: 57, t1: 3, weldDate: '2026-11-01', hasVik: 'да', hasUzk: 'да', hasPvk: 'да', ...values })
const quiet = { includeControlHistoryChecks: false, includeIncompleteStampChecks: false, includeJointCoreDataChecks: false,
  includeLineConsistencyTasks: false, includePercentageLineControlTasks: false, includeWelderStampCompatibilityChecks: false }

describe('Т-06/07 support control and continuation workflows', () => {
  it.each(['Т', 'Т1', 'Т4Д'])('allows only good/repair on %s at any diameter and repair count', connectionType => {
    for (const d1 of [20, 57, 88.9, 89, 219]) for (const joint of ['ОП-1', 'ОП-1R2', 'ОП-1R10', 'ОП-1R99']) {
      const row = support({ connectionType, d1, joint })
      for (const method of ['ВИК', 'УЗК', 'ПВК']) for (const scope of ['own', 'duplicate'] as const) {
        expect(['годен', 'ремонт', 'вырез'].filter(result => !getLnkResultRestrictionReasons(row, method, result, { scope }).length)).toEqual(['годен', 'ремонт'])
      }
      for (const result of ['', 'ожидает НК', 'годен', 'ремонт', 'вырез']) {
        expect(() => assertLnkResultAllowed(row, 'РК', result)).toThrow('Для Т РК запрещён')
      }
    }
  })

  it('keeps own-PVK good-only on both stages without applying it to customer duplicates', () => {
    const row = support({ joint: 'ОП-1R10' })
    for (const method of ['ПВК', 'ПВК до ТО']) {
      expect(getLnkResultRestrictionReasons(row, method, 'ремонт', { pvkGoodOnly: true })).toEqual(['Включена настройка «ПВК — только годен».'])
      expect(getLnkResultRestrictionReasons(row, method, 'ремонт', { pvkGoodOnly: true, scope: 'duplicate' })).toEqual([])
    }
    expect(getLnkResultRuleIssues(row)).toEqual([])
  })

  it('blocks RK requests and results at both stages even with stale assignment, settings override or empty result', () => {
    const row = support({ hasRk: 'да', pstoRequired: 'да', preHeatTreatmentRequired: true })
    expect(getPrimaryLnkRequestAccess(row, 'РК', { preHeatTreatmentMode: 'selected' as const,  }).reason).toContain('Для Т РК запрещён')
    expect(getPrimaryLnkStageAccess(row, 'РК').reason).toContain('Для Т РК запрещён')
    expect(getPreHeatTreatmentRequestBlockReason(row, 'РК')).toContain('Для Т РК запрещён')
    expect(getPreHeatTreatmentResultBlockReason(row, 'РК')).toContain('Для Т РК запрещён')
    expect(() => buildPreHeatTreatmentRequestWrites({ row, methodCodes: ['ВИК', 'РК'], requestName: 'НК', requestDate: '2026-11-02' })).toThrow('Для Т РК запрещён')
    expect(() => buildLnkRequestCorrectionRow({ record: row, methodKey: 'rkRequest', requestName: 'РК', requestDate: '2026-11-02' })).toThrow('Для Т РК запрещён')
    const drafts = buildLnkRequestDraftRows({ records: [row, { ...row, id: 2, joint: 'S1', connectionType: 'С17' }],
      methodKeys: ['vikRequest', 'rkRequest', 'uzkRequest'], requestName: 'НК', requestDate: '2026-11-02' })
    expect(drafts[0]).toMatchObject({ vikRequest: 'НК', uzkRequest: 'НК' })
    expect(drafts[0].rkRequest).toBeUndefined()
    expect(drafts[1].rkRequest).toBe('НК')
    expect(row.rkRequest).toBeUndefined()
  })

  it('retains stage order for supports instead of treating their permitted methods as exempt', () => {
    const row = support({ pstoRequired: 'да', preHeatTreatmentRequired: true })
    expect(getPrimaryLnkRequestAccess(row, 'УЗК').status).toBe('ready')
    expect(getPrimaryLnkStageAccess(row, 'УЗК', { preHeatTreatmentMode: 'selected' }).status).toBe('allowed-with-warning')
    const rejected = { ...row, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'УЗК', requestName: 'НК', result: 'ремонт' }] }
    expect(getPrimaryLnkRequestAccess(rejected, 'ВИК').status).toBe('blocked')
    expect(getPrimaryLnkStageAccess(rejected, 'УЗК').status).toBe('blocked')
  })

  it('continues R10+ through dispatcher and persisted/virtual codes, including deletion of the last repair', () => {
    const rows = Array.from({ length: 13 }, (_, index) => support({ id: index + 1, joint: index ? `ОП-1R${index}` : 'ОП-1', uzkResult: 'ремонт' }))
    for (const chain of [rows, rows.slice(0, -1)]) {
      const source = chain.at(-1)!
      const tasks = buildRepeatedJointTasks(chain, [], [], quiet).filter(task => task.kind === 'create')
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({ row: { id: source.id }, targetJoint: `ОП-1R${chain.length}` })
      const persisted = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(tasks)).tasks
      const index = buildDispatcherTaskCodeIndexRows(persisted, chain)
      expect(index.length).toBeGreaterThan(0)
      expect(buildMergedDispatcherTaskCodes(index, []).allByRowId.has(source.id)).toBe(true)
      expect(getCoilTransitionModeForSource({ officialRejectedRows: chain, sourceRow: source, earlyCoilDecisionSourceRowIds: new Set([source.id]) })).toBeNull()
      expect(evaluateEarlyCoilCandidate(chain, source).reason).toContain('Для Т катушка запрещена')
    }
  })

  it('creates a fresh support repair with full length and preserved assignments, without copying facts or allowing W/Y', () => {
    const row = support({ preHeatTreatmentRequired: true, joint: 'ОП-1R10', weldLength: 600.123456, pstoRequired: 'да', pvkResult: 'годен', uzkResult: 'ремонт',
      duplicateControls: [{ id: 2, weldJointId: 1, method: 'УЗК', result: 'ремонт' }] as WeldRow['duplicateControls'],
      preHeatTreatmentControls: [{ id: 3, weldJointId: 1, method: 'УЗК', result: 'годен' }],
      pstoRepeatCycles: [{ id: 4, weldJointId: 1, sequence: 2, pstoResult: 'проведено' }] as WeldRow['pstoRepeatCycles'] })
    const before = structuredClone(row)
    const draft = buildRepeatedJointDraft(row, 'ОП-1R11') as WeldRow
    expect(draft).toMatchObject({ connectionType: 'Т1', weldLength: String(row.weldLength), hasVik: 'да', hasUzk: 'да', hasPvk: 'да',
      pstoRequired: 'да', hasRk: null, weldDate: null, pvkResult: null, uzkResult: null, duplicateControls: [], preHeatTreatmentControls: [], pstoRepeatCycles: [] })
    for (const target of ['ОП-1W1', 'ОП-1Y1', 'ОП-1R10Y2']) expect(() => buildRepeatedJointDraft(row, target)).toThrow('Для Т разрешены только ремонты R')
    expect(row).toEqual(before)
  })

  it('blocks layered control through the action and draft builder even after own good PVK', () => {
    const row = support({ pvkResult: 'годен' })
    expect(getLayeredControlContextActionBlockReason(row)).toContain('только для У')
    expect(() => buildLayeredControlAssignment(row, true)).toThrow('только для У')
  })

  it('rejects orphan RK fields and relational positions, while leaving empty support rows valid', () => {
    const row = support()
    expect(getSupportJointRuleIssues(row)).toEqual([])
    for (const key of ['rkRequest', 'rkRequestDate', 'rkResult', 'rkConclusionDate', 'rkConclusion', 'lnkDefectDescription',
      'rkExposureConfirmedDiameter', 'preRkRequest', 'preRkRequestDate', 'preRkResult', 'preRkConclusionDate', 'preRkConclusion', 'preRkDefectDescription'] as const) {
      expect(getSupportJointRuleIssues({ ...row, [key]: key === 'rkExposureConfirmedDiameter' ? 57 : 'orphan' }).flatMap(issue => issue.fieldKeys)).toContain(key)
    }
    for (const relation of ['duplicateControls', 'preHeatTreatmentControls']) {
      expect(getSupportJointRuleIssues({ ...row, [relation]: [{ method: 'РК', result: '' }] }).some(issue => issue.message.includes('без результата'))).toBe(true)
    }
  })
})
