import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { buildLnkRequestRows, buildLnkRequestManagerRows } from '@/lib/lnk-request-mutation-updates'
import { buildPrimaryLnkStageDebtSystemWarnings } from '@/lib/repeated-joint-check-tasks'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { buildPrimaryTvmtResultRows } from '@/lib/tvmt-field-updates'
import { buildSystemDocumentDateChangePlan } from '@/lib/system-document-date-change'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { getPrimaryLnkStageAccess } from '@/lib/lnk-control-stage'
import { buildRepeatTvmtResultCycle } from '@/lib/psto-repeat-cycle-updates'

const row = (values: Partial<WeldRow> = {}) => ({
  id: 1, joint: 'F43', projectTitle: 'Риформинг', weldDate: '2026-03-14',
  hasVik: 'да', pstoRequired: 'да', preHeatTreatmentLnkEnabled: false,
  ...values,
}) as WeldRow

describe('requests are scheduling, not evidence of completed primary control', () => {
  it.each(LNK_METHODS)('keeps request and result readiness separate for $code', (method) => {
    const settings = { ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: true, allowPrimaryLnkBeforePreviousStagesComplete: false }
    const previous = row({ preHeatTreatmentLnkEnabled: true, [method.enabledKey]: 'да' })
    const [requested] = buildLnkRequestRows({ records: [previous], methodKeys: [method.requestKey], requestName: '1503-2', requestDate: '2026-03-14', controlProcessSettings: settings })
    expect(requested[method.requestKey]).toBe('1503-2')
    expect(getPrimaryLnkStageAccess(requested, method.code, settings).status).toBe('blocked')
    expect(getLnkChronologyIssues([requested])).toEqual([])
    expect(() => buildLnkRequestRows({ records: [previous], methodKeys: [method.requestKey], requestName: 'Слишком рано', requestDate: '2026-03-13', controlProcessSettings: settings })).toThrow('раньше даты сварки')
    expect(buildLnkRequestRows({ records: [{ ...previous, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: method.code, result: 'вырез' }] }], methodKeys: [method.requestKey], requestName: 'Запрещено', requestDate: '2026-03-14', controlProcessSettings: settings })).toEqual([])
  })

  it.each([false, true])('allows an early request with pre-TO enabled=%s without a stage warning', (enabled) => {
    const settings = { ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: enabled, allowPrimaryLnkBeforePreviousStagesComplete: false }
    const requested = buildLnkRequestRows({
      records: [row({ preHeatTreatmentLnkEnabled: enabled })], methodKeys: ['vikRequest'],
      requestName: '1503-2', requestDate: '2026-03-15', controlProcessSettings: settings,
    })
    expect(requested).toHaveLength(1)
    expect(getLnkChronologyIssues(requested)).toEqual([])
    expect(buildPrimaryLnkStageDebtSystemWarnings(requested as WeldRow[], settings)).toEqual([])
  })

  it('accepts backfilled TVMT between the primary request and its later actual result', () => {
    const previous = row({
      pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-03-15', pstoDate: '2026-03-15', pstoResult: 'проведено',
      tvmtRequest: 'ТВМТ-1', tvmtRequestDate: '2026-03-16', tvmtResult: 'ожидает НК',
      vikRequest: '1503-2', vikRequestDate: '2026-03-15', vikResult: 'годен',
      vikConclusion: 'ВИК-1', vikConclusionDate: '2026-03-25',
    })
    const [updated] = buildPrimaryTvmtResultRows({ records: [previous], controlDate: '2026-03-20', result: 'годен', conclusionName: 'ТВМТ-результат' })
    expect(updated).toMatchObject({ tvmtConclusionDate: '2026-03-20', vikRequest: '1503-2', vikRequestDate: '2026-03-15', vikConclusionDate: '2026-03-25' })
    expect(getLnkChronologyIssues([updated])).toEqual([])
    expect(() => buildPrimaryTvmtResultRows({ records: [previous], controlDate: '2026-03-26', result: 'годен', conclusionName: 'ТВМТ-поздно' })).toThrow('раньше ТВМТ')
  })

  it('allows a name-only correction without hiding existing historical result debt', () => {
    const previous = row({ vikRequest: 'Старое имя', vikRequestDate: '2026-03-15', vikResult: 'годен', vikConclusionDate: '2026-03-25' })
    const [updated] = buildLnkRequestManagerRows({ records: [previous], requestName: 'Старое имя', requestDate: '2026-03-15', nextRequestName: '1503-2', action: 'rename' })
    expect(updated.vikRequest).toBe('1503-2')
    expect(getLnkChronologyIssues([updated])).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'post-before-psto-cycle' })]))
  })

  it('uses the actual result date for a repeated TVMT cycle, not the primary request date', () => {
    const previous = row({
      pstoRequest: 'П-1', pstoDate: '2026-03-15', pstoResult: 'проведено',
      tvmtRequest: 'Т-1', tvmtResult: 'не годен', tvmtConclusionDate: '2026-03-16',
      vikRequest: '1503-2', vikRequestDate: '2026-03-15', vikResult: 'годен', vikConclusionDate: '2026-03-25',
      pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, pstoRequest: 'П-2', pstoRequestDate: '2026-03-17', pstoDate: '2026-03-18', pstoResult: 'проведено', tvmtRequest: 'Т-2', tvmtRequestDate: '2026-03-18', tvmtResult: 'ожидает НК' }],
    })
    expect(buildRepeatTvmtResultCycle({ row: previous, controlDate: '2026-03-20', result: 'годен', conclusionName: 'ТВМТ-2' })).toMatchObject({ tvmtConclusionDate: '2026-03-20' })
    expect(() => buildRepeatTvmtResultCycle({ row: previous, controlDate: '2026-03-26', result: 'годен', conclusionName: 'ТВМТ-2' })).toThrow('раньше ТВМТ')
  })

  it.each(['1503-2', 'Заявка-15.03.2026-007'])('preserves the complete name %s when changing only the date', (title) => {
    const plan = buildSystemDocumentDateChangePlan({
      reference: { type: 'lnkRequest', title, date: '2026-03-15' }, nextDate: '2026-03-16',
      rows: [row({ vikRequest: title, vikRequestDate: '2026-03-15' })],
    })
    expect(plan.nextTitle).toBe(title)
    expect(plan.rows[0]).toMatchObject({ vikRequest: title, vikRequestDate: '2026-03-16' })
  })
})
