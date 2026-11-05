import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from './data-list-settings'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from './control-process-settings'
import { DEFAULT_OTHER_SETTINGS } from './other-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { getOfficialStampJointDimensionRequirements, getOfficialStampMaterialScopes } from './welder-stamp-compatibility-utils'
import { buildWeldFormStampSelectOptions, getOfficialStampCompatibilityIssues, shouldValidateOfficialStampCompatibilityForSave } from './welder-stamp-compatibility'
import { buildWelderStampCompatibilityCheckTasks } from './repeated-joint-check-tasks'
import { buildDispatcherTaskCodeIndexRows } from './dispatcher-task-row-codes'
import { DEFAULT_STAMP_CHECK_EXAMPLE, explainStampCheckExample } from './welder-stamp-check-explanation'
import { mergeWeldRecordsWithPrevious, validateServerWeldRecords } from '@/server/weld-save-validation'
import type { WeldJoint } from '@/db/schema'
import type { WeldInput } from './weld-fields'
import type { WelderStampNaksPermit, WelderStampRecord } from './welder-stamp-types'

const checks = { ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: true }
const row: WeldInput = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'ОП-1',
  connectionType: 'Т1', materialGroup: 'М05', weldingMethod: 'РД', stamp1K: 'AAAA', stamp1Z: 'AAAA',
  d1: '57', t1: '6', d2: null, t2: null, weldDate: '2026-07-01' }
function permit(group: string, method: string, override: Partial<WelderStampNaksPermit> = {}): WelderStampNaksPermit {
  return { id: `${group}:${method}`, weldType: method, materialGroups: group,
    diameterFrom: '57', diameterTo: '57', thicknessFrom: '6', thicknessTo: '6',
    validFrom: '2026-01-01', validTo: '2026-12-31', note: '', ...override }
}
function stamp(groups = ['М01', 'М05'], methods = ['РАД', 'РД']): WelderStampRecord {
  const permits = groups.flatMap(group => methods.map(method => permit(group, method)))
  return { id: 1, naksStamp: 'AAAA', internalStamp: '', welderName: '', weldType: '', materialGroups: '',
    diameterFrom: '', diameterTo: '', thicknessFrom: '', thicknessTo: '', validFrom: '', validTo: '',
    archived: false, naksPermits: permits, dlsPermits: permits.map(value => ({ ...value, number: 'ДЛС' })) }
}
const issues = (record: WeldInput, entry = stamp()) => getOfficialStampCompatibilityIssues(record, [entry], {
  saveCheckSettings: checks, weldingTypes: DEFAULT_DATA_LIST_SETTINGS.weldingTypes, materialGroups: DEFAULT_DATA_LIST_SETTINGS.materialGroups,
})
beforeEach(() => localStorage.clear())

