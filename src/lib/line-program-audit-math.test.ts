import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram, calculateLineProgramBaseRequired } from './line-program-calculation'
import { buildPercentageLineControlTasks } from './percentage-line-tasks'

const row = (id: number, patch: Partial<WeldRow> = {}): WeldRow => ({
  id, joint: `F${id}`, projectTitle: 'P', subtitleCode: 'S', line: 'L',
  connectionType: 'С17', category: 'II', groupName: 'A',
  officiality: 'действующий', revisionActuality: 'актуальная',
  weldDate: '2026-09-01', stamp1K: 'A', hasVik: 'да',
  weldControlPercent: 10, pvkControlPercent: 0, ...patch,
})
const line = (count: number) => Array.from({ length: count }, (_, index) => row(index + 1))
const snapshot = (rows: WeldRow[]) => calculateLineProgram(rows, 10, 0).map(group => ({
  stamp: group.stamp, count: group.rowIds.length, base: group.common.baseRequired,
  extra: group.common.additionalRequired, credit: group.common.coveredRowIds.length,
  missing: group.common.missing, excess: group.common.excessRowIds.length,
}))

describe('independent arithmetic and state-transition audit, 1 October', () => {
  it.each([
    [0, 10, 0], [1, 0, 0], [1, 0.001, 1], [24, 10, 2], [25, 10, 3],
    [149, 1, 1], [150, 1, 2], [250, 0.6, 2], [1000, 0.15, 2],
    [200000, 0.001, 2], [200000, 99.999, 199998], [200000, 100, 200000],
  ])('rounds %i × %s%% to %i without using implementation-derived expectations', (count, percent, expected) => {
    expect(calculateLineProgramBaseRequired(count, percent)).toBe(expected)
  })

  it.each(['да', 'годен'])('moving the sole assignment/fact to another stamp restores A debt (%s)', fact => {
    const rows = line(10)
    rows[0] = { ...rows[0], hasRk: 'да', ...(fact === 'годен' ? { rkResult: fact } : {}) }
    const changed = rows.map(value => value.id === 1 ? { ...value, stamp1K: 'B' } : value)
    expect(snapshot(changed)).toEqual([
      { stamp: 'A', count: 9, base: 1, extra: 0, credit: 0, missing: 1, excess: 0 },
      { stamp: 'B', count: 1, base: 1, extra: 0, credit: 1, missing: 0, excess: 0 },
    ])
    expect(buildPercentageLineControlTasks(changed).filter(task => task.issue === 'missing')
      .map(task => [task.stamp, task.count])).toEqual([['A', 1]])
  })

  it('removing B from the rejected source removes both its surcharge and one credit, leaving one surplus, not two', () => {
    const rows: WeldRow[] = line(10).map(value => ({ ...value, stamp1K: 'B' }))
    rows[0] = row(1, { stamp1K: 'A', stamp1Z: 'B', rkResult: 'ремонт' })
    rows[1].hasRk = 'да'; rows[2].hasUzk = 'да'
    rows[0].stamp1Z = null
    expect(snapshot(rows)).toEqual([
      { stamp: 'A', count: 1, base: 1, extra: 2, credit: 1, missing: 0, excess: 0 },
      { stamp: 'B', count: 9, base: 1, extra: 0, credit: 2, missing: 0, excess: 1 },
    ])
  })

  it.each([
    { officiality: 'неофициальный' }, { revisionActuality: 'не актуален' },
    { officiality: 'неофициальный', revisionActuality: 'не актуален' },
  ])('excluding and restoring a source recalculates facts and assignments without changing them: %j', flags => {
    const rows = line(10)
    rows[0].rkResult = 'ремонт'; rows[1].hasRk = 'да'; rows[2].hasUzk = 'да'
    const original = structuredClone(rows)
    const excluded = rows.map(value => value.id === 1 ? { ...value, ...flags } : value)
    expect(snapshot(excluded)).toEqual([{ stamp: 'A', count: 9, base: 1, extra: 0, credit: 2, missing: 0, excess: 1 }])
    const restored = excluded.map(value => value.id === 1 ? { ...value, officiality: 'действующий', revisionActuality: 'актуальная' } : value)
    expect(snapshot(restored)).toEqual([{ stamp: 'A', count: 10, base: 1, extra: 2, credit: 3, missing: 0, excess: 0 }])
    expect(rows).toEqual(original)
  })

  it('does not publish an unreachable task and restores it when a new candidate appears', () => {
    const source = row(1, { rkResult: 'ремонт' })
    expect(snapshot([source])[0]).toMatchObject({ extra: 2, credit: 1, missing: 0 })
    expect(buildPercentageLineControlTasks([source]).filter(task => task.issue === 'missing')).toEqual([])
    expect(snapshot([source, row(2)])[0]).toMatchObject({ extra: 2, credit: 1, missing: 1 })
    expect(buildPercentageLineControlTasks([source, row(2)]).filter(task => task.issue === 'missing')
      .map(task => task.count)).toEqual([1])
    expect(snapshot([source, row(2, { hasUzk: 'да' })])[0]).toMatchObject({ credit: 2, missing: 0 })
  })
})
