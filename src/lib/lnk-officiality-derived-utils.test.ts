import { describe, expect, it } from 'vitest'
import {
  getFilteredLnkOfficialityRows,
  getLnkOfficialityCounters,
  getLnkOfficialitySaveBlockReason,
  getSelectedLnkOfficialityRows,
} from './lnk-officiality-derived-utils'
import type { LnkOfficialityDraftState } from './report-draft-state'
import type { WeldRow } from './dispatcher-types'

describe('lnk officiality derived rows', () => {
  it('keeps a legacy unofficial waiting row available for restoring officiality', () => {
    const rows = [row(1, { officiality: 'неофициальный', finalStatus: 'ожидает НК', rkResult: null })]
    const draft = draftState({ rowIds: new Set([1]), officiality: 'official' })
    expect(getFilteredLnkOfficialityRows(rows, draft)).toEqual(rows)
    expect(getSelectedLnkOfficialityRows(rows, draft)).toEqual(rows)
    expect(getLnkOfficialitySaveBlockReason({ isLnkOfficialitySaving: false, lnkOfficialityDraft: draft, selectedLnkOfficialityRows: rows })).toBe('')
  })
  it.each(['годен', 'ремонт', 'вырез', 'ожидает НК', ''])('blocks a mixed selection with any existing duplicate (%s), but allows restoring officiality', result => {
    const rows = [row(1, { rkResult: 'ремонт' }), row(2, { rkResult: 'ремонт', duplicateControls: [{ id: 5, method: 'ВИК', result }] as WeldRow['duplicateControls'] })]
    const options = { isLnkOfficialitySaving: false, lnkOfficialityDraft: draftState({ officiality: 'unofficial' }), selectedLnkOfficialityRows: rows }
    expect(getLnkOfficialitySaveBlockReason(options)).toContain('есть дубль-контроль')
    expect(getLnkOfficialitySaveBlockReason({ ...options, lnkOfficialityDraft: draftState({ officiality: 'official' }) })).toBe('')
  })
  it('shows rejected official rows first, then unofficial rows, and hides waiting NDT rows', () => {
    const rows = [
      row(1, { joint: 'S3', finalStatus: 'ожидает НК', rkRequest: 'R-1', rkResult: 'ожидает НК' }),
      row(2, { joint: 'S2', officiality: 'неофициальный', rkResult: 'ремонт' }),
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
    officiality: '',
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
