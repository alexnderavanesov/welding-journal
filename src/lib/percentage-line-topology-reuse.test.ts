import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import * as topology from './line-program-topology'
import { calculateLineProgram } from './line-program-calculation'
import { buildPercentageLineSummaries } from './percentage-line-summary'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'
import { buildVisibleDispatcherTasks } from './dispatcher-task-builder'
import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS } from './dispatcher-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { programApprovalKey } from './program-control-approval'

const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({
  id, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `F${id}`,
  officiality: 'действующий', revisionActuality: 'актуальная', connectionType: 'СШ',
  weldDate: '2026-09-01', stamp1K: 'A', category: 'II', groupName: 'A',
  weldControlPercent: 30, pvkControlPercent: 10, hasVik: 'да', ...patch,
})
const summary = (rows: WeldRow[], approved: ReadonlySet<string> = new Set()) =>
  buildPercentageLineSummaries(rows, DEFAULT_SYSTEM_INDEX_SETTINGS, approved)[0]

afterEach(() => vi.restoreAllMocks())

describe('one topology per percentage-line summary calculation', () => {
  it('builds once per complete eligible line, not once for counting plus once for demand', () => {
    const build = vi.spyOn(topology, 'buildLineProgramTopology')
    const rows = [row(1), row(2), row(3, { line: 'L2' }), row(4, { line: 'invalid', category: null })]
    expect(buildPercentageLineSummaries(rows)).toHaveLength(2)
    expect(build).toHaveBeenCalledTimes(2)
    expect(build.mock.calls.map(([values, full]) => [values.map(value => value.id), full])).toEqual([
      [[1, 2], false], [[3], false],
    ])
  })

  it('retains the separate integrity check in the whole visible dispatcher', () => {
    const build = vi.spyOn(topology, 'buildLineProgramTopology')
    const rows = [row(1), row(2)]
    buildVisibleDispatcherTasks({ rows, acceptedDispatcherWarningKeys: new Set(),
      dismissedRepeatedJointTaskKeys: new Set(), dispatcherSettings: DEFAULT_DISPATCHER_SETTINGS,
      dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS,
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, welderStamps: [], welderStampSuspensions: [],
      includeWelderStampExpiryTasks: false,
    })
    // One integrity topology and one summary/calculation topology (previously three).
    expect(build).toHaveBeenCalledTimes(2)
    expect(build.mock.calls.every(([values]) => values.length === rows.length)).toBe(true)
  })
})

