import { describe, expect, it } from 'vitest'
import {
  buildExactJointFilters,
  buildJointChainFilters,
  followUpdatedWeldRowFilters,
} from '@/lib/report-navigation'
import { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
import { filterWeldRowsByColumns } from '@/lib/weld-table-filtering'
import type { WeldRow } from '@/lib/dispatcher-types'

function makeRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'LIN-000-11-31',
    joint: 'F7',
    ...overrides,
  } as WeldRow
}

describe('report navigation', () => {
  it('keeps the original joint spelling in an exact navigation filter', () => {
    expect(buildExactJointFilters(makeRow())).toEqual({
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'LIN-000-11-31',
      joint: '=F7',
    })
  })

  it('matches an exact joint filter without depending on letter case', () => {
    const row = makeRow()

    expect(filterWeldRowsByColumns([row], { joint: '=f7' })).toEqual([row])
    expect(filterWeldRowsByColumns([row], { joint: '=F7' })).toEqual([row])
  })

  it('shows only the exact requested chain and not similarly named bases', () => {
    const rows = [
      makeRow({ id: 1, joint: 'F01' }),
      makeRow({ id: 2, joint: 'F01R1' }),
      makeRow({ id: 3, joint: 'F01A' }),
      makeRow({ id: 4, joint: 'F01AR1' }),
      makeRow({ id: 5, joint: 'FB01' }),
      makeRow({ id: 6, joint: 'FB01R1' }),
    ]

    expect(filterWeldRowsByColumns(rows, buildJointChainFilters(rows[0], 'F01')).map((row) => row.id)).toEqual([1, 2])
    expect(filterWeldRowsByColumns(rows, buildJointChainFilters(rows[4], 'FB01')).map((row) => row.id)).toEqual([5, 6])
  })

  it('moves exact identity filters with an edited joint so the row stays visible', () => {
    const previousRow = makeRow({ finalStatus: 'годен' })
    const nextRow = makeRow({ line: 'LIN-000-22-41', joint: 'F7R1', finalStatus: 'годен' })
    const filters = {
      ...buildExactJointFilters(previousRow),
      finalStatus: 'годен',
    }

    const nextFilters = followUpdatedWeldRowFilters(filters, previousRow, nextRow)

    expect(nextFilters).toEqual({
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'LIN-000-22-41',
      joint: '=F7R1',
      finalStatus: 'годен',
    })
    expect(filterWeldRowsByColumns([nextRow], nextFilters)).toEqual([nextRow])
  })

  it('preserves broad and unrelated filters instead of rewriting the whole report state', () => {
    const previousRow = makeRow()
    const nextRow = makeRow({ line: 'LIN-000-22-41' })
    const filters = {
      line: 'LIN-000',
      joint: '=F7',
      weldDate: '2026-09',
    }

    expect(followUpdatedWeldRowFilters(filters, previousRow, nextRow)).toBe(filters)
  })

  it('keeps existing multi-value choices and adds the new identity value', () => {
    const previousRow = makeRow()
    const nextRow = makeRow({ line: 'LIN-000-22-41' })
    const filters = {
      line: buildWeldColumnValueFilter(['LIN-000-11-31', 'LIN-OTHER']),
    }

    const nextFilters = followUpdatedWeldRowFilters(filters, previousRow, nextRow)
    const choice = parseWeldColumnChoiceFilter(nextFilters.line)

    expect(choice?.values).toEqual(['LIN-000-11-31', 'LIN-OTHER', 'LIN-000-22-41'])
    expect(filterWeldRowsByColumns([nextRow], nextFilters)).toEqual([nextRow])
  })
})
