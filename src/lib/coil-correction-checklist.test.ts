import { describe, expect, it } from 'vitest'
import { buildCoilCorrectionChecklist } from './coil-correction-checklist'
import type { ProgramChainState } from './line-program-chain-state'
import type { WeldRow } from './dispatcher-types'

const states: ProgramChainState[] = [
  { weldJointId: 1, kind: 'primary', physicalRootId: 1, sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: true, replacementCoilIds: [3, 4] },
  { weldJointId: 2, kind: 'repair', physicalRootId: 1, sourceRowId: 1, coilParentId: null, coilSide: null, replacedByCoil: false, replacementCoilIds: [] },
  ...[3, 4].map((id, index) => ({ weldJointId: id, kind: 'coil' as const, physicalRootId: id, sourceRowId: 2, coilParentId: 1,
    coilSide: (index + 1) as 1 | 2, replacedByCoil: false, replacementCoilIds: [] })),
  { weldJointId: 5, kind: 'repair', physicalRootId: 3, sourceRowId: 3, coilParentId: null, coilSide: null, replacedByCoil: false, replacementCoilIds: [] },
]
const rows: WeldRow[] = [ { id: 1, joint: 'S1' }, { id: 2, joint: 'S1R1' }, { id: 3, joint: 'S1Y1' }, { id: 4, joint: 'S1Y2' }, { id: 5, joint: 'S1Y1R1' } ]
describe('read-only coil correction checklist', () => {
  it('keeps original repairs and coil descendants in separate steps by stored links', () => {
    const data = buildCoilCorrectionChecklist(1, rows, states, new Set(), [2])
    expect(data.sourceRows.map(row => row.id)).toEqual([1, 2])
    expect(data.replacementRows.map(row => row.id)).toEqual([3, 4, 5])
    expect(data.earlySources.map(row => row.id)).toEqual([2])
    expect(data.historyRows).toEqual([])
    expect(data.replacedByCoil).toBe(true)
  })
  it('does not treat assignments or waiting as facts; a weld date is shown separately', () => {
    const data = buildCoilCorrectionChecklist(1, rows.map(row => ({ ...row, hasVik: 'да', vikResult: 'ожидает заявку', weldDate: '2026-09-01' })), states, new Set(), [])
    expect(data.historyRows).toEqual([])
    expect(data.weldedRows.map(row => row.id)).toEqual([3, 4, 5])
  })
  it('retains moved unofficial descendants and orphan documents even after deletion of the sides', () => {
    const data = buildCoilCorrectionChecklist(1, [rows[0], rows[1], { ...rows[4], joint: 'F999', line: 'OTHER', officiality: 'неофициальный' }], states, new Set([5]), [])
    expect(data.historyRows.map(row => row.id)).toEqual([5])
    expect(data.replacementRows[0]).toMatchObject({ joint: 'F999', line: 'OTHER' })
  })
  it('keeps recorded replacement after every live side is removed and never changes inputs', () => {
    const before = JSON.stringify(states)
    const data = buildCoilCorrectionChecklist(1, rows.slice(0, 2), states, new Set(), [])
    expect(data.replacementRows).toEqual([])
    expect(data.replacedByCoil).toBe(true)
    expect(JSON.stringify(states)).toBe(before)
  })
})
