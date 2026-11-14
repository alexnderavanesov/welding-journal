import { expect, it } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS, getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import { buildVisibleDispatcherTasks } from '@/lib/dispatcher-task-builder'
import { buildDispatcherTaskCodeIndexRows, buildMergedDispatcherTaskCodes } from '@/lib/dispatcher-task-row-codes'
import { parseDispatcherTaskIndexPayload, serializeDispatcherTaskIndexPayload } from '@/lib/dispatcher-task-index-payload'
import { getOfficialStampCompatibilityIssues, getOfficialStampCompatibilitySaveBlockReason } from '@/lib/welder-stamp-compatibility'
import { validateServerWeldRecords } from './weld-save-validation'

const settings = { ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: true }
const row: WeldRow = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F15',
  connectionType: 'С17', materialGroup: 'М01', weldingMethod: 'РАД+РД', weldDate: '2026-07-01',
  d1: 159, d2: 159, t1: 8, t2: 8, stamp1K: 'BBBB', stamp1Z: 'AAAA', hasVik: 'да' }
function permit(weldType: string, thicknessTo = '100') {
  return { id: weldType, weldType, materialGroups: 'М01', diameterFrom: '1', diameterTo: '1000',
    thicknessFrom: '1', thicknessTo, validFrom: '2026-01-01', validTo: '2026-12-31', note: '' }
}
function team(): WelderStampRecord[] {
  return [{ ...permit('РАД'), id: 1, naksStamp: 'BBBB', internalStamp: '', welderName: 'One', archived: false,
    naksPermits: [permit('РАД')], dlsPermits: [{ ...permit('РАД'), number: 'D1' }] },
  { ...permit('РД'), id: 2, naksStamp: 'AAAA', internalStamp: '', welderName: 'Two', archived: false,
    naksPermits: [permit('РД', '2'), permit('РАД')], dlsPermits: [{ ...permit('РД'), number: 'D2' }] }]
}

it.each([false, true])('checks NAKS and DLS independently for the two current stamp fields (swapped=%s)', swapped => {
  const record = swapped ? { ...row, stamp1K: row.stamp1Z, stamp1Z: row.stamp1K } : { ...row }
  const registry = team()
  const issues = () => getOfficialStampCompatibilityIssues(record, registry, { saveCheckSettings: settings })
  const context = { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
    otherSettings: DEFAULT_OTHER_SETTINGS, saveCheckSettings: settings, systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
    welderStamps: registry, welderStampSuspensions: [], pstoLineAssignments: new Map() }
  const save = (importMode = false, previous?: WeldJoint) => validateServerWeldRecords({ records: [record],
    previousRows: previous ? new Map([[1, previous]]) : new Map(), context, importMode })
  const tasks = () => buildVisibleDispatcherTasks({ rows: [record], welderStamps: registry, welderStampSuspensions: [],
    acceptedDispatcherWarningKeys: new Set(), dismissedRepeatedJointTaskKeys: new Set(),
    dispatcherSettings: DEFAULT_DISPATCHER_SETTINGS, dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS,
    saveCheckSettings: settings }).repeatedJointTasks.filter(task => getDispatcherTaskCode(task) === 'СП-02')

  // Original example: NAKS covers T8 and, independently, DLS RD also covers T8.
  expect(issues()).toEqual([])
  expect(save).not.toThrow()
  expect(tasks()).toEqual([])

  for (const failure of ['thickness', 'date', 'absent'] as const) {
    registry[1].dlsPermits = failure === 'absent' ? [] : [{ ...permit('РД', failure === 'thickness' ? '2' : '100'),
      number: 'D2', validTo: failure === 'date' ? '2026-06-01' : '2026-12-31' }]
    const found = issues()
    const dlsIssues = found.filter(issue => issue.reason === 'dls')
    expect(dlsIssues).toHaveLength(1)
    expect(dlsIssues[0]).toMatchObject({ stamp: 'AAAA', fieldKey: swapped ? 'stamp1K' : 'stamp1Z' })
    expect(dlsIssues[0].message).toContain('ДЛС')
    expect(dlsIssues[0].message).not.toContain('НАКС')
    // An absent/expired DLS also leaves the team without RD coverage. This
    // additional true consequence must not be mistaken for a NAKS failure.
    expect(found.every(issue => issue.reason === 'dls' || issue.reason === 'team-weld-type')).toBe(true)
    expect(getOfficialStampCompatibilitySaveBlockReason(record, registry, { saveCheckSettings: settings })).toMatch(/СП-02.*ДЛС/)
    for (const importMode of [false, true]) expect(() => save(importMode)).toThrow(/СП-02.*ДЛС/)
    const stored = parseDispatcherTaskIndexPayload(serializeDispatcherTaskIndexPayload(tasks())).tasks
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored)).toContain(dlsIssues[0].message)
    const index = buildDispatcherTaskCodeIndexRows(stored, [record])
    expect(index).toContainEqual({ rowId: 1, taskKey: 'code:СП-02', code: 'СП-02' })
    expect(buildMergedDispatcherTaskCodes(index, []).allByRowId.get(1)).toContain('СП-02')
    // Unrelated corrections retain the debt rather than falsely approving DLS.
    const previous = { ...record } as unknown as WeldJoint
    record.weldingJournalNote = 'correction'
    expect(() => save(false, previous)).not.toThrow()
    expect(tasks()).toHaveLength(1)
  }
  registry[1].dlsPermits = [{ ...permit('РД'), number: 'D2' }]
  registry[1].naksPermits = [permit('РД', '2')]
  expect(issues()[0]).toMatchObject({ stamp: 'AAAA', reason: 'thickness' })
  expect(issues()[0].message).toContain('НАКС')
  expect(() => save()).toThrow(/СП-02.*НАКС/)
})
