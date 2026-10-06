import { expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { getProgramRemovalHints } from './line-program-excess'
import { programApprovalKey } from './program-control-approval'

it('independent small-state oracle: the whole suggested removal set preserves every welder quota and all protected work', () => {
  const variants: Partial<WeldRow>[] = [
    {}, { hasRk: 'да' }, { hasRk: 'дополнительный' }, { hasRk: 'да', hasUzk: 'да' },
    { hasRk: 'да', rkRequest: 'RK-STARTED' }, { hasRk: 'отменен', hasUzk: 'отменен' },
    { hasRk: 'отменен', rkResult: 'годен', rkConclusion: 'RK-DONE' },
  ]
  const fields = { РК: 'hasRk', УЗК: 'hasUzk', ПВК: 'hasPvk' } as const
  let examined = 0
  for (const memberships of [['A', 'B', 'AB'], ['AB', 'AB', 'A'], ['A', 'A', 'A']]) {
    for (const percent of [0, 10, 50, 100]) for (const a of variants) for (const b of variants) for (const c of variants) {
      const rows: WeldRow[] = [a, b, c].map((value, index) => ({
        id: index + 1, joint: `F${index + 1}`, line: 'L', connectionType: 'С17', weldDate: '2026-09-01',
        stamp1K: memberships[index][0], stamp1Z: memberships[index][1] ?? null, ...value,
      }))
      const approved = new Set(rows[1].hasRk === 'да' && rows[1].hasUzk === 'да' ? [programApprovalKey(rows[1], 'common', true)] : [])
      const hints = getProgramRemovalHints(1, rows, calculateLineProgram(rows, percent, percent === 100 ? 1 : 0, undefined, approved), approved)
      // Oracle is intentionally not the program's coverage/rounding functions.
      const credit = (row: WeldRow) => row.rkResult === 'годен' ||
        [row.hasRk, row.hasUzk].some(value => value === 'да' || value === 'дополнительный') ||
        row.hasRk === 'отменен' && row.hasUzk === 'отменен'
      const after = rows.map(row => {
        const next = { ...row }
        for (const method of hints.get(row.id)?.keys() ?? []) {
          expect(method).not.toBe('Послойный ПВК')
          const field = fields[method as keyof typeof fields]
          expect(row[field]).toBe('да')
          if (method === 'РК') expect(!!row.rkRequest || !!row.rkConclusion).toBe(false)
          expect(approved.has(programApprovalKey(row, 'common', true))).toBe(false)
          next[field] = null
        }
        return next
      })
      const scopes = percent === 100 ? [rows.map(row => row.id)] : [...new Set(memberships.join(''))]
        .map(stamp => rows.filter((_, index) => memberships[index].includes(stamp)).map(row => row.id))
      for (const scope of scopes) {
        const quota = percent === 0 ? 0 : percent === 100 ? scope.length : percent === 10 ? 1 : [0, 1, 1, 2][scope.length]
        const beforeCredit = rows.filter(row => scope.includes(row.id) && credit(row)).length
        const afterCredit = after.filter(row => scope.includes(row.id) && credit(row)).length
        expect(afterCredit, JSON.stringify({ memberships, percent, rows })).toBeGreaterThanOrEqual(Math.min(quota, beforeCredit))
      }
      examined++
    }
  }
  expect(examined).toBe(4116)
}, 30_000)
