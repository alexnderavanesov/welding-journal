import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { canSelectLnkResultRow, filterLnkResultRows } from '@/lib/lnk-result-modal-rows'
import { getSelectableVisibleLnkResultRows } from '@/lib/lnk-result-derived-utils'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { useLnkResultActions } from '@/lib/use-lnk-result-actions'

describe('filterLnkResultRows', () => {
  it('keeps result rows in workflow priority order', () => {
    const rows = [
      createRow(1, 'L-4', { vikResult: 'годен' }),
      createRow(2, 'L-3', { vikResult: 'ремонт', finalStatus: 'не годен' }),
      createRow(3, 'L-2', { vikResult: 'годен', finalStatus: 'годен' }),
      createRow(4, 'L-1', { vikRequest: 'Заявка-1' }),
    ]

    expect(filterLnkResultRows(rows, '', 'vikRequest').map((row) => row.id)).toEqual([4, 3, 2, 1])
  })

  it('filters nonmatching rows before calculating their result priority', () => {
    const nonmatchingRow = createRow(1, 'OTHER')
    Object.defineProperty(nonmatchingRow, 'vikResult', {
      get: () => {
        throw new Error('priority should not be calculated for a filtered row')
      },
    })
    const matchingRow = createRow(2, 'TARGET', { vikRequest: 'Заявка-2' })

    expect(filterLnkResultRows([nonmatchingRow, matchingRow], 'target', 'vikRequest')).toEqual([matchingRow])
  })

  it('keeps a staged row searchable while bulk selection stays strict', () => {
    const staged = createRow(3, 'TARGET', {
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Заявка-3',
      vikRequestDate: '2026-08-10',
      vikResult: 'ожидает НК',
    })

    expect(filterLnkResultRows([staged], 'target', 'vikRequest')).toEqual([staged])
    expect(canSelectLnkResultRow(staged, 'Заявка-3', 'vikRequest', '2026-08-10')).toBe(false)
    expect(canSelectLnkResultRow(staged, 'Заявка-3', 'vikRequest', '2026-08-10', {
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: true,
    })).toBe(true)
    expect(getSelectableVisibleLnkResultRows(
      [staged],
      'Заявка-3',
      'vikRequest',
      '2026-08-10',
    )).toEqual([])
  })

  it('allows a staged row through a manual context-menu selection in permissive mode', () => {
    const staged = createRow(3, 'TARGET', {
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Заявка-3',
      vikRequestDate: '2026-08-10',
      vikResult: 'ожидает НК',
    })
    let draft: LnkResultDraftState = {
      ...createDefaultLnkResultDraft(),
      requestName: 'Заявка-3',
      requestDate: '2026-08-10',
      methodKey: 'vikRequest',
    }
    const setDraft = (update: LnkResultDraftState | ((current: LnkResultDraftState) => LnkResultDraftState)) => {
      draft = typeof update === 'function' ? update(draft) : update
    }
    const actions = useLnkResultActions({
      controlProcessSettings: {
        layeredControlEnabled: true,
        preHeatTreatmentLnkEnabled: true,
        allowPrimaryLnkBeforePreviousStagesComplete: true,
      },
      filteredRows: [staged],
      lnkRows: [staged],
      draft,
      mutation: { isPending: false },
      defaultConclusionNaming: draft.conclusionNaming,
      setDraft,
      setIsModalOpen: () => undefined,
      setMessage: () => undefined,
      setPreservedOrderIds: () => undefined,
    })

    actions.toggleAllLnkResultRows()
    expect(draft.rowIds).toEqual(new Set())

    actions.setLnkResultRows([staged.id])
    expect(draft.rowIds).toEqual(new Set([staged.id]))
  })
})

function createRow(id: number, line: string, overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    line,
    joint: `F${id}`,
    finalStatus: '',
    vikRequest: '',
    vikResult: '',
    ...overrides,
  } as WeldRow
}