describe('Т-03 support qualification uses pipe geometry for every material', () => {
  it.each(['Т', 'Т1', 'т3', 'Т4д'])('%s uses only D1/T1, never a hidden second side', connectionType => {
    const record = { ...row, connectionType, d2: 1, t2: 1 }
    expect(getOfficialStampJointDimensionRequirements(record)).toEqual({ diameters: [57], thicknesses: [6], diameterCoverage: 'all', thicknessCoverage: 'all' })
    expect(getOfficialStampMaterialScopes(record)).toMatchObject([
      { group: 'М05', side: 1, geometrySide: 1, dimensions: { diameters: [57], thicknesses: [6] } },
    ])
    expect(issues(record)).toEqual([])
    expect(issues({ ...record, d1: 58, d2: 57 }).map(issue => issue.message).join(' ')).toContain('58')
    expect(issues({ ...record, t1: 7, t2: 6 }).map(issue => issue.message).join(' ')).toContain('7')
  })

  for (const materialGroup of ['М01', 'М05']) {
    for (const weldingMethod of ['РАД', 'РД']) {
      it(`checks ${materialGroup} / ${weldingMethod} with one official stamp`, () => {
        const record = { ...row, materialGroup, weldingMethod }
        expect(issues(record)).toEqual([])
        expect(buildWeldFormStampSelectOptions([stamp()], record, [], { saveCheckSettings: checks }).stamp1K?.[0])
          .toMatchObject({ value: 'AAAA', disabled: false })
      })
    }
  }

  it.each(['М01', 'М05'])('never borrows missing %s from the other material', missing => {
    const entry = stamp(['М01', 'М05'].filter(group => group !== missing))
    expect(issues({ ...row, materialGroup: missing }, entry).map(issue => issue.message).join(' ')).toContain(missing)
    expect(buildWeldFormStampSelectOptions([entry], { ...row, materialGroup: missing }, [], { saveCheckSettings: checks }).stamp1K?.[0])
      .toMatchObject({ disabled: true, reason: expect.stringContaining(missing) })
  })

  it.each(['М01', 'М05'])('requires all methods in the single offered stamp for %s', materialGroup => {
    const entry = stamp(['М01', 'М05'], ['РАД'])
    expect(issues({ ...row, materialGroup }, entry).map(issue => issue.message).join(' ')).toContain('РД')
    expect(buildWeldFormStampSelectOptions([entry], { ...row, materialGroup }, [], { saveCheckSettings: checks }).stamp1K?.[0])
      .toMatchObject({ disabled: true, reason: expect.stringContaining('РД') })
    // An invalid second stamp must not turn support qualification into team coverage.
    const second = { ...stamp(['М01', 'М05'], ['РД']), id: 2, naksStamp: 'BBBB' }
    expect(getOfficialStampCompatibilityIssues({ ...row, materialGroup, stamp1Z: 'BBBB' }, [entry, second], { saveCheckSettings: checks })).not.toEqual([])
  })

  it('checks the second material DLS separately and retains NAKS when DLS is disabled', () => {
    const entry = stamp()
    entry.dlsPermits = entry.dlsPermits.filter(value => value.materialGroups !== 'М05')
    expect(issues(row, entry).map(issue => issue.message).join(' ')).toMatch(/ДЛС[\s\S]*М05/)
    expect(getOfficialStampCompatibilityIssues(row, [entry], { saveCheckSettings: { ...checks, officialDls: false } })).toEqual([])
    entry.naksPermits = entry.naksPermits.filter(value => value.materialGroups !== 'М05')
    expect(getOfficialStampCompatibilityIssues(row, [entry], { saveCheckSettings: { ...checks, officialDls: false } }).map(issue => issue.message).join(' ')).toContain('М05')
  })

  it('keeps date, archive and suspension checks on the actual weld date', () => {
    const entry = stamp()
    entry.naksPermits = entry.naksPermits.map(value => ({ ...value, validTo: '2026-06-30' }))
    expect(issues(row, entry).some(issue => issue.reason === 'date')).toBe(true)
    expect(issues({ ...row, weldDate: '2026-06-01' }, entry)).toEqual([])
    const archived = { ...stamp(), archived: true, archivedAt: '2026-07-01' }
    expect(issues(row, archived).some(issue => issue.reason === 'archived')).toBe(true)
    expect(issues({ ...row, weldDate: '2026-06-30' }, archived)).toEqual([])
    expect(getOfficialStampCompatibilityIssues(row, [stamp()], { saveCheckSettings: checks,
      suspensions: [{ id: 1, naksStamp: 'AAAA', suspendedFrom: '2026-07-01', suspendedTo: '2026-07-02' }] })[0]?.reason).toBe('suspended')
  })

  it('retains СП-02 and its persisted code for existing mismatches without modifying facts', () => {
    const record = { ...row, id: 1 }
    const before = structuredClone(record)
    const tasks = buildWelderStampCompatibilityCheckTasks([record], [stamp(['М01'])])
    expect(tasks).not.toHaveLength(0)
    expect(buildDispatcherTaskCodeIndexRows(tasks, [record])).toContainEqual({ rowId: 1, code: 'СП-02', taskKey: 'code:СП-02' })
    expect(record).toEqual(before)
  })

  it.each([false, true])('preserves unrelated correction exemption; changed qualification inputs still fail (import=%s)', importMode => {
    const entry = stamp(['М01']) // Existing stamp no longer qualifies for the selected material.
    const previous = { ...row } as WeldJoint
    const previousRows = new Map([[1, previous]])
    const context = { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, saveCheckSettings: checks,
      dataListSettings: { ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: [...DEFAULT_DATA_LIST_SETTINGS.connectionTypes, 'Т1'] },
      otherSettings: DEFAULT_OTHER_SETTINGS, systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      welderStamps: [entry], welderStampSuspensions: [], pstoLineAssignments: new Map() }
    const validate = (patch: WeldInput) => validateServerWeldRecords({ records: mergeWeldRecordsWithPrevious([{ id: 1, ...patch }], previousRows), previousRows, context, importMode })
    expect(shouldValidateOfficialStampCompatibilityForSave({ ...row, weldingJournalNote: 'Уточнение', stamp1KFact: 'BBBB' }, row)).toBe(false)
    expect(shouldValidateOfficialStampCompatibilityForSave({ ...row, d2: 159, t2: 3 }, row)).toBe(false)
    expect(shouldValidateOfficialStampCompatibilityForSave({ ...row, d1: 159 }, row)).toBe(true)
    expect(() => validate({ weldingJournalNote: 'Уточнение', isometry: 'ISO-2', stamp1KFact: 'BBBB' })).not.toThrow()
    expect(() => validate({ t1: 7 })).toThrow()
    expect(() => validate({ weldDate: '2026-07-02' })).toThrow()
    expect(() => validate({ materialGroup: 'М11' })).toThrow()
    expect(previous).toEqual(row)
  })
})

describe('Т-19 support example shares qualification geometry', () => {
  it.each(['М01', 'М05'])('uses D1/T1 and one welder after switching from a two-person example (%s)', group2 => {
    const input = { ...DEFAULT_STAMP_CHECK_EXAMPLE, connectionType: 'Т' as const, group1: group2, group2,
      d1: '57', t1: '6,5', d2: 'invalid hidden value', t2: '', stampCount: 2 as const,
      weldingMethod: 'РАД' as const, methodA: 'РАД' as const, methodB: 'РАД' as const }
    const result = explainStampCheckExample(input)
    expect(result.errors).toEqual([])
    expect(result.welders).toEqual([{ name: 'Сварщик А', methods: 'РАД' }])
    expect(result.teamWarning).toBeNull()
    expect(result.scopes).toHaveLength(1)
    for (const scope of result.scopes) expect(scope).toMatchObject({ diameter: 'D1 = 57 мм', thickness: 'T1 = 6.5 мм', diameterFields: ['d1'], thicknessFields: ['t1'], alternatives: false })
  })
  it('collects real support input errors without requiring a hidden second geometry', () => {
    const result = explainStampCheckExample({ ...DEFAULT_STAMP_CHECK_EXAMPLE, connectionType: 'Т', d1: '', t1: '-1', d2: '', t2: '', group2: '' })
    expect(result.errors).toHaveLength(3)
    expect(result.errors.join(' ')).not.toMatch(/D2|T2/)
    expect(result.scopes).toEqual([])
  })
})
