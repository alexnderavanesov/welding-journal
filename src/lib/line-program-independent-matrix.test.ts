import { expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'

// Expected contributions are stated from the agreed rules, not obtained from
// production eligibility/coverage helpers. In particular a performed rejected
// RK counts, rejected VIK/PVK does not create a surcharge, and a good duplicate
// is not our own control. All fixtures are welded primary C connections.
const cases: { fields: Partial<WeldRow>; common: number; pvk: number; candidate: number; pvkCandidate: number; source: number }[] = [
  { fields: {}, common: 0, pvk: 0, candidate: 1, pvkCandidate: 1, source: 0 },
  { fields: { hasRk: 'да', hasPvk: 'да' }, common: 1, pvk: 1, candidate: 0, pvkCandidate: 0, source: 0 },
  { fields: { hasUzk: 'дополнительный', hasPvk: 'дополнительный' }, common: 1, pvk: 1, candidate: 0, pvkCandidate: 0, source: 0 },
  { fields: { hasRk: 'отменен', hasUzk: 'отменен', hasPvk: 'отменен' }, common: 1, pvk: 0, candidate: 0, pvkCandidate: 0, source: 0 },
  { fields: { hasRk: 'да', rkResult: 'ремонт', hasPvk: 'да', pvkResult: 'годен' }, common: 1, pvk: 0, candidate: 0, pvkCandidate: 0, source: 1 },
  { fields: { hasRk: 'да', vikResult: 'ремонт', hasPvk: 'да' }, common: 0, pvk: 0, candidate: 0, pvkCandidate: 0, source: 0 },
  { fields: { hasRk: 'да', pvkResult: 'ремонт', hasPvk: 'да' }, common: 0, pvk: 0, candidate: 0, pvkCandidate: 0, source: 0 },
  { fields: { hasRk: 'отменен', rkResult: 'годен', hasPvk: 'отменен', pvkResult: 'годен' }, common: 1, pvk: 1, candidate: 0, pvkCandidate: 0, source: 0 },
  { fields: { duplicateControls: [{ id: 91, weldJointId: 1, method: 'УЗК', result: 'ремонт' }] as WeldRow['duplicateControls'] }, common: 0, pvk: 0, candidate: 0, pvkCandidate: 0, source: 1 },
  { fields: { duplicateControls: [{ id: 92, weldJointId: 1, method: 'УЗК', result: 'годен' }] as WeldRow['duplicateControls'] }, common: 0, pvk: 0, candidate: 1, pvkCandidate: 1, source: 0 },
]

it('independent three-welder matrix: facts, cancellations, exclusions and candidate caps agree in 4800 combinations', () => {
  const memberships = [['ABC', 'A', 'BC'], ['AAB', 'BCC', 'ABC'], ['AAA', 'BBB', 'CCC']]
  const exclusions = [{}, { officiality: 'неофициальный' }, { revisionActuality: 'не актуален' },
    { officiality: 'неофициальный', revisionActuality: 'не актуален' }]
  let checked = 0
  for (const owners of memberships) for (const percent of [0, 1, 10, 50]) for (const flags of exclusions) {
    for (const first of cases) for (const second of cases) {
      const contributions = [first, second, cases[1]]
      const rows: WeldRow[] = contributions.map((entry, index) => ({
        id: index + 1, joint: `F${index + 1}`, line: 'MATRIX', connectionType: 'С17',
        weldDate: '2026-09-01', officiality: 'действующий', revisionActuality: 'актуальная', hasVik: 'да',
        stamp1K: owners[index][0], stamp1Z: owners[index][1], stamp1O: owners[index][2],
        ...entry.fields, ...(index === 0 ? flags : {}),
        duplicateControls: entry.fields.duplicateControls?.map(control => ({ ...control, weldJointId: index + 1 })),
      }))
      const actual = calculateLineProgram(rows, percent, percent)
      const expected = ['A', 'B', 'C'].flatMap(stamp => {
        const indexes = contributions.map((_, index) => index).filter(index =>
          (index !== 0 || Object.keys(flags).length === 0) && owners[index].includes(stamp))
        if (!indexes.length) return []
        // These percentages/counts have exact, tiny arithmetic; do not use the
        // application's decimal-rounding routine as the expected-value source.
        const base = percent === 0 ? 0 : Math.max(1, Math.floor(indexes.length * percent / 100 + 0.5))
        const count = (key: 'common' | 'pvk' | 'candidate' | 'pvkCandidate' | 'source') =>
          indexes.reduce((sum, index) => sum + contributions[index][key], 0)
        const credit = count('common'), pvkCredit = count('pvk')
        const extra = percent === 0 ? 0 : count('source') * (percent === 1 ? 1 : 2)
        return [{ stamp, quantity: indexes.length, base, extra, credit, pvkCredit,
          missing: Math.min(Math.max(0, base + extra - credit), count('candidate')),
          pvkMissing: Math.min(Math.max(0, base - pvkCredit), count('pvkCandidate')) }]
      })
      const project = (groups: ReturnType<typeof calculateLineProgram>) => groups.map(group => ({
        stamp: group.stamp, quantity: group.rowIds.length, base: group.common.baseRequired,
        extra: group.common.additionalRequired, credit: group.common.coveredRowIds.length,
        pvkCredit: group.pvk.coveredRowIds.length, missing: group.common.missing, pvkMissing: group.pvk.missing,
      }))
      expect(project(actual), JSON.stringify({ owners, percent, flags, contributions })).toEqual(expected)
      // Input order and duplicate delivery of the same ID are not new facts.
      expect(project(calculateLineProgram([rows[2], rows[0], rows[1], rows[0]], percent, percent))).toEqual(expected)
      checked++
    }
  }
  expect(checked).toBe(4800)
}, 30_000)
