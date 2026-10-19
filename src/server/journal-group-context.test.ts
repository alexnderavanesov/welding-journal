import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { normalizeOtherSettings } from '@/lib/other-settings'
import type { WeldRow } from '@/lib/dispatcher-types'

const mock = vi.hoisted(() => ({ records: [] as unknown[], selects: vi.fn(), where: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: (...args: unknown[]) => {
  mock.selects(...args)
  const chain = { from: () => chain, leftJoin: () => chain, where: (condition: unknown) => { mock.where(condition); return Promise.resolve(mock.records) } }
  return chain
} }) }))
import { attachJournalGroupContext } from './journal-group-context'

const state = { weldJointId: 2, kind: 'repair', physicalRootId: 1, sourceRowId: 1, coilParentId: null, coilSide: null, replacedByCoil: false, replacementCoilIds: [] }
beforeEach(() => { mock.selects.mockClear(); mock.where.mockClear(); mock.records = [] })
describe('bounded physical root metadata for journal groups', () => {
  it.each([1, 100, 5000])('uses one scoped read for %i rows, not a root read per record', async count => {
    const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1 })) as WeldRow[]
    await attachJournalGroupContext(rows, normalizeOtherSettings({}))
    expect(mock.selects).toHaveBeenCalledTimes(1)
    const query = new QueryBuilder().select().from((await import('@/db/schema')).weldJointProgramStates).where(mock.where.mock.calls[0][0]).toSQL()
    expect(query.sql).toContain('any(')
    expect(query.params.flat()).toHaveLength(count)
  })
  it('keeps saved identity and replacement even if a filter hides the root', async () => {
    mock.records = [{ state, root: { id: 1, wdi: '12.25', d1: '254', connectionType: 'С17' }, replaced: true }]
    const rows = [{ id: 2, wdi: 99 }] as WeldRow[]
    expect(await attachJournalGroupContext(rows, normalizeOtherSettings({ wdiCalculationMode: 'manual' })))
      .toMatchObject([{ programChainState: state, groupPhysicalRoot: { id: 1, exists: true, replaced: true, wdi: 12.25 } }])
    expect(rows[0]).not.toHaveProperty('programChainState')
  })
  it('uses current WDI settings instead of stale saved root WDI', async () => {
    mock.records = [{ state, root: { id: 1, wdi: '999', d1: '254', connectionType: 'С17' }, replaced: false }]
    expect(await attachJournalGroupContext([{ id: 2 }] as WeldRow[], normalizeOtherSettings({ wdiCalculationMode: 'formula' })))
      .toMatchObject([{ groupPhysicalRoot: { wdi: 10 } }])
  })
  it('preserves the tombstone of a deleted physical root and makes missing WDI explicit', async () => {
    mock.records = [{ state, root: null, replaced: true }]
    expect(await attachJournalGroupContext([{ id: 2 }] as WeldRow[], normalizeOtherSettings({})))
      .toMatchObject([{ groupPhysicalRoot: { id: 1, exists: false, replaced: true, wdi: null } }])
    await attachJournalGroupContext([], normalizeOtherSettings({}))
    expect(mock.selects).toHaveBeenCalledTimes(1)
  })
})
