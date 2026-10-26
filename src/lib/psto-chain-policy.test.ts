import { describe, expect, it } from 'vitest'
import { applyPstoChainPolicy, getPstoChainRoot, getPstoProgramState, type PstoLinePolicy } from './psto-chain-policy'
import { DEFAULT_SYSTEM_INDEX_SETTINGS as settings } from './system-index-settings'
import type { WeldRow } from './dispatcher-types'
import { formatControlBasisSummary } from './control-assignment-basis'
import { WELD_FIELDS } from './weld-field-definitions'
import { SYSTEM_FIELD_KEYS, restrictWeldMutationRecord } from '@/server/weld-mutation-policy'
import { getPstoWorkflowLineAssignmentError } from '@/server/psto-workflow-line-guard'
import { getPstoLineIdentityKey } from './psto-line-assignment'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from './control-process-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from './data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from './other-settings'
import { getSystemWorkflowStageTransitionReason, prepareServerWeldRecords, type ServerWeldValidationContext } from '@/server/weld-save-validation'
import type { WeldJoint } from '@/db/schema'
import { buildLineConsistencyTasks } from './line-consistency-tasks'

const row = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'S3' } as WeldRow
const decision = { id: 4, required: true, basis: 'Техническое решение 15' }
const policy: PstoLinePolicy = { rowCount: 10, assignedCount: 2, programState: 'unassigned', exceptions: new Map([['s3', decision]]) }
const apply = (value: WeldRow, rule = policy) => applyPstoChainPolicy(value, rule, settings)

