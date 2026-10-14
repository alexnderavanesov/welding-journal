import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { loadBoundedDispatcherDirtyScopes, loadWelderStampDispatcherScopes, parseDispatcherDirtyScopes } from './dispatcher-dirty-scope-selection'
import { FULL_REBUILD_GENERATION_KIND } from './dispatcher-refresh-catchup'
import { prepareReportRows } from '@/lib/use-report-rows'
import { getFinalStatusPersistenceChanges } from './final-status-persistence'
import { getDispatcherScopeKey } from './dispatcher-weld-rows'

const scope = { projectTitle: 'P', subtitleCode: 'S', line: 'L 1' }
const dialect = new PgDialect()
function contextDb(rows: Array<typeof scope & { joints: number }>) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn((_condition: SQL) => ({ groupBy: () => ({ limit }) }))
  const select = vi.fn(() => ({ from: () => ({ where }) }))
  return { db: { select } as unknown as Parameters<typeof loadBoundedDispatcherDirtyScopes>[0], select, where, limit }
}

describe('bounded complete dispatcher contexts', () => {
  it('preserves waiting-repair for an official namesake whose rejected source is in a whitespace-equivalent scope', async () => {
    const source = { ...scope, id: 1, joint: 'F1', officiality: 'неофициальный', weldDate: '2026-07-01',
      hasVik: 'да', vikResult: 'ремонт' }
    const target = { ...scope, line: 'L1', id: 2, joint: 'F1', officiality: 'действующий', weldDate: '',
      finalStatus: 'ожидает ремонт' }
    const factsBefore = JSON.stringify([source, target])
    // This is the previous ordinary scoped selection, not a new business rule:
    // it loses the source and would overwrite the correct persisted status.
    const incomplete = prepareReportRows([target])
    expect(incomplete[0].finalStatus).toBe('ожидает сварку')
    expect(getFinalStatusPersistenceChanges([target], incomplete)).toEqual([
      { id: 2, previousFinalStatus: 'ожидает ремонт', finalStatus: 'ожидает сварку' },
    ])
    const db = contextDb([{ ...scope, joints: 1 }, { ...scope, line: 'L1', joints: 1 }])
    const expanded = await loadBoundedDispatcherDirtyScopes(db.db, [{ ...scope, line: 'L1' }])
    expect(expanded).not.toBeNull()
    const keys = new Set(expanded!.map(getDispatcherScopeKey))
    const rows = [source, target].filter(row => keys.has(getDispatcherScopeKey(row)))
    expect(rows).toHaveLength(2)
    const prepared = prepareReportRows(rows)
    expect(prepared.find(row => row.id === target.id)?.finalStatus).toBe('ожидает ремонт')
    expect(getFinalStatusPersistenceChanges([target], prepared)).toEqual([])
    expect(JSON.stringify([source, target])).toBe(factsBefore)
  })

  it('expands whitespace-equivalent siblings and retains a deleted scope for removing its old task pages', async () => {
    const sibling = { ...scope, line: 'L1' }, deleted = { ...scope, line: 'Gone' }
    const { db, where } = contextDb([{ ...scope, joints: 1 }, { ...sibling, joints: 3 }])
    expect(await loadBoundedDispatcherDirtyScopes(db, [scope, deleted])).toEqual([scope, deleted, sibling])
    const query = dialect.sqlToQuery(where.mock.calls[0][0])
    expect(query.sql).toContain('translate(')
    expect(query.params).toContain('l1')
    expect(query.params.some(value => typeof value === 'string' && value.includes('\u00a0'))).toBe(true)
  })

  it.each([1, 5_000, 5_001, 200_000])('limits the WHOLE line of %i rows, even if only one joint uses the changed stamp', async joints => {
    const { db, select } = contextDb([{ ...scope, joints }])
    expect(await loadBoundedDispatcherDirtyScopes(db, [scope])).toEqual(joints <= 5_000 ? [scope] : null)
    expect(select).toHaveBeenCalledOnce()
  })

  it.each([500, 501])('limits %i complete scopes', async count => {
    const scopes = Array.from({ length: count }, (_, i) => ({ ...scope, line: String(i) }))
    const { db } = contextDb(scopes.map(value => ({ ...value, joints: 1 })))
    expect(await loadBoundedDispatcherDirtyScopes(db, scopes)).toEqual(count <= 500 ? scopes : null)
  })

  it('counts the union of context siblings and rejects legacy edge whitespace instead of dropping it', async () => {
    const large = contextDb([{ ...scope, joints: 3_000 }, { ...scope, line: 'L1', joints: 2_001 }])
    expect(await loadBoundedDispatcherDirtyScopes(large.db, [scope])).toBeNull()
    for (const line of ['\tL1', 'L1\u00a0', '\ufeffL1']) {
      expect(await loadBoundedDispatcherDirtyScopes(contextDb([{ ...scope, line, joints: 1 }]).db, [scope])).toBeNull()
    }
    const empty = contextDb([])
    expect(await loadBoundedDispatcherDirtyScopes(empty.db, [])).toEqual([])
    expect(empty.select).not.toHaveBeenCalled()
  })
})

