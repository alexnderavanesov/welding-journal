import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { createProgramAssignmentRowsSelector, getProgramAssignmentRefresh } from './line-program-assignment-refresh'

const first: WeldRow = { id: 1, joint: 'F1', connectionType: 'У19', hasVik: 'да', hasRk: 'да' }
const second: WeldRow = { id: 2, joint: 'F2', connectionType: 'С17', hasVik: 'да' }
const rows = [first, second]

describe('assignment draft refresh scope', () => {
  it('reuses calculation rows during basis typing but observes assignments, cancellation and fresh server rows', () => {
    const select = createProgramAssignmentRowsSelector()
    expect(select(rows, new Map())).toBe(rows)
    const changed = { ...first, hasRk: 'дополнительный', rkControlBasis: 'Т' }
    const calculationRows = select(rows, new Map([[first.id, changed]]))
    const typing = new Map([[first.id, { ...changed, rkControlBasis: 'ТР № 10' }]])
    expect(select(rows, typing)).toBe(calculationRows)
    expect(getProgramAssignmentRefresh(rows, new Map([[first.id, changed]]), typing)).toEqual({ rowIds: [], methods: [] })
    expect(select(rows, new Map())).toBe(rows)
    const fresh = [{ ...first, rkResult: 'ремонт' }, second]
    expect(select(fresh, new Map())).toBe(fresh)
  })
  it('does not refresh rebuilt drafts with unchanged assignments or unrelated facts', () => {
    const before = new Map([[first.id, { ...first, hasRk: 'дополнительный' }]])
    const after = new Map([[first.id, { ...first, hasRk: 'дополнительный', notes: 'changed' }]])
    expect(getProgramAssignmentRefresh(rows, before, after)).toEqual({ rowIds: [], methods: [] })
  })

  it('includes every changed method and only rows in this table', () => {
    const after = new Map([
      [first.id, { ...first, hasRk: 'отменен', hasUzk: 'да' }],
      [second.id, { ...second, hasPvk: 'да' }],
      [99, { ...first, id: 99, hasRk: '' }],
    ])
    expect(getProgramAssignmentRefresh(rows, new Map(), after)).toEqual({ rowIds: [1, 2], methods: ['РК', 'УЗК', 'ПВК'] })
  })

  it('refreshes both PVK and layered PVK when layered assignment implies PVK', () => {
    const after = new Map([[first.id, { ...first, layeredControlAssigned: true, hasPvk: 'да' }]])
    expect(getProgramAssignmentRefresh(rows, new Map(), after)).toEqual({ rowIds: [1], methods: ['ПВК', 'Послойный ПВК'] })
  })

  it('restores effective saved assignments when the entire draft or one row is cancelled', () => {
    const before = new Map([[first.id, { ...first, hasRk: 'отменен' }], [second.id, { ...second, hasUzk: 'да' }]])
    expect(getProgramAssignmentRefresh(rows, before, new Map())).toEqual({ rowIds: [1, 2], methods: ['РК', 'УЗК'] })
    expect(getProgramAssignmentRefresh(rows, before, new Map([[second.id, { ...second, hasUzk: 'да' }]]))).toEqual({ rowIds: [1], methods: ['РК'] })
  })
})
