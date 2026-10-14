import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWelderStampCompatibilityCheckTasks } from './repeated-joint-check-tasks'
import * as compatibility from './welder-stamp-compatibility'
import { OFFICIAL_STAMP_COMPATIBILITY_PROFILE_FIELDS } from './welder-stamp-compatibility-profile'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import type { WeldRow } from './dispatcher-types'
import type { WelderStampRecord } from './welder-stamp-types'

const row: WeldRow = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1',
  weldingMethod: 'РАД', materialGroup: 'М01', connectionType: 'С17', d1: 108, d2: 57, t1: 6, t2: 4,
  weldDate: '2026-07-01', stamp1K: 'AB12', stamp1Z: 'AB12', stamp1O: 'AB12' }
const permit = { id: 'n1', weldType: 'РАД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '500',
  thicknessFrom: '1', thicknessTo: '20', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }
const stamp: WelderStampRecord = { naksStamp: 'AB12', internalStamp: '', welderName: 'Сварщик',
  ...permit, id: 1, naksPermits: [permit], dlsPermits: [{ ...permit, id: 'd1', number: 'ДЛС' }] }
afterEach(() => vi.restoreAllMocks())

describe('per-calculation compatibility reuse', () => {
  it('checks one identical usage profile once but still produces every joint-specific task', () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ ...row, id: index + 1, joint: `F${index + 1}` }))
    const expected = rows.flatMap(item => buildWelderStampCompatibilityCheckTasks([item], []))
    const check = vi.spyOn(compatibility, 'getOfficialStampCompatibilityIssues')
    expect(buildWelderStampCompatibilityCheckTasks(rows, [])).toEqual(expected)
    expect(expected).toHaveLength(200)
    expect(check).toHaveBeenCalledOnce()
  })

  it.each(OFFICIAL_STAMP_COMPATIBILITY_PROFILE_FIELDS)('does not mix changes to %s', field => {
    const rows = [row, { ...row, id: 2, joint: 'F2', [field]: 'different' }]
    const expected = rows.flatMap(item => buildWelderStampCompatibilityCheckTasks([item], [stamp]))
    const check = vi.spyOn(compatibility, 'getOfficialStampCompatibilityIssues')
    expect(buildWelderStampCompatibilityCheckTasks(rows, [stamp])).toEqual(expected)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('keeps team positions, raw spellings, material sides, dates, archived permits and suspensions exact', () => {
    const rows = [row,
      { ...row, stamp1K: 'cd34', stamp2K: 'AB12', weldingMethod: 'РАД + РД' },
      { ...row, stamp1K: ' ab12 ' }, { ...row, weldDate: '' },
      { ...row, connectionType: 'У19', materialGroup: 'М05 + М01' },
      { ...row, connectionType: 'У19', materialGroup: 'М01 + М05' },
    ].flatMap((item, index) => [0, 1].map(copy => ({ ...item, id: index * 2 + copy + 1, joint: `F${index * 2 + copy + 1}` })))
    const stamps = [stamp, { ...stamp, id: 2, naksStamp: 'CD34', naksPermits: [{ ...permit, archived: true, weldType: 'РД' }] }]
    const suspensions = [{ id: 1, naksStamp: 'CD34', suspendedFrom: '2026-01-01', suspendedTo: '' }]
    const expected = rows.flatMap(item => buildWelderStampCompatibilityCheckTasks([item], stamps, suspensions))
    const check = vi.spyOn(compatibility, 'getOfficialStampCompatibilityIssues')
    expect(buildWelderStampCompatibilityCheckTasks(rows, stamps, suspensions)).toEqual(expected)
    expect(check).toHaveBeenCalledTimes(6)
  })

  it('does not carry results between calculations with changed registry, settings or suspensions', () => {
    const check = vi.spyOn(compatibility, 'getOfficialStampCompatibilityIssues')
    const missing = buildWelderStampCompatibilityCheckTasks([row], [])
    const valid = buildWelderStampCompatibilityCheckTasks([row], [stamp])
    const suspended = buildWelderStampCompatibilityCheckTasks([row], [stamp], [{ id: 1, naksStamp: 'AB12', suspendedFrom: '2026-01-01', suspendedTo: '' }])
    const ignoredDls = buildWelderStampCompatibilityCheckTasks([row], [{ ...stamp, dlsPermits: [] }], [], undefined, undefined, { ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: false })
    const requiredDls = buildWelderStampCompatibilityCheckTasks([row], [{ ...stamp, dlsPermits: [] }], [], undefined, undefined, { ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: true })
    const stillMandatory = buildWelderStampCompatibilityCheckTasks([row], [], [], undefined, undefined, { ...DEFAULT_SAVE_CHECK_SETTINGS, officialRegistry: false })
    expect(missing).toHaveLength(1)
    expect(valid).toHaveLength(0)
    expect(suspended[0].details).toContain('отстранено')
    expect(ignoredDls).toHaveLength(0)
    expect(requiredDls).toHaveLength(1)
    expect(stillMandatory).toEqual(missing)
    expect(check).toHaveBeenCalledTimes(6)
  })

  it('bounds stored profiles without dropping checks for an unusually varied line', () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ ...row, id: i + 1, d1: i + 1 }))
    const check = vi.spyOn(compatibility, 'getOfficialStampCompatibilityIssues')
    buildWelderStampCompatibilityCheckTasks([...rows, rows[0], rows[599]], [])
    expect(check).toHaveBeenCalledTimes(601)
  })
})
