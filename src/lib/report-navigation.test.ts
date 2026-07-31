import { describe, expect, it } from 'vitest'
import { buildExactJointFilters } from '@/lib/report-navigation'
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
})
