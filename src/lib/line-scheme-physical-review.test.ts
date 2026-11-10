import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { buildSchemePhysicalGroups, projectSchemeJoint } from './line-scheme-physical'
import { canPlaceSchemeJoint } from './line-schemes'

const settings = DEFAULT_SYSTEM_INDEX_SETTINGS
const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({ id, projectTitle: 'P', subtitleCode: 'C', line: 'L',
  joint: 'S1', weldDate: '2026-11-01', hasVik: 'да', vikResult: 'годен', ...patch })
function captured(rows: WeldRow[]) { const states = captureProgramChainStates(rows, settings); return rows.map(value => ({ ...value, programChainState: states.get(value.id)! })) }

describe('line scheme physical continuity independent acceptance cases', () => {
  it('shows the current repair date and stamps without inheriting missing primary values', () => {
    const rows = captured([row(1, { vikResult: 'ремонт', stamp1K: 'OLD', stamp1Z: 'OLD-Z', stamp1ZFact: 'OLD-FACT', material2: 'OLD-MATERIAL', element2: 'OLD-ELEMENT', d2: 159, t2: 9 }), row(2, { joint: 'S1R1', weldDate: null, stamp1K: 'NEW', stamp1KFact: 'FACT', stamp1Z: null, material1: '12Х18Н10Т', element1: 'Труба', d1: 57, t1: 3.5, vikResult: null })])
    const group = buildSchemePhysicalGroups(rows, settings)[0]
    expect(projectSchemeJoint(group, rows, settings)).toMatchObject({ label: 'S1R1', weldInfo: { date: null, stamp1: 'NEW', stamp1Fact: 'FACT', stamp2: null, stamp2Fact: null, material1: '12Х18Н10Т', material2: null, element1: 'Труба', element2: null, d1: 57, d2: null, t1: 3.5, t2: null } })
  })

  it('permits placing a known physical joint with a control error, including repair assignment debt', () => {
    for (const rows of [captured([row(1, { hasVik: 'нет' })]), captured([row(1, { vikResult: 'ремонт', hasPvk: 'да' }), row(2, { joint: 'S1R1', hasPvk: 'нет' })])]) {
      const joint = projectSchemeJoint(buildSchemePhysicalGroups(rows, settings)[0], rows, settings)
      expect(joint.color).toBe('error')
      expect(canPlaceSchemeJoint(joint)).toBe(true)
    }
  })

  it('does not attribute weld details when the current representative is ambiguous', () => {
    const rows = captured([row(1), row(2, { joint: 'S1R1' }), row(3, { joint: 'S1R2' })])
    const group = { ...buildSchemePhysicalGroups(rows, settings)[0], issue: 'Конфликт цепочки' }
    const joint = projectSchemeJoint(group, rows, settings)
    expect(joint.weldInfo).toBeUndefined()
    expect(joint.rowId).toBeNull()
    expect(joint.inspectionRowId).toBe(group.displayRow.id)
    expect(canPlaceSchemeJoint(joint)).toBe(false)
  })

  it('does not treat a deleted predecessor tombstone as a complete live repair chain', () => {
    const rows = captured([row(1, { vikResult: 'ремонт' }), row(2, { joint: 'S1R1' })])
    const groups = buildSchemePhysicalGroups([rows[1]], settings, new Map([[1, 101], [2, 101]]), new Map(rows.map(value => [value.id, value.programChainState])))
    expect(projectSchemeJoint(groups[0], [rows[1]], settings).color).toBe('error')
  })

  it('keeps the remaining representative after deleting the last repair', () => {
    const rows = captured([row(1, { vikResult: 'ремонт' }), row(2, { joint: 'S1R1' })])
    const group = buildSchemePhysicalGroups([rows[0]], settings, new Map([[1, 101], [2, 101]]), new Map(rows.map(value => [value.id, value.programChainState])))[0]
    expect(projectSchemeJoint(group, [rows[0]], settings)).toMatchObject({ physicalId: 101, rowId: 1, color: 'rejected', welded: true })
  })

  it('a surviving official primary keeps identity after its unofficial predecessor was deleted', () => {
    const rows = captured([row(1, { officiality: 'неофициальный', vikResult: 'ремонт' }), row(2)])
    const group = buildSchemePhysicalGroups([rows[1]], settings, new Map([[1, 101], [2, 101]]), new Map(rows.map(value => [value.id, value.programChainState])))[0]
    expect(projectSchemeJoint(group, [rows[1]], settings)).toMatchObject({ physicalId: 101, rowId: 2, color: 'good' })
  })

  it('does not allow a repair moved away from its source to appear complete', () => {
    const rows = captured([row(1, { vikResult: 'ремонт' }), row(2, { joint: 'S1R1' })])
    const moved = { ...rows[1], line: 'OTHER' }
    const group = buildSchemePhysicalGroups([moved], settings, new Map([[1, 101], [2, 101]]), new Map(rows.map(value => [value.id, value.programChainState])))[0]
    expect(projectSchemeJoint(group, [moved], settings).color).toBe('error')
  })

  it('marks competing physical memberships as errors rather than choosing the last map entry', () => {
    const rows = captured([row(1, { vikResult: 'ремонт' }), row(2, { joint: 'S1R1' })])
    const groups = buildSchemePhysicalGroups(rows, settings, new Map([[1, 101], [2, 102]]))
    expect(groups).toHaveLength(2)
    expect(groups.every(group => projectSchemeJoint(group, rows, settings).color === 'error')).toBe(true)
  })

  it('does not hide a conflicting official continuation behind an inactive grey source', () => {
    const rows = captured([row(1, { officiality: 'неофициальный', vikResult: 'ремонт' }), row(2)])
    const groups = buildSchemePhysicalGroups(rows, settings, new Map([[1, 101], [2, 102]]))
    expect(groups.every(group => projectSchemeJoint(group, rows, settings).color === 'error')).toBe(true)
  })

  it('keeps a welded coil-side repair red without a new weld date, and counts the physical welding fact', () => {
    const rows = captured([row(1, { vikResult: 'вырез' }), row(2, { joint: 'S1Y1', vikResult: 'ремонт' }),
      row(3, { joint: 'S1Y2' }), row(4, { joint: 'S1Y1R1', weldDate: null, vikResult: null })])
    const group = buildSchemePhysicalGroups(rows, settings).find(value => value.rootId === 2)!
    expect(projectSchemeJoint(group, rows, settings)).toMatchObject({ rowId: 4, color: 'rejected', welded: true })
  })

  it('only greys the original after both Y have weld dates and keeps replacement after Y deletion', () => {
    const raw = [row(1, { vikResult: 'вырез' }), row(2, { joint: 'S1Y1', weldDate: null, vikResult: null }), row(3, { joint: 'S1Y2', weldDate: null, vikResult: null })]
    for (const dates of [[null, null], ['2026-11-02', null], ['2026-11-02', '2026-11-02']]) {
      const rows = captured(raw.map((value, index) => index ? { ...value, weldDate: dates[index - 1] } : value))
      const original = buildSchemePhysicalGroups(rows, settings).find(value => value.rootId === 1)!
      expect(projectSchemeJoint(original, rows, settings).color).toBe(dates.every(Boolean) ? 'inactive' : 'rejected')
      expect(projectSchemeJoint(original, rows, settings).rowId).toBe(1)
      if (dates.every(Boolean)) {
        const remaining = buildSchemePhysicalGroups([rows[0]], settings, new Map(), new Map(rows.map(value => [value.id, value.programChainState])))[0]
        expect(projectSchemeJoint(remaining, [rows[0]], settings).color).toBe('inactive')
      }
    }
  })

  it('keeps the live inactive repair card and label when imported IDs are reversed', () => {
    const rows = captured([row(1, { joint: 'S1R1', officiality: 'неофициальный' }), row(2, { officiality: 'неофициальный', vikResult: 'ремонт' })])
    const group = buildSchemePhysicalGroups(rows, settings, new Map([[1, 101], [2, 101]]))[0]
    expect(projectSchemeJoint(group, rows, settings)).toMatchObject({ physicalId: 101, color: 'inactive', rowId: 1, label: 'S1R1' })
  })
})
