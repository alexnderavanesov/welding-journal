import { expect, it, vi } from 'vitest'
import { appSettings, linePrograms, lineSchemeBundles, lineSchemeMembers, weldJointProgramStates, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { readLineSummarySchemes } from './line-summary-schemes'

it.each([1000, 200000])('loads scheme coverage for %i joints across 1000 lines in six batched reads', async count => {
  const rows: WeldRow[] = Array.from({ length: count }, (_, index) => ({
    id: index + 1, projectTitle: 'P', subtitleCode: 'S', line: `L${index % 1000}`, lineProgramId: index % 1000 + 1,
    joint: `F${index + 1}`, programChainState: { weldJointId: index + 1, kind: 'primary', physicalRootId: index + 1,
      sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: false },
  }))
  const lines = rows.slice(0, 1000).map(row => ({ projectTitle: row.projectTitle, subtitleCode: row.subtitleCode, line: row.line,
    line_id: row.lineProgramId!, bundle_id: row.lineProgramId!, revisionId: `pdf-${row.lineProgramId}` }))
  const tables: unknown[] = []
  const select = vi.fn(() => {
    let table: unknown
    const result = () => table === linePrograms ? lines : table === appSettings ? []
      : table === weldJoints ? rows.map(row => ({ row, state: row.programChainState }))
      : table === weldJointProgramStates ? rows.map(row => row.programChainState)
      : table === lineSchemeMembers ? rows.map(row => ({ weldJointId: row.id, physicalId: row.id }))
      : table === lineSchemeBundles ? lines.map(line => ({ bundleId: line.bundle_id, count: count / 1000, activeCount: count / 1000 })) : []
    const query: any = { from: (value: unknown) => { tables.push(value); table = value; return query },
      where: () => query, orderBy: () => query, innerJoin: () => query, leftJoin: () => query, groupBy: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject) }
    return query
  })
  const execute = vi.fn()
  const coverage = await readLineSummarySchemes({ select, execute } as never, rows)
  expect(tables).toEqual([linePrograms, appSettings, weldJoints, weldJointProgramStates, lineSchemeMembers, lineSchemeBundles])
  expect(coverage.size).toBe(1000)
  expect([...coverage.values()].reduce((sum, row) => sum + row.total, 0)).toBe(count)
  expect([...coverage.values()].reduce((sum, row) => sum + row.placed, 0)).toBe(count)
  expect([...coverage.values()].every(row => row.hasPdf)).toBe(true)
  expect(execute).not.toHaveBeenCalled()
}, 20_000)
