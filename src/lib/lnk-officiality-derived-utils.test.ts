import { describe, expect, it } from 'vitest'
import {
  getFilteredLnkOfficialityRows,
  getLnkOfficialityCounters,
  getSelectedLnkOfficialityRows,
} from './lnk-officiality-derived-utils'
import type { LnkOfficialityDraftState } from './report-draft-state'
import type { WeldRow } from './dispatcher-types'

describe('lnk officiality derived rows', () => {
  it('shows rejected official rows first, then unofficial rows, and hides waiting NDT rows', () => {
    const rows = [
      row(1, { joint: 'S3', finalStatus: 'ожидает НК', rkRequest: 'R-1', rkResult: 'ожидает НК' }),
      row(2, { joint: 'S2', status: 'неофициальный', rkResult: 'ремонт' }),
      row(3, { joint: 'S1', rkResult: 'ремонт' }),
      row(4, { joint: 'S4', finalStatus: 'годен', rkResult: 'годен' }),
    ]
    const draft = draftState({ rowIds: new Set([1, 2, 3]) })

    const filteredRows = getFilteredLnkOfficialityRows(rows, draft)

    expect(filteredRows.map((item) => item.id)).toEqual([3, 2])
    expect(getSelectedLnkOfficialityRows(rows, draft).map((item) => item.id)).toEqual([2, 3])
    expect(getLnkOfficialityCounters(filteredRows)).toEqual({
      rejectedOfficial: 1,
      unofficial: 1,
    })
  })
})

function draftState(overrides: Partial<LnkOfficialityDraftState> = {}): LnkOfficialityDraftState {
  return {
    search: '',
    status: '',
    rowIds: new Set(),
    ...overrides,
  }
}

function row(id: number, overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    projectTitle: 'P',
    subtitleCode: 'S',
    line: 'LIN',
    joint: `S${id}`,
    ...overrides,
  } as WeldRow
}
