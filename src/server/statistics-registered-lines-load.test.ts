import { expect, it, vi } from 'vitest'
import { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { appSettings, linePrograms, lineSchemeBundles, lineSchemeMembers, weldJointProgramStates, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ProgramChainState } from '@/lib/line-program-chain-state'
import { summarizeLineCoverage } from '@/lib/line-summary'
import { computeStatisticsServerResult } from './statistics'

const database = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: database.transaction }) }))

function registeredFixture(lineCount: number, withPdf: boolean) {
  const rows: WeldRow[] = [], states: ProgramChainState[] = []
  const lines: { line_id: number; bundle_id: number | null; revisionId: number | null;
    projectTitle: string; subtitleCode: string; line: string }[] = []
  const members: { weldJointId: number; physicalId: number }[] = []
  const points: { bundleId: number; revisionId: number; physicalId: number }[] = []
  for (let lineId = 1; lineId <= lineCount; lineId++) {
    const base = (lineId - 1) * 6
    lines.push({ line_id: lineId, bundle_id: withPdf ? lineId : null, revisionId: withPdf ? lineId + 10_000 : null,
      projectTitle: 'P', subtitleCode: 'S', line: `L${lineId}` })
    // One source/repair replaced by two coil sides; one side has a pending
    // repair renamed to S900. Only persisted IDs retain that relationship.
    // The independent welded support is a third physical connection.
    const names = ['S1', 'S1R1', 'S1Y1', 'S1Y2', 'S900', 'ОП1']
    const roots = [1, 1, 3, 4, 3, 6], sources = [null, 1, 1, 1, 3, null]
    for (let index = 0; index < names.length; index++) {
      const id = base + index + 1, physicalRootId = base + roots[index]
      const state: ProgramChainState = { weldJointId: id, kind: index === 1 || index === 4 ? 'repair'
        : index === 2 || index === 3 ? 'coil' : 'primary', physicalRootId,
        sourceRowId: sources[index] === null ? null : base + sources[index]!,
        coilParentId: index === 2 || index === 3 ? base + 1 : null,
        coilSide: index === 2 ? 1 : index === 3 ? 2 : null,
        replacedByCoil: index === 0, replacementCoilIds: index === 0 ? [base + 3, base + 4] : [] }
      rows.push({ id, projectTitle: 'P', subtitleCode: 'S', line: `L${lineId}`, lineProgramId: lineId,
        joint: names[index], weldDate: index === 4 ? null : '2026-09-01', connectionType: index === 5 ? 'Т1' : 'С17',
        category: index === 5 ? 'II' : 'I',
        officiality: 'действующий', revisionActuality: 'актуальная', hasVik: 'да', hasRk: null, hasUzk: null, hasPvk: null,
        vikResult: index === 4 ? null : index < 3 ? 'ремонт' : 'годен', rkResult: null, uzkResult: null, pvkResult: null })
      states.push(state)
      members.push({ weldJointId: id, physicalId: physicalRootId })
    }
    if (withPdf) points.push(
      { bundleId: lineId, revisionId: lineId + 10_000, physicalId: base + 1 }, // Grey replaced source.
      { bundleId: lineId, revisionId: lineId + 10_000, physicalId: base + 3 },
      { bundleId: lineId, revisionId: lineId + 10_000, physicalId: base + 6 },
      { bundleId: lineId, revisionId: lineId + 20_000, physicalId: base + 4 }, // Archived PDF.
    )
  }
  return { rows, states, lines, members, points }
}

