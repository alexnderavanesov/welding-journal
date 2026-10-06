import { expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { packProgramRows, unpackProgramRows } from './line-program-row-payload'
import { attachProgramRepairRequirements } from './line-program-repair-requirements'

it('preserves replacement generation IDs and distinguishes absent legacy metadata', () => {
  const base = { weldJointId: 1, kind: 'primary' as const, physicalRootId: 1, sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: true }
  const rows = [undefined, [], [2, 3]].map((ids, i) => ({ id: i + 1, programChainState: { ...base, weldJointId: i + 1, ...(ids === undefined ? {} : { replacementCoilIds: ids }) } }))
  expect(unpackProgramRows(packProgramRows(rows)).rows).toStrictEqual(rows)
})

it('compacts stable chain metadata losslessly without repeating seven field names per joint', () => {
  const rows = attachProgramRepairRequirements(Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, joint: `F${i + 1}` })), new Set())
  const packed = packProgramRows(rows)
  expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(rows).length / 2)
  expect(unpackProgramRows(packed).rows).toStrictEqual(rows)
})

it('round-trips explicit nulls, absent properties, zero, false and document/history data without changing rows', () => {
  const rows: WeldRow[] = [
    { id: 1, joint: 'F1', hasPvk: null, d1: 0, rkResult: null, rkConclusion: null, preHeatTreatmentLnkEnabled: false, systemDocumentIds: { rkConclusion: 19 }, rowVersion: 'v1' },
    { id: 2, joint: 'F2', hasPvk: null, d1: null, rkResult: '', preHeatTreatmentLnkEnabled: true, rowVersion: 'v2' },
  ]
  const original = structuredClone(rows), packed = packProgramRows(rows)
  expect(packed.nullFields).toEqual(['hasPvk'])
  expect(packed.rows[0]).not.toHaveProperty('hasPvk')
  expect(unpackProgramRows(packed).rows).toStrictEqual(rows)
  expect(rows).toStrictEqual(original)
})
it('shares repeated empty columns without truncating a large line or its history', () => {
  const rows: WeldRow[] = Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, rkRequest: null, rkConclusion: null, uzkRequest: null, uzkConclusion: null, pvkRequest: null, pvkConclusion: null }))
  const packed = packProgramRows(rows)
  expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(rows).length / 4)
  expect(unpackProgramRows(packed).rows).toStrictEqual(rows)
  expect(unpackProgramRows({ rows: [] }).rows).toEqual([])
})
