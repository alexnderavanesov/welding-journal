import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildLineSummary } from '@/lib/line-summary'

describe('buildLineSummary', () => {
  it('does not count chain predecessors before the good official joint', () => {
    const rows = [
      makeRow(1, { joint: 'S2', status: 'неофициальный', weldDate: '2026-07-01', rkResult: 'вырез' }),
      makeRow(2, { joint: 'S2', status: 'неофициальный', weldDate: '2026-07-02', rkResult: 'вырез' }),
      makeRow(3, { joint: 'S2', weldDate: '2026-07-03', rkResult: 'вырез' }),
      makeRow(4, { joint: 'S2W1', weldDate: '2026-07-04', rkResult: 'годен', wdi: '2.5' }),
    ]

    const summary = buildLineSummary(rows, 'joints')

    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0].total).toBe(1)
    expect(summary.rows[0].completed).toBe(1)
    expect(summary.rows[0].remaining).toBe(0)
  })

  it('counts only one good joint per chain even when a coil branch has several good joints', () => {
    const rows = [
      makeRow(1, { joint: 'S8', weldDate: '2026-07-01', hasRk: 'да', rkResult: 'вырез' }),
      makeRow(2, { joint: 'S8R1', weldDate: '2026-07-02', hasRk: 'да', rkResult: 'вырез' }),
      makeRow(3, { joint: 'S8Y1', weldDate: '2026-07-03', vikResult: 'годен', hasRk: 'да', rkResult: 'годен' }),
      makeRow(4, { joint: 'S8Y2', weldDate: '2026-07-03', vikResult: 'годен', hasRk: 'да', rkResult: 'годен' }),
    ]

    const summary = buildLineSummary(rows, 'joints')

    expect(summary.rows).toHaveLength(1)
    expect(summary.total).toBe(1)
    expect(summary.completed).toBe(1)
    expect(summary.rows[0].total).toBe(1)
    expect(summary.rows[0].completed).toBe(1)
  })

  it('counts only the current official chain leaf before the good joint appears', () => {
    const rows = [
      makeRow(1, { joint: 'F1', weldDate: '2026-07-01', vikResult: 'вырез' }),
      makeRow(2, { joint: 'F1W1', weldDate: '', hasVik: 'да' }),
    ]

    const summary = buildLineSummary(rows, 'joints')

    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0].total).toBe(1)
    expect(summary.rows[0].completed).toBe(0)
    expect(summary.rows[0].remaining).toBe(1)
    expect(summary.rows[0].totalF).toBe(1)
  })

  it('ignores rows marked as not actual by revision', () => {
    const rows = [
      makeRow(1, { joint: 'S1', weldDate: '2026-07-01', revisionActuality: 'не актуален' }),
      makeRow(2, { joint: 'S2', weldDate: '2026-07-01', wdi: '3' }),
    ]

    const summary = buildLineSummary(rows, 'wdi')

    expect(summary.rows).toHaveLength(1)
    expect(summary.total).toBe(3)
    expect(summary.completed).toBe(3)
  })

  it('groups one line by project, subtitle, group, category and control percent', () => {
    const rows = [
      makeRow(1, { joint: 'S1', weldDate: '2026-07-01', groupName: 'A', category: 'I', weldControlPercent: '100' }),
      makeRow(2, { joint: 'S2', weldDate: '', groupName: 'A', category: 'I', weldControlPercent: '100' }),
      makeRow(3, { joint: 'S3', weldDate: '2026-07-01', groupName: 'B', category: 'I', weldControlPercent: '100' }),
    ]

    const summary = buildLineSummary(rows, 'joints')

    expect(summary.rows).toHaveLength(2)
    expect(summary.rows[0]).toMatchObject({ groupName: 'A', total: 2, completed: 1, remaining: 1, totalS: 2 })
    expect(summary.rows[1]).toMatchObject({ groupName: 'B', total: 1, completed: 1, remaining: 0, totalS: 1 })
  })
})

function makeRow(id: number, row: Partial<WeldRow>): WeldRow {
  return {
    id,
    projectTitle: 'TKM5',
    subtitleCode: '330-01',
    line: 'L1',
    groupName: 'A',
    category: 'I',
    weldControlPercent: '100',
    joint: `S${id}`,
    hasVik: 'да',
    ...row,
  } as WeldRow
}
