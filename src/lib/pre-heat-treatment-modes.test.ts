import { buildPercentageLineSummaries } from './percentage-line-summary'
import { buildLineProgramDisplay } from './line-program-display'
import { calculateLineProgram } from './line-program-calculation'
import { buildWelderStatisticsSummary } from './welder-statistics-summary'
import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { isPreHeatTreatmentLnkAvailable, getPrimaryLnkStageAccess } from './lnk-control-stage'
import { calculateFinalStatus } from './weld-status'
import { buildPreHeatTreatmentFillItems, groupPreHeatTreatmentFillItems } from './pre-heat-treatment-fill'
import { DEFAULT_SYSTEM_DOCUMENT_SPLIT_SETTINGS as split } from './system-document-splitting'
import { buildPrimaryLnkStageDebtSystemWarnings } from './repeated-joint-check-tasks'
const row = (value: Partial<WeldRow> = {}): WeldRow => ({ id: 1, joint: 'F1', line: 'L', projectTitle: 'P', subtitleCode: 'S', weldDate: '2026-11-01', pstoRequired: 'да', hasVik: 'да', hasPvk: 'да', preHeatTreatmentMode: 'selected' as const, preHeatTreatmentRequired: true, ...value })
describe('selected preliminary control', () => {
  it.each(['selected', 'allPsto'] as const)('requires current PSTO in %s, while retaining inactive history', mode => {
    expect(isPreHeatTreatmentLnkAvailable(row({ preHeatTreatmentMode: mode }))).toBe(true)
    expect(isPreHeatTreatmentLnkAvailable(row({ preHeatTreatmentMode: mode, pstoRequired: 'отменен', pstoDate: '2026-11-02' }))).toBe(false)
  })
  it('keeps a new selected chain off and allows early primary independently of its flag', () => {
    expect(isPreHeatTreatmentLnkAvailable(row({ preHeatTreatmentRequired: false }))).toBe(false)
    for (const required of [true, false]) expect(getPrimaryLnkStageAccess(row({ preHeatTreatmentRequired: required }), 'ВИК').status).toBe('allowed-with-warning')
  })
  it('distinguishes missing requests from missing results and retains inactive/reject priority', () => {
    expect(calculateFinalStatus(row())).toBe('ожидает заявку до ТО')
    const controls = [{ id: 1, weldJointId: 1, method: 'ВИК', requestName: 'A', result: 'ожидает НК' }, { id: 2, weldJointId: 1, method: 'ПВК', requestName: 'A', result: 'ожидает НК' }]
    expect(calculateFinalStatus(row({ preHeatTreatmentControls: controls }))).toBe('ожидает НК до ТО')
    expect(calculateFinalStatus(row({ preHeatTreatmentControls: controls.slice(0, 1) }))).toBe('ожидает заявку до ТО')
    expect(calculateFinalStatus(row({ revisionActuality: 'не актуален' }))).toBe('неактуальный')
    expect(calculateFinalStatus(row({ preHeatTreatmentControls: [{ ...controls[0], result: 'ремонт' }] }))).toBe('не годен')
  })
  it('warns after actual PSTO/TVMT, never just a waiting label or request', () => {
    expect(buildPrimaryLnkStageDebtSystemWarnings([row()])).toEqual([])
    expect(buildPrimaryLnkStageDebtSystemWarnings([row({ pstoRequest: 'P', pstoResult: 'ожидает ПСТО' })])).toEqual([])
    expect(buildPrimaryLnkStageDebtSystemWarnings([row({ pstoDate: '2026-11-02', pstoResult: 'проведено' })])[0]?.systemWarningCode).toBe('СП-06')
  })
})
describe('missing preliminary document planner', () => {
  it.each(['не годен', 'архивный результат', 'годен · назначение отменено'])('does not replace a non-waiting legacy result "%s" with good control', result => {
    const plan = buildPreHeatTreatmentFillItems([row({ hasPvk: null, preHeatTreatmentControls: [
      { id: 1, weldJointId: 1, method: 'ВИК', requestName: 'old', requestDate: '2026-11-01', result },
    ] })], {})
    expect(plan.items).toEqual([])
    expect(plan.errors.join(' ')).toContain('результат')
    expect(plan.issues).toEqual([expect.objectContaining({ rowId: 1, method: 'ВИК' })])
  })
  it.each(['', 'ожидает', 'ожидает НК', 'ожидает заявку'])('still fills a missing result with waiting value "%s"', result => {
    const plan = buildPreHeatTreatmentFillItems([row({ hasPvk: null, preHeatTreatmentControls: [
      { id: 1, weldJointId: 1, method: 'ВИК', requestName: 'old', requestDate: '2026-11-01', result },
    ] })], {})
    expect(plan.errors).toEqual([])
    expect(plan.items.map(item => [item.action, item.methods])).toEqual([['result', ['ВИК']]])
  })
  it('uses own weld dates, excludes inapplicable records and never overwrites completed or partial facts', () => {
    const first = row({ preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', requestName: 'old', result: 'годен' }] })
    const second = row({ id: 2, preHeatTreatmentRequired: false })
    const plan = buildPreHeatTreatmentFillItems([first, second], {})
    expect(plan.errors).toEqual([])
    expect(plan.items.map(item => [item.action, item.methods, item.date])).toEqual([['result', ['ПВК'], '2026-11-01'], ['request', ['ПВК'], '2026-11-01']])
    const partial = buildPreHeatTreatmentFillItems([row({ hasPvk: null, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', conclusionDate: '2026-11-02' }] })], {})
    expect(partial.items).toEqual([])
    expect(partial.errors[0]).toContain('фактические реквизиты')
  })
  it('splits dates/manual names independently and preserves edits when regrouping', () => {
    const rows = [row(), row({ id: 2, joint: 'F2', line: 'L2' }), row({ id: 3, joint: 'F3', weldDate: '2026-11-02' })]
    const options = { overrides: { '1:result:ВИК': { name: 'Моё имя', date: '2026-11-03' } } }
    const { items } = buildPreHeatTreatmentFillItems(rows, options)
    const a = groupPreHeatTreatmentFillItems(rows, items, split)
    expect(a.groups.filter(g => g.action === 'request')).toHaveLength(2)
    const b = groupPreHeatTreatmentFillItems(rows, items, { ...split, lnkRequest: 'joint', lnkConclusionVik: 'line' })
    expect(b.groups.filter(g => g.action === 'request')).toHaveLength(3)
    for (const plan of [a, b]) expect(plan.groups.find(g => g.name === 'Моё имя')).toMatchObject({ date: '2026-11-03', useSystemName: false })
  })
})

it('counts preliminary waiting in line and welder summaries, including stage subtotals', () => {
  const base = { connectionType: 'С17', hasPvk: null, stamp1K: 'A', stamp1KFact: 'A', stamp1ZFact: 'A', weldControlPercent: 10, category: 'II', groupName: 'A' }
  const rows = [row({ ...base }), row({ ...base, id: 2, joint: 'F2', preHeatTreatmentControls: [{ id: 2, weldJointId: 2, method: 'ВИК', requestName: 'R', requestDate: '2026-11-01' }] })]
  const program = buildLineProgramDisplay(rows, calculateLineProgram(rows, 10, 10), 10, 10)
  expect(program.summary.incompleteStages).toEqual({ welding: 0, request: 1, control: 1, other: 0 })
  expect(buildPercentageLineSummaries(rows)[0]?.stamps[0]).toMatchObject({ waitingRequestJoints: 1, waitingControlJoints: 1 })
  const welders = buildWelderStatisticsSummary(rows, [], '', '', 'joints')
  expect(welders.rows[0]).toMatchObject({ waitingRequest: 1, waitingControl: 1 })
})