describe('topology reuse preserves the full-line semantic matrix', () => {
  it('ordinary percentage rows keep quotas, duplicate-ID handling and caller context order', () => {
    const first = row(1)
    const rows = [row(3), first, row(2), first]
    const before = structuredClone(rows)
    const result = summary(rows)
    expect(result.rowCount).toBe(3)
    expect(result.rows.map(value => value.id)).toEqual([3, 1, 2, 1])
    expect(result.stamps[0]).toMatchObject({ officialJointCount: 3, requiredControls: 1,
      missingControls: 1, missingCandidateRowIds: [1, 2, 3],
      pvk: { required: 1, candidateRowIds: [1, 2, 3] } })
    expect(calculateLineProgram(rows, 30, 10)[0].rowIds).toEqual([1, 2, 3])
    expect(rows).toEqual(before)
  })

  it.each([0, 1, 30])('preserves ordinary %i%% quota including no requirement at zero', percent => {
    const rows = [row(1, { weldControlPercent: percent, pvkControlPercent: 0 }),
      row(2, { weldControlPercent: percent, pvkControlPercent: 0 })]
    expect(summary(rows).stamps[0]).toMatchObject({ requiredControls: percent ? 1 : 0,
      pvk: { required: 0, missing: 0 } })
  })

  it.each([10, 100])('full-line mode plans unwelded, stampless coil sides with PVK %i%%', pvk => {
    const rows = [row(1), row(2, { joint: 'F1Y1', weldDate: null, stamp1K: null }),
      row(3, { joint: 'F1Y2', weldDate: null, stamp1K: null })]
    // Same array, then change the program: full mode replaces the parent even
    // before both sides are welded; percentage mode must not reuse that topology.
    expect(summary(rows).rowCount).toBe(1)
    for (const value of rows) { value.weldControlPercent = 100; value.pvkControlPercent = pvk }
    const full = summary(rows)
    expect(full.rowCount).toBe(2)
    expect(full.rows.map(value => value.id)).toEqual([2, 3])
    expect(full.stamps).toHaveLength(1)
    expect(full.stamps[0]).toMatchObject({ stamp: '', officialJointCount: 2, requiredControls: 2,
      pvk: { required: pvk === 100 ? 2 : 0 } })
    for (const value of rows) { value.weldControlPercent = 30; value.pvkControlPercent = 10 }
    expect(summary(rows).rows.map(value => value.id)).toEqual([1])
  })

  it('keeps four rejected primary sources, full-control debt and suspension in task order', () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(i + 1, i < 4 ? { hasRk: 'да', rkResult: 'ремонт' } : {}))
    expect(summary(rows).stamps[0]).toMatchObject({ rejectedRowIds: [1, 2, 3, 4],
      fullControlRequired: true, requiredControls: 6, coveredControls: 4, missingControls: 2,
      pvk: { required: 1, candidateRowIds: [5, 6] } })
    expect(buildPercentageLineControlTasks(rows).map(task => [task.issue, task.demandKind ?? 'common', task.targetRowIds])).toEqual([
      ['missing', 'common', [5, 6]], ['missing', 'pvk', [5, 6]],
      ['rejected-rows', 'common', [1, 2, 3, 4]], ['suspend-welder', 'common', [1, 2, 3, 4]],
    ])
  })

  it('mixed R/W/Y keeps physical replacements, historical surcharge and an unreachable norm distinct', () => {
    const rows = [row(1, { joint: 'F1', hasRk: 'да', rkResult: 'ремонт' }),
      row(2, { joint: 'F1R1', rkResult: 'вырез' }), row(3, { joint: 'F1R1W1' }),
      row(4, { joint: 'F2', hasRk: 'да', rkResult: 'вырез' }),
      row(5, { joint: 'F2Y1' }), row(6, { joint: 'F2Y2' }), row(7, { joint: 'F3' })]
    const result = summary(rows)
    expect(result.rowCount).toBe(4) // F1 + two sides replacing F2 + F3; repairs add no connection.
    expect(result.rows.map(value => value.id)).toEqual([1, 4, 5, 6, 7])
    expect(result.stamps[0]).toMatchObject({ rejectedRowIds: [1, 4],
      calculatedRequiredControls: 5, requiredControls: 4, coveredControls: 1, missingControls: 3,
      missingCandidateRowIds: [5, 6, 7] })
  })

  it('does not prefilter inactive or unofficial coil history before topology', () => {
    const rows = [row(1), row(2, { joint: 'F1Y1' }),
      row(3, { joint: 'F1Y2', officiality: 'неофициальный', revisionActuality: 'не актуален' })]
    expect(summary(rows).rowCount).toBe(1)
    expect(summary(rows).rows.map(value => value.id)).toEqual([2])
  })

  it('keeps optional repair surplus even when there are no counted physical rows', () => {
    const rows = [row(2, { joint: 'F1R1', hasPvk: 'да' })]
    const result = summary(rows)
    expect(result.rowCount).toBe(0)
    expect(result.rows).toEqual(rows)
    expect(result.stamps[0]).toMatchObject({ officialJointCount: 0,
      pvk: { required: 0, excessAssignments: [{ rowId: 2, method: 'ПВК', duplicate: false }] } })
  })

  it('canceled C alternatives cover common quota, but PVK needs its own performed fact', () => {
    const rows = [row(1, { hasRk: 'отменен', hasUzk: 'отменен', hasPvk: 'отменен' }),
      row(2, { hasPvk: 'отменен', pvkResult: 'годен' })]
    expect(summary(rows).stamps[0]).toMatchObject({ cancelledAssignedRowIds: [1],
      coveredRowIds: [1], completedRowIds: [], missingControls: 0,
      pvk: { cancelledRowIds: [1, 2], coveredRowIds: [2], completedRowIds: [2], missing: 0 } })
  })

  it.each([false, true])('pre-TO stage enabled=%s preserves surcharge and candidates', enabled => {
    const rows = [row(1, { pstoRequired: 'да', preHeatTreatmentLnkEnabled: enabled,
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'ремонт' }] }), row(2), row(3)]
    expect(summary(rows).stamps[0]).toMatchObject({ rejectedRowIds: enabled ? [1] : [],
      calculatedRequiredControls: enabled ? 3 : 1, completedRowIds: enabled ? [1] : [],
      missingCandidateRowIds: enabled ? [2, 3] : [1, 2, 3] })
  })

  it('current approvals reserve the pair and displace only ordinary surplus; no reuse across calls', () => {
    const rows = [row(1, { hasRk: 'да' }), row(2, { hasRk: 'да', hasUzk: 'да' })]
    const approved = new Set<string>()
    const unapproved = structuredClone(summary(rows, approved))
    expect(unapproved.stamps[0].common.duplicateAssignmentRowIds).toEqual([2])
    approved.add(programApprovalKey(rows[1], 'common', true))
    expect(summary(rows, approved).stamps[0].common.excessAssignments).toEqual([
      { rowId: 1, method: 'РК', duplicate: false },
    ])
    expect(buildPercentageLineControlTasks(rows, [], DEFAULT_SYSTEM_INDEX_SETTINGS, approved)
      .filter(task => task.issue === 'excess').map(task => task.targetRowIds)).toEqual([[1]])
    approved.clear()
    expect(summary(rows, approved)).toEqual(unapproved)
  })

  it('keeps returned task order across stamps and both independent demands', () => {
    const rows = [row(2, { stamp1K: 'B' }), row(1)]
    expect(buildPercentageLineControlTasks(rows).map(task =>
      [task.stamp, task.issue, task.demandKind ?? 'common', task.count, task.targetRowIds])).toEqual([
      ['A', 'missing', 'common', 1, [1]], ['A', 'missing', 'pvk', 1, [1]],
      ['B', 'new-welder', 'common', 1, undefined],
      ['B', 'missing', 'common', 1, [2]], ['B', 'missing', 'pvk', 1, [2]],
    ])
  })

  it('uses the current settings even when the settings object and rows are reused', () => {
    const settings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS }
    const rows = [row(1), row(2, { joint: 'F1P1' })]
    expect(buildPercentageLineSummaries(rows, settings)[0].rowCount).toBe(2)
    settings.repair = 'P'
    expect(buildPercentageLineSummaries(rows, settings)[0].rowCount).toBe(1)
    settings.repair = 'R'
    expect(buildPercentageLineSummaries(rows, settings)[0].rowCount).toBe(2)
  })

  it.each([
    { category: null }, { groupName: '' }, { weldControlPercent: 'bad' },
    { pvkControlPercent: 31 }, { weldControlPercent: 100, pvkControlPercent: 0 },
    { revisionActuality: 'не актуален' }, { line: '' },
  ])('retains the metadata/eligibility short circuit: %j', patch => {
    const build = vi.spyOn(topology, 'buildLineProgramTopology')
    expect(buildPercentageLineSummaries([row(1, patch)])).toEqual([])
    expect(build).not.toHaveBeenCalled()
  })
})
