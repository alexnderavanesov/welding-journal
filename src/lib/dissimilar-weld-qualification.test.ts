import { beforeEach, describe, expect, it } from 'vitest'
import type { WeldInput } from './weld-fields'
import type { WeldJoint } from '@/db/schema'
import type { WelderStampNaksPermit, WelderStampRecord } from './welder-stamp-types'
import { buildWeldFormStampSelectOptions, getOfficialStampCompatibilityIssues, getOfficialStampCompatibilitySaveBlockReason } from './welder-stamp-compatibility'
import { buildWelderStampCompatibilityCheckTasks } from './repeated-joint-check-tasks'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from './data-list-settings'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from './control-process-settings'
import { DEFAULT_OTHER_SETTINGS } from './other-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { mergeWeldRecordsWithPrevious, validateServerWeldRecords } from '@/server/weld-save-validation'

const checks = { ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: false }
const row: WeldInput = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', stamp1K: 'AAAA', weldingMethod: 'РАД', materialGroup: 'М01 + М05', connectionType: 'С17', d1: '57', t1: '3', d2: '159', t2: '8', weldDate: '2026-07-01' }
function permit(group: string, overrides: Partial<WelderStampNaksPermit> = {}): WelderStampNaksPermit {
  return { id: `${group}-${overrides.weldType ?? 'РАД'}`, weldType: 'РАД', materialGroups: group, diameterFrom: '1', diameterTo: '1000', thicknessFrom: '1', thicknessTo: '100', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', ...overrides }
}
function stamp(permits = [permit('М01', { diameterTo: '57', thicknessTo: '3' }), permit('М05', { diameterFrom: '159', thicknessFrom: '8' })], naksStamp = 'AAAA'): WelderStampRecord {
  return { id: naksStamp === 'AAAA' ? 1 : 2, naksStamp, internalStamp: '', welderName: '', weldType: '', materialGroups: '', diameterFrom: '', diameterTo: '', thicknessFrom: '', thicknessTo: '', validFrom: '', validTo: '', archived: false, naksPermits: permits, dlsPermits: [] }
}
const reason = (record: WeldInput, stamps: WelderStampRecord[], officialDls = false) => getOfficialStampCompatibilitySaveBlockReason(record, stamps, { saveCheckSettings: { ...checks, officialDls } })
beforeEach(() => localStorage.clear())

describe('dissimilar weld qualifications', () => {
  it('looks up a large registry once per dispatcher batch, not once per joint', () => {
    let stampReads = 0
    const registry = Array.from({ length: 2000 }, (_, index) => {
      const record = stamp([permit('М01, М05')], index === 1999 ? 'AAAA' : `B${index}`)
      const value = record.naksStamp
      Object.defineProperty(record, 'naksStamp', { get: () => { stampReads++; return value } })
      return record
    })
    const rows = Array.from({ length: 1000 }, (_, index) => ({ ...row, id: index + 1 }) as WeldJoint)
    expect(buildWelderStampCompatibilityCheckTasks(rows, registry)).toEqual([])
    expect(stampReads).toBeLessThan(10000)
  })
  for (const pair of [['М01', 'М05'], ['М01', 'М11'], ['М05', 'М11']]) {
    for (const connectionType of ['С17', 'У19']) for (const reverse of [false, true]) {
      for (const weldingMethod of ['РАД', 'РД', 'РАД+РД']) for (const people of [1, 2]) {
        it(`${connectionType}: ${pair.join('/')} reverse=${reverse}, ${weldingMethod}, welders=${people}: common and separate permits agree`, () => {
          const materials = reverse ? [...pair].reverse() : pair
          const record = { ...row, connectionType, materialGroup: materials.join(' + '), weldingMethod,
            stamp1Z: people === 2 ? 'BBBB' : 'AAAA', stamp1O: 'AAAA' }
          const methods = weldingMethod.split('+')
          const makeTeam = (separate: boolean) => Array.from({ length: people }, (_, index) => {
            const ownMethods = people === 2 && methods.length === 2 ? [methods[index]] : methods
            const permits = separate ? pair.flatMap(group => ownMethods.map(weldType => permit(group, { weldType })))
              : [permit([...pair].reverse().join(', '), { weldType: ownMethods.join(', ') })]
            const person = stamp(permits, index === 0 ? 'AAAA' : 'BBBB')
            person.dlsPermits = permits.map(p => ({ ...p, id: `dls-${p.id}`, number: 'ДЛС' }))
            return person
          })
          for (const separate of [false, true]) {
            const team = makeTeam(separate)
            expect(reason(record, team, true)).toBeNull()
            expect(getOfficialStampCompatibilityIssues(record, team, { saveCheckSettings: { ...checks, officialDls: true } })).toEqual([])
            // Each official person needs both materials; one person's loss is not covered by another.
            team[0].naksPermits = team[0].naksPermits.map(p => ({ ...p, materialGroups: pair[0] }))
            expect(reason(record, team, true)).toContain(pair[1])
            expect(reason(record, team, false)).toContain(pair[1]) // DLS setting cannot weaken NAKS.
          }
        })
      }
    }
  }
  it.each(['С17', 'У19', 'У17'])('%s checks both sides, and swapping only groups changes eligibility', connectionType => {
    const record = { ...row, connectionType }
    expect(reason(record, [stamp()])).toBeNull()
    const swapped = { ...record, materialGroup: 'М05 + М01' }
    expect(reason(swapped, [stamp()])).toContain('Материал 1: М05; D1 = 57')
    const issues = getOfficialStampCompatibilityIssues(swapped, [stamp()], { saveCheckSettings: checks })
    expect(issues.map(issue => issue.message).join(' ')).toContain('Материал 2: М01; D2 = 159')
    expect(buildWeldFormStampSelectOptions([stamp()], swapped, [], [], { saveCheckSettings: checks }).stamp1K?.[0]).toMatchObject({ disabled: true, reason: expect.stringContaining('Материал 2: М01') })
    expect(buildWelderStampCompatibilityCheckTasks([{ ...swapped, id: 1 }], [stamp()])[0]?.reason).toBeDefined()
    expect(JSON.stringify(buildWelderStampCompatibilityCheckTasks([{ ...swapped, id: 1 }], [stamp()]))).toContain('Материал 2: М01')
  })
  it('does not use the homogeneous angular Tmin shortcut for equal diameters', () => {
    const stamps = [stamp([permit('М01'), permit('М05', { thicknessTo: '3' })])]
    expect(reason({ ...row, connectionType: 'У19', d2: '57' }, stamps)).toContain('толщину 8')
    expect(reason({ ...row, connectionType: 'У19', materialGroup: 'М05', d2: '57' }, stamps)).toBeNull()
  })
  it('preserves homogeneous angular paired-thickness and non-angular independent alternatives', () => {
    const stamps = [stamp([permit('М01', { diameterTo: '57', thicknessTo: '3' })])]
    const homogeneous = { ...row, materialGroup: 'М01', t1: '8', t2: '3' }
    expect(reason({ ...homogeneous, connectionType: 'У19' }, stamps)).toContain('толщину 8')
    expect(reason(homogeneous, stamps)).toBeNull()
    expect(reason({ ...homogeneous, materialGroup: 'М01 + М01' }, stamps)).toBeNull()
  })
  it('allows own permits to cover D and T separately inside each material, never across materials or people', () => {
    const permits = [permit('М01', { thicknessTo: '2' }), permit('М01', { diameterFrom: '100' }), permit('М05')]
    expect(reason(row, [stamp(permits)])).toBeNull()
    expect(reason(row, [stamp([permit('М01', { thicknessTo: '2' }), permit('М05')])])).toContain('толщину 3')
    expect(reason({ ...row, stamp1Z: 'BBBB' }, [stamp([permit('М01')]), stamp([permit('М05')], 'BBBB')])).toContain('группу материалов')
  })
  it('rejects cross-method group coverage and explains exactly which combination is missing', () => {
    const stamps = [stamp([permit('М01'), permit('М05', { weldType: 'РД' })])]
    const record = { ...row, weldingMethod: 'РАД+РД' }
    const message = reason(record, stamps)
    expect(message).toContain('М05')
    expect(message).toContain('других способов: РД')
    expect(message).toContain('Материал 2')
    expect(buildWeldFormStampSelectOptions(stamps, record).stamp1K?.[0].disabled).toBe(true)
  })
  it('allows method teamwork only with both groups per participating welder and does not borrow ranges from a half-qualified method', () => {
    const rad = stamp([permit('М01'), permit('М05')])
    const rd = stamp([permit('М01', { weldType: 'РД' }), permit('М05', { weldType: 'РД' })], 'BBBB')
    const record = { ...row, weldingMethod: 'РАД+РД', stamp1Z: 'BBBB' }
    expect(reason(record, [rad, rd])).toBeNull()
    rd.naksPermits = [permit('М05', { weldType: 'РД' })]
    expect(reason(record, [rad, rd])).toContain('Материал 1: М01')
    rad.naksPermits = [permit('М01', { thicknessTo: '2' }), permit('М05'), permit('М01', { weldType: 'РД' })]
    expect(reason(record, [rad, stamp([permit('М01', { weldType: 'РД' }), permit('М05', { weldType: 'РД' })], 'BBBB')])).toContain('толщину 3')
  })
  it('checks DLS independently on both sides and does not combine NAKS with DLS', () => {
    const s = stamp()
    s.dlsPermits = [permit('М01'), permit('М05')].map(p => ({ ...p, number: 'ДЛС' }))
    expect(reason(row, [s], true)).toBeNull()
    s.dlsPermits[1].thicknessTo = '4'
    expect(reason(row, [s], true)).toContain('ДЛС на толщину 8')
    expect(reason(row, [s], true)).toContain('Материал 2: М05')
    expect(reason(row, [s], false)).toBeNull()
  })
  it('checks validity per material and preserves missing-date historical behavior', () => {
    const s = stamp()
    s.naksPermits[1].validTo = '2026-06-01'
    expect(reason(row, [s])).toContain('Материал 2: М05')
    s.naksPermits[1].archived = true
    expect(reason({ ...row, weldDate: null }, [s])).toBeNull()
    expect(buildWeldFormStampSelectOptions([s], { ...row, weldDate: null }, [], [], { saveCheckSettings: checks }).stamp1K?.[0]).toMatchObject({
      disabled: false, reason: expect.stringContaining('Материал 2: М05'),
    })
    expect(buildWeldFormStampSelectOptions([s], { ...row, weldDate: null }, [], [], { saveCheckSettings: checks }).stamp1K?.[0].reason).toContain('укажите дату сварки')
    expect(reason({ ...row, weldDate: '2026-05-01' }, [s])).toBeNull()
  })
  it.each([false, true])('server checks final merged groups/dimensions even with legacy disabled toggles (import=%s)', importMode => {
    const previous = { ...row } as WeldJoint
    const previousRows = new Map([[1, previous]])
    const context = { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, saveCheckSettings: { ...checks, officialMaterialGroup: false, officialDiameter: false, officialThickness: false }, dataListSettings: DEFAULT_DATA_LIST_SETTINGS, otherSettings: DEFAULT_OTHER_SETTINGS, systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, welderStamps: [stamp()], welderStampSuspensions: [], pstoLineAssignments: new Map() }
    const validate = (update: WeldInput) => validateServerWeldRecords({ records: mergeWeldRecordsWithPrevious([{ id: 1, ...update }], previousRows), previousRows, context, importMode })
    expect(() => validate({ materialGroup: 'М05 + М01' })).toThrow('Материал 1: М05')
    expect(() => validate({ t2: '2' })).toThrow('Материал 2: М05')
    expect(() => validate({ materialGroup: 'М01 + М05 + М11' })).toThrow('не более двух')
    expect(() => validate({ materialGroup: 'М01 +' })).toThrow('с каждой стороны')
    const normalized = mergeWeldRecordsWithPrevious([{ id: 1, materialGroup: 'М01+М05' }], previousRows)
    validateServerWeldRecords({ records: normalized, previousRows, context, importMode })
    expect(normalized[0].materialGroup).toBe('М01 + М05')
    expect(() => validate({ weldingJournalNote: 'Факт' })).not.toThrow()
    expect(previous.materialGroup).toBe('М01 + М05')
  })
})