function mockSnapshot(fixture: ReturnType<typeof registeredFixture>) {
  const reads: unknown[] = [], stateById = new Map(fixture.states.map(state => [state.weldJointId, state]))
  const dialect = new PgDialect()
  const makeSelect = (fields?: Record<string, unknown>, distinct = false) => {
    let table: unknown
    let activePairs: { bundleId: number; physicalId: number }[] = []
    const result = () => {
      if (table === weldJoints) {
        if (distinct) return [{ value: fields?.value === weldJoints.projectTitle ? 'P' : 'S' }]
        if (fields && 'row' in fields) return fixture.rows.map(row => ({ row: { ...row }, state: stateById.get(row.id) }))
        // Honor the actual narrow source projection: it has neither results
        // nor lineProgramId. It cannot replace the complete scheme topology.
        return fixture.rows.map(row => Object.fromEntries(Object.keys(fields ?? {}).map(key => [key, row[key as keyof WeldRow]])))
      }
      if (table === appSettings) return []
      if (table === weldJointProgramStates) return fixture.states
      if (table === linePrograms) return fixture.lines
      if (table === lineSchemeMembers) return fixture.members
      if (table === lineSchemeBundles) {
        const eligible = new Set(activePairs.map(pair => `${pair.bundleId}:${pair.physicalId}`))
        return fixture.lines.filter(line => line.bundle_id !== null).map(line => {
          const current = fixture.points.filter(point => point.bundleId === line.bundle_id && point.revisionId === line.revisionId)
          return { bundleId: line.bundle_id, count: current.length,
            activeCount: current.filter(point => eligible.has(`${point.bundleId}:${point.physicalId}`)).length }
        })
      }
      throw new Error('Unexpected statistics read: the snapshot mock must explicitly model its data.')
    }
    const query: any = {
      from: (value: unknown) => { table = value; return query },
      where: () => query, orderBy: () => query, innerJoin: () => query, groupBy: () => query,
      leftJoin: (value: unknown) => {
        if (value instanceof SQL) {
          // Model the database aggregate from the actual eligible pairs emitted
          // by the topology reader, not from a canned "two points" response.
          const compiled = dialect.sqlToQuery(value)
          if (compiled.sql.includes('unnest')) {
            const [bundles, physicals] = compiled.params as [number[], number[]]
            activePairs = bundles.map((bundleId, index) => ({ bundleId, physicalId: physicals[index] }))
          }
        }
        return query
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        reads.push(table)
        if (reads.length > 11) return Promise.reject(new Error('Statistics must batch registered lines, not read each line/chain.')).then(resolve, reject)
        return Promise.resolve(result()).then(resolve, reject)
      },
    }
    return query
  }
  return { reads, executor: { select: (fields?: Record<string, unknown>) => makeSelect(fields),
    selectDistinct: (fields?: Record<string, unknown>) => makeSelect(fields, true) } }
}

it.each([false, true])('registered-line statistics keep physical/scheme facts in bounded snapshot reads (PDF=%s)', async withPdf => {
  const counts: number[] = []
  for (const lineCount of [1, 1000]) {
    const fixture = registeredFixture(lineCount, withPdf), snapshot = mockSnapshot(fixture)
    database.transaction.mockClear()
    database.transaction.mockImplementation(run => run(snapshot.executor))
    const result = await computeStatisticsServerResult({ tab: 'lineSummary', unit: 'joints', projectFilter: 'p' })

    expect(result.lineSummary).toMatchObject({ total: lineCount * 3, completed: lineCount * 2, remaining: lineCount })
    expect(result.lineSummary.rows).toHaveLength(lineCount * 2)
    for (const row of result.lineSummary.rows) {
      const lineId = Number(row.line.slice(1)), base = (lineId - 1) * 6
      expect(row.scheme).toEqual({ hasPdf: withPdf, total: 3, placed: withPdf ? 2 : 0 })
      expect(row.rowIds.slice().sort((a, b) => a - b)).toEqual(row.category === 'II' ? [base + 6] : [base + 4, base + 5])
      expect(row.remainingRowIds).toEqual(row.category === 'II' ? [] : [base + 5])
    }
    const coverage = summarizeLineCoverage(result.lineSummary.rows)
    expect(coverage).toMatchObject({ total: lineCount * 3, placed: withPdf ? lineCount * 2 : 0 })
    // The real UI filters summary rows by category. Its one visible support
    // does not shrink that line's scheme denominator from three joints to one.
    const supportCategory = result.lineSummary.rows.filter(row => row.category === 'II')
    expect(supportCategory.reduce((total, row) => total + row.total, 0)).toBe(lineCount)
    expect(summarizeLineCoverage(supportCategory)).toMatchObject({ lines: lineCount,
      total: lineCount * 3, placed: withPdf ? lineCount * 2 : 0 })
    expect(database.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: 'repeatable read', accessMode: 'read only',
    })
    // Registered lines must actually traverse the scheme topology; otherwise a
    // fast short-circuit could satisfy a query ceiling while omitting coverage.
    expect(snapshot.reads).toContain(linePrograms)
    expect(snapshot.reads).toContain(lineSchemeMembers)
    expect(snapshot.reads.filter(table => table === lineSchemeBundles)).toHaveLength(withPdf ? 1 : 0)
    expect(snapshot.reads.length).toBeLessThanOrEqual(withPdf ? 11 : 10)
    counts.push(snapshot.reads.length)
  }
  expect(counts[1]).toBe(counts[0])
})