describe('registry reference selection', () => {
  it('selects all six official fields once and includes both FK decision owners before a cascade', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...scope, unsafe: false }] })
    expect(await loadWelderStampDispatcherScopes({ execute } as never, [' ab12 ', 'CD34', 'AB12'], [7, 9])).toEqual([scope])
    expect(execute).toHaveBeenCalledTimes(2)
    const lock = dialect.sqlToQuery(execute.mock.calls[0][0]), query = dialect.sqlToQuery(execute.mock.calls[1][0])
    expect(lock.sql).toContain('for update')
    expect(lock.params).toContainEqual([7, 9])
    for (const field of ['stamp_1_k', 'stamp_1_z', 'stamp_1_o', 'stamp_2_k', 'stamp_2_z', 'stamp_2_o']) expect(query.sql).toContain(`"${field}"`)
    expect(query.sql).not.toContain('_fact')
    expect(query.sql).not.toContain('weld_date')
    expect(query.sql).not.toContain('officiality')
    expect(query.sql).toContain('"line_program_id"')
    expect(query.sql).toContain('"weld_joint_id"')
    expect(query.params).toContainEqual(['AB12', 'CD34'])
  })

  it('falls back for unowned non-expiry decisions and excessive or non-ASCII legacy references', async () => {
    for (const rows of [[{ unsafe: true }], Array.from({ length: 501 }, (_, i) => ({ ...scope, line: String(i), unsafe: false }))]) {
      const execute = vi.fn().mockResolvedValue({ rows })
      expect(await loadWelderStampDispatcherScopes({ execute } as never, ['AB12'], [])).toBeNull()
    }
    const execute = vi.fn()
    expect(await loadWelderStampDispatcherScopes({ execute } as never, ['КЛ12'], [])).toBeNull()
    expect(await loadWelderStampDispatcherScopes({ execute } as never, [], [])).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('dirty metadata is not trusted', () => {
  it.each([null, undefined, '', 'broken', '{}', '[null]', '[[]]', '[{"line":"L"}]', '[{"projectTitle":4,"subtitleCode":"S","line":"L"}]',
    '[{"projectTitle":"P","subtitleCode":"S","line":"L","kind":"unknown"}]'])('rejects %j instead of returning an empty scope', value => {
    expect(parseDispatcherDirtyScopes(value)).toBeNull()
  })
  it('only permits one validated generation marker when appending to an already global invalidation', () => {
    const generation = { kind: FULL_REBUILD_GENERATION_KIND, revision: 2 }
    expect(parseDispatcherDirtyScopes('[]')).toEqual([])
    expect(parseDispatcherDirtyScopes(JSON.stringify([scope]))).toEqual([scope])
    expect(parseDispatcherDirtyScopes(JSON.stringify([generation, scope]))).toBeNull()
    expect(parseDispatcherDirtyScopes(JSON.stringify([generation, scope]), true)).toEqual([scope])
    for (const metadata of [[generation, generation], [{ ...generation, revision: 0 }], [{ ...generation, revision: '2' }]]) {
      expect(parseDispatcherDirtyScopes(JSON.stringify(metadata), true)).toBeNull()
    }
  })
})