describe('whole-chain PSTO policy', () => {
  it.each(['S3', 'S3R1', 'S3R1W1', 'S3R1W1Y1', 'S3Y2R1', ' s3r1w1 '])('inherits the chain decision for %s', joint => {
    expect(getPstoChainRoot(joint, settings)).toBe('s3')
    expect(apply({ ...row, joint, officiality: 'неофициальный' })).toMatchObject({ pstoRequired: 'да', pstoExceptionBasis: decision.basis })
  })
  it('does not prefix-match a neighbouring physical joint', () => {
    expect(apply({ ...row, joint: 'S30R1' }).pstoRequired).toBeNull()
    expect(getPstoProgramState(policy)).toBe('unassigned')
  })
  it('preserves request, execution, TVMT and repeats across removal and reinstatement', () => {
    const history = { ...row, pstoRequired: 'да', pstoRequest: 'П-1', pstoRequestDate: '2026-10-01', pstoResult: 'проведено',
      pstoDate: '2026-10-02', heatTreatmentDiagram: 'Д-1', tvmtRequest: 'Т-1', tvmtResult: 'годен', tvmtConclusion: 'ТК-1',
      pstoRepeatCycles: [{ id: 9, weldJointId: 1, sequence: 2, pstoRequest: 'П-2' }] } as WeldRow
    const removed = apply(history, { ...policy, exceptions: new Map() })
    expect(removed).toMatchObject({ pstoRequired: 'отменен', pstoExceptionBasis: null, pstoRequest: 'П-1', tvmtConclusion: 'ТК-1' })
    expect(removed.pstoRepeatCycles).toBe(history.pstoRepeatCycles)
    expect(apply(removed)).toMatchObject({ ...history, pstoExceptionBasis: decision.basis })
  })
  it('does not infer performed work from a waiting label, and keeps request-only history', () => {
    expect(apply({ ...row, pstoResult: 'ожидает заявку' }, { ...policy, exceptions: new Map() }).pstoRequired).toBeNull()
    expect(apply({ ...row, pstoRequest: 'П-1' }, { ...policy, exceptions: new Map() })).toMatchObject({ pstoRequired: 'отменен', pstoRequest: 'П-1' })
  })
  it('uses only currently active exceptions, without reviving a closed decision', () => {
    const baseline = { ...policy, programState: 'assigned' as const, exceptions: new Map() }
    const off = apply({ ...row, pstoRequired: 'да' }, { ...baseline, exceptions: new Map([['s3', { ...decision, required: false }]]) })
    expect(off.pstoRequired).toBe('отменен')
    const closed = apply(off, { ...baseline, programState: 'unassigned' })
    expect(closed.pstoExceptionBasis).toBeNull()
    expect(apply(closed, baseline).pstoRequired).toBe('да')
  })
  it('allows an assigned exception on an unassigned line and blocks an excluded chain on an assigned line', () => {
    const active = apply(row)
    expect(getPstoWorkflowLineAssignmentError([active], [row, active], {}, new Map([[getPstoLineIdentityKey(row), policy]]), settings)).toBeNull()
    const excludedPolicy = { ...policy, programState: 'assigned' as const, exceptions: new Map([['s3', { ...decision, required: false }]]) }
    const excluded = apply(row, excludedPolicy)
    expect(getPstoWorkflowLineAssignmentError([excluded], [row, active], {}, new Map([[getPstoLineIdentityKey(row), excludedPolicy]]), settings)).toContain('не назначено')
  })
  it.each([true, false])('dispatcher accepts the canonical exception but detects an unconverted chain member (required=%s)', required => {
    const rule: PstoLinePolicy = { ...policy, programState: required ? 'unassigned' : 'assigned', exceptions: new Map([['s3', { ...decision, required }]]) }
    const policies = new Map([[getPstoLineIdentityKey(row), rule]])
    const rows = [row, { ...row, id: 2, joint: 'S3R1W1' }, { ...row, id: 3, joint: 'S30' }].map(value => apply(value, rule))
    const check = (values: WeldRow[]) => buildLineConsistencyTasks(values, new Set(), settings, policies).filter(task => task.fieldKey === 'pstoPresence')
    expect(check(rows)).toEqual([])
    expect(check(rows.map(value => value.id === 2 ? { ...value, pstoRequired: required ? null : 'да', pstoExceptionBasis: null } : value))).toHaveLength(1)
  })
  it('dispatcher accepts cancelled historical facts alongside fresh rows after an exception closes', () => {
    const rule = { ...policy, exceptions: new Map() }
    const rows = [apply({ ...row, pstoRequired: 'да', pstoRequest: 'П-1' }, rule), apply({ ...row, id: 2, joint: 'S30' }, rule)]
    expect(buildLineConsistencyTasks(rows, new Set(), settings, new Map([[getPstoLineIdentityKey(row), rule]])).filter(task => task.fieldKey === 'pstoPresence')).toEqual([])
  })
  it('keeps the explanation out of the form and ordinary writes, and uses the existing summary', () => {
    expect(WELD_FIELDS.some(field => String(field.key) === 'pstoExceptionBasis')).toBe(false)
    expect(SYSTEM_FIELD_KEYS.has('pstoExceptionBasis')).toBe(true)
    expect(restrictWeldMutationRecord({ ...row, pstoExceptionBasis: 'подмена' }, 'welding')).not.toHaveProperty('pstoExceptionBasis')
    expect(formatControlBasisSummary({ ...apply(row), rkControlBasis: 'Решение 2' })).toBe('РК: Решение 2; ПСТО: Техническое решение 15')
    expect(formatControlBasisSummary(row)).toBe('')
  })
  it.each([true, false])('import inherits the effective chain decision and ignores forged assignment fields (required=%s)', required => {
    const rule: PstoLinePolicy = { ...policy, programState: required ? 'unassigned' : 'assigned', exceptions: new Map([['s3', { ...decision, required }]]) }
    const context: ServerWeldValidationContext = { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
      dataListSettings: DEFAULT_DATA_LIST_SETTINGS, otherSettings: DEFAULT_OTHER_SETTINGS, systemIndexSettings: settings, welderStamps: [], welderStampSuspensions: [],
      pstoLineAssignments: new Map([[getPstoLineIdentityKey(row), rule]]) }
    const records = ['S3', 'S3R1', 'S3R1W1Y1R1'].map(joint => ({ ...row, joint, pstoRequired: required ? null : 'да', pstoExceptionBasis: 'Подмена из файла' }))
    prepareServerWeldRecords({ records, previousRows: new Map(), context, importMode: true })
    expect(records.every(r => r.pstoRequired === (required ? 'да' : 'отменен') && r.pstoExceptionBasis === decision.basis)).toBe(true)
  })
  it('uses the exception to require pre-TO NK and allows PSTO after that stage is complete', () => {
    const current = { ...apply(row), weldDate: '2026-10-01', hasVik: 'да', pstoRequest: 'П-1', pstoRequestDate: '2026-10-02' }
    const context = { controlProcessSettings: { ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: true },
      systemIndexSettings: settings, pstoLineAssignments: new Map([[getPstoLineIdentityKey(row), policy]]) }
    expect(getSystemWorkflowStageTransitionReason(current, row as WeldJoint, context)).toContain('до ТО')
    const completed = { ...current, preHeatTreatmentControls: [{ id: 10, weldJointId: row.id, method: 'ВИК', result: 'годен', requestName: 'В-1', requestDate: '2026-10-01', conclusionName: 'ВК-1', conclusionDate: '2026-10-02' }] } as WeldRow
    expect(getSystemWorkflowStageTransitionReason(completed, row as WeldJoint, context)).toBe('')
  })
  it('keeps unfinished TVMT available after withdrawal of an actually performed PSTO', () => {
    const previous = { ...row, pstoRequired: 'отменен', pstoRequest: 'П-1', pstoRequestDate: '2026-10-01', pstoDate: '2026-10-02', pstoResult: 'проведено' } as WeldJoint
    const next = { ...previous, tvmtRequest: 'Т-1', tvmtRequestDate: '2026-10-03' }
    expect(getSystemWorkflowStageTransitionReason(next, previous, { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      systemIndexSettings: settings, pstoLineAssignments: new Map([[getPstoLineIdentityKey(row), { ...policy, exceptions: new Map() }]]) })).toBe('')
  })
})
