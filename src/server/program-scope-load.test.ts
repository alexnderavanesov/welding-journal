import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { loadProgramRuleContext } from './line-program-rule-context'
import { loadProgramChainScopeRows } from './line-program-chain-state'

describe('large affected-line batches', () => {
  // The 500-line SQL limit is not a row limit: one batch may hold the entire
  // normal 200k journal. Do not spread that result into function arguments.
  for (const kind of ['rules', 'chains'] as const) it.each([[24, 1], [200_000, 1], [200_000, 500]])(
    `${kind}: keeps all %i rows across %i lines with a bounded number of reads`,
    async (count, lineCount) => {
      const rows: WeldRow[] = Array.from({ length: count }, (_, index) => ({
        id: index + 1, projectTitle: 'P', subtitleCode: 'S',
        line: `L${index % lineCount}`, joint: `S${index + 1}`,
      }))
      const scope = rows.slice(0, lineCount)
      const database = (results: unknown[][]) => {
        const select = vi.fn(() => {
          const result = results.shift()
          const query = { from: () => query, where: () => Object.assign(
            Promise.resolve(result), { orderBy: () => Promise.resolve(result) },
          ) }
          return query
        })
        return { select }
      }
      const db = database(kind === 'rules' ? [rows, [], [], [], []] : [rows, []])
      const loaded = kind === 'rules'
        ? (await loadProgramRuleContext(db as never, scope, false)).rows
        : await loadProgramChainScopeRows(db as never, scope)
      expect(db.select).toHaveBeenCalledTimes(kind === 'rules' ? 5 : 2)
      expect(loaded).toHaveLength(count)
      expect(loaded[0].id).toBe(1)
      expect(loaded.at(-1)?.id).toBe(count)
      if (kind === 'rules') expect(loaded.every(row => row.preHeatTreatmentLnkEnabled === false)).toBe(true)
    },
  )
})
