import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildLineSummary } from '@/lib/line-summary'
import { captureProgramChainStates } from '@/lib/line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'

describe('buildLineSummary', () => {
  it('does not count chain predecessors before the good official joint', () => {
    const rows = [
      makeRow(1, { joint: 'S2', officiality: 'неофициальный', weldDate: '2026-07-01', rkResult: 'вырез' }),
      makeRow(2, { joint: 'S2', officiality: 'неофициальный', weldDate: '2026-07-02', rkResult: 'вырез' }),
      makeRow(3, { joint: 'S2', weldDate: '2026-07-03', rkResult: 'вырез' }),
      makeRow(4, { joint: 'S2W1', weldDate: '2026-07-04', rkResult: 'годен', wdi: '2.5' }),
    ]

    const summary = buildLineSummary(rows, 'joints')

    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0].total).toBe(1)
    expect(summary.rows[0].completed).toBe(1)
    expect(summary.rows[0].remaining).toBe(0)
    expect(summary.rows[0]).toMatchObject({ rowIds: [4], completedRowIds: [4], remainingRowIds: [] })
  })

  it('counts both physical coil sides, not one good representative of the cut chain', () => {
    const rows = [
      makeRow(1, { joint: 'S8', weldDate: '2026-07-01', hasRk: 'да', rkResult: 'вырез' }),
      makeRow(2, { joint: 'S8R1', weldDate: '2026-07-02', hasRk: 'да', rkResult: 'вырез' }),
      makeRow(3, { joint: 'S8Y1', weldDate: '2026-07-03', vikResult: 'годен', hasRk: 'да', rkResult: 'годен' }),
      makeRow(4, { joint: 'S8Y2', weldDate: '2026-07-03', vikResult: 'годен', hasRk: 'да', rkResult: 'годен' }),
    ]

    const summary = buildLineSummary(rows, 'joints')

    expect(summary.rows).toHaveLength(1)
    expect(summary.total).toBe(2)
    expect(summary.completed).toBe(2)
    expect(summary.rows[0]).toMatchObject({ total: 2, completed: 2, rowIds: [3, 4] })
  })

  it('follows 10 → 11 → 9 → 10 only after confirmed physical restoration', () => {
    const originals = Array.from({ length: 10 }, (_, n) => makeRow(n + 1, { weldDate: '2026-07-01' }))
    expect(buildLineSummary(originals, 'joints').total).toBe(10)
    const replaced = saveStates([...originals,
      makeRow(11, { joint: 'S1Y1', weldDate: '2026-07-02' }),
      makeRow(12, { joint: 'S1Y2', weldDate: '2026-07-02' }),
    ])
    expect(buildLineSummary(replaced, 'joints')).toMatchObject({ total: 11, completed: 11 })
    const deleted = replaced.filter(row => row.id <= 10)
    expect(buildLineSummary(deleted, 'joints')).toMatchObject({ total: 9, completed: 9 })
    const restored = deleted.map(row => row.id === 1 ? { ...row,
      programChainState: { ...row.programChainState!, replacedByCoil: false, replacementCoilIds: [] },
    } : row)
    expect(buildLineSummary(restored, 'joints')).toMatchObject({ total: 10, completed: 10 })
  })

  it('counts repair of a coil side once and separates welding dates from good NDT', () => {
    const rows = [
      makeRow(1, { joint: 'S1', weldDate: '2026-07-01' }),
      makeRow(2, { joint: 'S1Y1', weldDate: '2026-07-02', vikResult: 'ремонт', wdi: '2' }),
      makeRow(3, { joint: 'S1Y2', weldDate: '2026-07-02', vikResult: 'ремонт', wdi: '3' }),
      makeRow(4, { joint: 'S1Y1R1', weldDate: '', wdi: '2' }),
    ]
    expect(buildLineSummary(rows, 'joints')).toMatchObject({ total: 2, completed: 1, remaining: 1 })
    expect(buildLineSummary(rows, 'wdi')).toMatchObject({ total: 5, completed: 3, remaining: 2 })
    rows[3].weldDate = '2026-07-03'
    rows[3].vikResult = 'ремонт'
    expect(buildLineSummary(rows, 'joints')).toMatchObject({ total: 2, completed: 2, remaining: 0 })
  })

  it('shows 9 welded out of 11 planned when one of ten originals has two unwelded coil sides', () => {
    const rows = saveStates([
      ...Array.from({ length: 10 }, (_, n) => makeRow(n + 1, { weldDate: '2026-07-01' })),
      makeRow(11, { joint: 'S1Y1', weldDate: '' }),
      makeRow(12, { joint: 'S1Y2', weldDate: '' }),
    ])
    expect(rows[0].programChainState?.replacedByCoil).toBe(false)
    expect(buildLineSummary(rows, 'joints')).toMatchObject({ total: 11, completed: 9, remaining: 2 })
  })

  it('does not hide an unwelded continuation behind a historical good result', () => {
    expect(buildLineSummary([
      makeRow(1, { joint: 'S1', weldDate: '2026-07-01', vikResult: 'годен' }),
      makeRow(2, { joint: 'S1R1', weldDate: '' }),
    ], 'joints')).toMatchObject({ total: 1, completed: 0, remaining: 1 })
  })

  it('uses stable repair identity after renaming and does not move its physical volume to another line', () => {
    const rows = saveStates([
      makeRow(1, { joint: 'S1', weldDate: '2026-07-01' }),
      makeRow(2, { joint: 'S1R1', weldDate: '2026-07-02' }),
      makeRow(3, { joint: 'S1R2', weldDate: '' }),
    ])
    rows[1].joint = 'S900'
    rows[2].joint = 'S800'
    expect(buildLineSummary(rows, 'joints').rows[0]).toMatchObject({ total: 1, remainingRowIds: [3] })
    rows[2].line = 'OTHER'
    expect(buildLineSummary(rows, 'joints').rows).toMatchObject([{ total: 1, completedRowIds: [2], line: 'L1' }])
    expect(buildLineSummary(rows.slice(1), 'joints').total).toBe(0)
  })

  it('does not revive a replaced source when coil sides become excluded', () => {
    const rows = saveStates([
      makeRow(1, { joint: 'S1', weldDate: '2026-07-01' }),
      makeRow(2, { joint: 'S1Y1', weldDate: '2026-07-02' }),
      makeRow(3, { joint: 'S1Y2', weldDate: '2026-07-02' }),
    ])
    rows[1].officiality = 'неофициальный'
    rows[2].revisionActuality = 'не актуален'
    expect(buildLineSummary(rows, 'joints').total).toBe(0)
    rows[1].officiality = ''
    expect(buildLineSummary(rows, 'joints').total).toBe(1)
  })

  it.each([0, 10, 100])('preserves planned welding volume independently of control percent %i', percent => {
    const rows = [
      makeRow(1, { joint: 'S1', weldDate: '2026-07-01', weldControlPercent: String(percent) }),
      makeRow(2, { joint: 'S1Y1', weldDate: '', weldControlPercent: String(percent) }),
      makeRow(3, { joint: 'S1Y2', weldDate: '', weldControlPercent: String(percent) }),
    ]
    expect(buildLineSummary(rows, 'joints')).toMatchObject({ total: 2, completed: 0, remaining: 2 })
  })

  it('counts nested replacement as three surviving connections, independently of names and control eligibility', () => {
    const settings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS, coil: 'K', repair: 'P' }
    const rows = ['S1', 'S1K1', 'S1K2', 'S1K1K1', 'S1K1K2', 'S1K1K1P1']
      .map((joint, i) => makeRow(i + 1, { joint, weldDate: '2026-07-01', connectionType: 'Т', wdi: '1' }))
    expect(buildLineSummary(rows, 'joints', settings)).toMatchObject({ total: 3, completed: 3 })
    expect(buildLineSummary(rows, 'joints', settings).rows[0].rowIds).toEqual([3, 6, 5])
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
    expect(summary.rows[0]).toMatchObject({ rowIds: [2], completedRowIds: [], remainingRowIds: [2] })
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

  it('keeps line summary identities separate when values contain separators', () => {
    const summary = buildLineSummary([
      makeRow(1, { projectTitle: 'A|B', subtitleCode: 'C', line: 'LIN-1', weldDate: '2026-07-01' }),
      makeRow(2, { projectTitle: 'A', subtitleCode: 'B|C', line: 'LIN-1', weldDate: '2026-07-01' }),
    ], 'joints')

    expect(summary.rows).toHaveLength(2)
    expect(summary.rows.map((row) => row.total)).toEqual([1, 1])
  })
})

function saveStates(rows: WeldRow[]) {
  const states = captureProgramChainStates(rows)
  return rows.map(row => ({ ...row, programChainState: states.get(row.id)! }))
}

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
