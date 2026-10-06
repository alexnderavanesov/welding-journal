import { describe, expect, it } from 'vitest'
import { buildVisibleDispatcherTasks } from './dispatcher-task-builder'
import { DEFAULT_DISPATCHER_SETTINGS, DEFAULT_DISPATCHER_REMINDER_SETTINGS, getDispatcherTaskCode, type DispatcherSettings } from './dispatcher-settings'
import { buildJointNextActions } from './joint-next-actions'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from './dispatcher-task-row-codes'
import { captureProgramChainStates } from './line-program-chain-state'
import { getEarlyCoilDecisionKey } from './early-coil-decision'
import { isClearedErroneousCoilRow, isSafeEarlyCoilReplacementRow } from './early-coil-candidate'
import type { WeldRow } from './dispatcher-types'
import { calculateFinalStatus } from './weld-status'

const root: WeldRow = { id: 1, joint: 'S1', line: 'L', projectTitle: 'P', subtitleCode: 'S', connectionType: 'С17', weldDate: '2026-09-01', hasVik: 'да', vikResult: 'годен', hasUzk: 'да', uzkResult: 'ремонт', category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0 }
const repair: WeldRow = { ...root, id: 2, joint: 'S1R1', weldDate: '2026-09-02', uzkResult: 'годен' }
const coils = [3, 4].map(id => ({ ...repair, id, joint: `S1Y${id - 2}`, weldDate: '2026-09-03' }))
const allEnabled = Object.fromEntries(Object.keys(DEFAULT_DISPATCHER_SETTINGS).map(key => [key, true])) as DispatcherSettings
const visible = (rows: WeldRow[], accepted: Set<string> = new Set()) => buildVisibleDispatcherTasks({ rows: rows.map(row => ({ ...row, finalStatus: calculateFinalStatus(row) })), acceptedDispatcherWarningKeys: accepted,
  dismissedRepeatedJointTaskKeys: new Set(), dispatcherSettings: allEnabled, dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS, welderStamps: [], welderStampSuspensions: [] }).repeatedJointTasks
const freeze = (rows: WeldRow[]) => { const states = captureProgramChainStates(rows); return rows.map(row => ({ ...row, programChainState: states.get(row.id) })) }

describe('recovery paths with every dispatcher rule enabled', () => {
  it.each([
    ['delete original', () => freeze([root, repair]).slice(1)],
    ['delete middle', () => freeze([root, { ...repair, uzkResult: 'ремонт' }, { ...repair, id: 5, joint: 'S1R2' }]).filter(row => row.id !== 2)],
    ['delete both coil sides', () => freeze([root, ...coils]).filter(row => row.id === 1)],
    ['move original', () => freeze([root, repair]).map(row => row.id === 1 ? { ...row, line: 'Moved' } : row)],
    ['delete one coil side', () => freeze([root, ...coils]).filter(row => row.id !== 3)],
  ] as const)('%s leaves structural debt in tasks, stored codes and next step', (_name, fixture) => {
    const rows = fixture(), tasks = visible(rows)
    const structural = tasks.filter(task => getDispatcherTaskCode(task) === 'СП-04')
    expect(structural.length).toBeGreaterThan(0)
    const codes = buildMergedDispatcherTaskCodes(buildDispatcherTaskCodeIndexRows(tasks, rows), []).allByRowId
    for (const task of structural) {
      expect(codes.get(task.row.id)).toContain('СП-04')
      expect(buildJointNextActions(task.row, tasks)[0]).toMatchObject({ kind: 'dispatcherTask' })
      expect(buildJointNextActions(task.row, tasks)[0].taskActionId).toBeTruthy()
    }
  })
  it.each(['delete', 'unofficial'] as const)('returns an official repair action after %s of the previous repair', change => {
    const rows = change === 'delete' ? [root] : [root, { ...repair, uzkResult: null, officiality: 'неофициальный' }]
    expect(visible(rows).some(task => task.kind === 'create' && task.row.id === 1 && task.targetJoint === 'S1R1')).toBe(true)
  })
  it('currently routes a good unofficial repair to an explicit officiality check, not a hidden dead end', () => {
    const rows = [root, { ...repair, officiality: 'неофициальный' }], tasks = visible(rows)
    expect(tasks.some(task => task.kind === 'check' && task.reason === 'годный стык неофициальный')).toBe(true)
    expect(buildJointNextActions(rows[1], tasks).some(action => action.taskActionId || action.buttonLabel)).toBe(true)
  })
  it('restores creation of a missing early-coil side instead of an invisible accepted exception', () => {
    const rows = freeze([root, ...coils]).filter(row => row.id !== 3)
    const tasks = visible(rows, new Set([getEarlyCoilDecisionKey(1)]))
    expect(tasks.some(task => task.kind === 'coil' && task.targetJoints.includes('S1Y1'))).toBe(true)
  })
  it('does not let an accepted/dismissed key hide the physical restoration task', () => {
    const rows = freeze([root, ...coils]).filter(row => row.id === 1)
    expect(visible(rows, new Set(['program-integrity:1'])).some(task => getDispatcherTaskCode(task) === 'СП-04')).toBe(true)
  })
  it('offers direct work for planned or awaiting-control rows; absence of an error task is not a dead end', () => {
    const planned = { ...root, weldDate: null, uzkResult: null }
    expect(buildJointNextActions(planned, visible([planned]))[0].kind).toBe('editWeld')
    const pending = { ...root, vikResult: null, uzkResult: null }
    expect(buildJointNextActions(pending, visible([pending]))[0].kind).toBe('primaryLnkRequest')
  })
  it('does not offer automatic deletion of a dateless continuation with orphan TVMT facts', () => {
    const rows = [{ ...root, uzkResult: 'годен' }, { ...repair, weldDate: null, vikResult: null, uzkResult: null, tvmtResult: 'не годен' }]
    const tasks = visible(rows)
    expect(tasks.some(task => task.kind === 'delete' && task.row.id === 2)).toBe(false)
    expect(tasks.some(task => task.kind === 'check' && task.row.id === 2)).toBe(true)
  })
  it('separates edited-but-cleared drafts from factual history and untouched automatic deletion', () => {
    const draft = { id: 9, joint: 'S1Y1', hasVik: 'да', vikResult: 'ожидает', createdAt: '2026-09-01', updatedAt: '2026-09-02' }
    expect(isClearedErroneousCoilRow(draft)).toBe(true)
    expect(isSafeEarlyCoilReplacementRow(draft)).toBe(false)
    for (const fact of [{ weldDate: '2026-09-01' }, { vikRequest: 'ВИК-1' }, { vikRequestDate: '2026-09-01' }, { vikResult: 'годен' }, { tvmtResult: 'не годен' }, { tvmtConclusionDate: '2026-09-01' }, { heatTreatmentDiagram: 'Д-1' }]) {
      expect(isClearedErroneousCoilRow({ ...draft, ...fact })).toBe(false)
    }
    expect(isClearedErroneousCoilRow(draft, new Set([9]))).toBe(false)
  })
})
