import { beforeEach, describe, expect, it, vi } from 'vitest'
import { synchronizeSupportWeldLengths } from './support-weld-length'
import { loadProgramChainScopeRows } from './line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { PgDialect } from 'drizzle-orm/pg-core'
import { loadSupportLengthChainRows } from './support-weld-length-scope'
import { registerAdditionalDispatcherDirtyScopes } from './dispatcher-task-index-dirty'

vi.mock('./line-program-chain-state', () => ({ loadProgramChainScopeRows: vi.fn() }))
vi.mock('./support-weld-length-scope', () => ({ loadSupportLengthChainRows: vi.fn() }))
vi.mock('./dispatcher-task-index-dirty', async original => ({ ...await original<typeof import('./dispatcher-task-index-dirty')>(), registerAdditionalDispatcherDirtyScopes: vi.fn() }))
const options = { settings: DEFAULT_SYSTEM_INDEX_SETTINGS }
const source: WeldRow = { id: 1, joint: 'ОП-1', connectionType: 'Т1', line: 'L', weldLength: 600.123456 }
const repair: WeldRow = { ...source, id: 2, joint: 'ОП-1R1', uzkResult: 'ремонт', uzkConclusion: 'Сохранить' }

function transaction(lockedIds: number[], returned: WeldRow[][]) {
  const set = vi.fn().mockReturnThis()
  const returning = vi.fn()
  returned.forEach(rows => returning.mockResolvedValueOnce(rows))
  const update = { set, where: vi.fn().mockReturnThis(), returning }
  const select = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
    for: vi.fn().mockResolvedValue(lockedIds.map(id => ({ id }))) }
  const tx = { select: vi.fn(() => select), update: vi.fn(() => update) }
  return { tx: tx as never, set, select, returning, raw: tx }
}

beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadSupportLengthChainRows).mockResolvedValue([]) })

describe('atomic support length persistence', () => {
  it('propagates to a moved descendant by persisted physical root without touching its new namesake', async () => {
    const saved = { ...source, weldLength: '800.123456789123456789' }
    const moved = { ...repair, line: 'OTHER', programChainState: { weldJointId: 2, kind: 'repair' as const, physicalRootId: 1,
      sourceRowId: 1, coilParentId: null, coilSide: null, replacedByCoil: false, replacementCoilIds: [] } }
    vi.mocked(loadProgramChainScopeRows).mockResolvedValue([saved])
    vi.mocked(loadSupportLengthChainRows).mockResolvedValue([saved, moved])
    const returned = { ...moved, weldLength: saved.weldLength, rowVersion: 'fresh' }
    const mock = transaction([2], [[returned]])
    expect(await synchronizeSupportWeldLengths(mock.tx, [saved], new Map([[1, source]]), options)).toEqual([returned])
    expect(mock.select.for).toHaveBeenCalledWith('update')
    expect(loadSupportLengthChainRows).toHaveBeenCalledWith(mock.tx, [1])
    expect(registerAdditionalDispatcherDirtyScopes).toHaveBeenCalledWith(mock.tx, [{ projectTitle: '', subtitleCode: '', line: 'OTHER' }])
  })
  it('updates only L and both modification timestamps, retaining row versions and facts returned by DB', async () => {
    const saved = { ...source, weldLength: '800.123456789123456789' }
    vi.mocked(loadProgramChainScopeRows).mockResolvedValue([saved, repair])
    const returned = { ...repair, weldLength: saved.weldLength, rowVersion: 'new' }
    const mock = transaction([2], [[returned]])
    expect(await synchronizeSupportWeldLengths(mock.tx, [saved], new Map([[1, source]]), options)).toEqual([returned])
    expect(Object.keys(mock.set.mock.calls[0][0]).sort()).toEqual(['updatedAt', 'weldLength', 'weldingUpdatedAt'])
    expect(new PgDialect().sqlToQuery(mock.set.mock.calls[0][0].weldLength).params).toContain(saved.weldLength)
    expect(mock.select.orderBy).toHaveBeenCalledOnce()
    expect(mock.select.for).toHaveBeenCalledWith('update')
    expect(repair.uzkConclusion).toBe('Сохранить')
    expect(mock.returning).toHaveBeenCalledOnce()
  })

  it('rejects an independently edited repair before any propagation query writes', async () => {
    const changed = { ...repair, weldLength: 100 }
    vi.mocked(loadProgramChainScopeRows).mockResolvedValue([source, changed])
    const mock = transaction([], [])
    await expect(synchronizeSupportWeldLengths(mock.tx, [changed], new Map([[2, repair]]), options)).rejects.toThrow('Длина ремонта наследуется')
    expect(mock.raw.update).not.toHaveBeenCalled()
  })

  it('fails atomically on a missing descendant instead of partially propagating', async () => {
    const saved = { ...source, weldLength: null }
    vi.mocked(loadProgramChainScopeRows).mockResolvedValue([saved, repair])
    const mock = transaction([], [])
    await expect(synchronizeSupportWeldLengths(mock.tx, [saved], new Map([[1, source]]), options)).rejects.toThrow('Состав ремонтной цепочки изменился')
    expect(mock.raw.update).not.toHaveBeenCalled()
  })

  it('batches long chains and propagates failures to the caller transaction', async () => {
    const saved = { ...source, weldLength: 777 }
    const repairs = Array.from({ length: 2001 }, (_, index) => ({ ...repair, id: index + 2, joint: `ОП-1R${index + 1}` }))
    vi.mocked(loadProgramChainScopeRows).mockResolvedValue([saved, ...repairs])
    const mock = transaction(repairs.map(row => row.id), [repairs.slice(0, 1000), repairs.slice(1000, 2000), repairs.slice(2000)])
    expect(await synchronizeSupportWeldLengths(mock.tx, [saved], new Map([[1, source]]), options)).toHaveLength(2001)
    expect(mock.returning).toHaveBeenCalledTimes(3)
    const failed = transaction(repairs.map(row => row.id), [repairs.slice(0, 1000)])
    failed.returning.mockRejectedValueOnce(new Error('write conflict'))
    await expect(synchronizeSupportWeldLengths(failed.tx, [saved], new Map([[1, source]]), options)).rejects.toThrow('write conflict')
  })

  it('avoids extra SQL for C/U and unrelated updates with unchanged support length', async () => {
    const tx = { select: vi.fn(), update: vi.fn() }
    expect(await synchronizeSupportWeldLengths(tx as never, [{ ...source, connectionType: 'С17' }], new Map(), options)).toEqual([])
    expect(await synchronizeSupportWeldLengths(tx as never, [repair], new Map([[2, repair]]), options)).toEqual([])
    expect(tx.select).not.toHaveBeenCalled()
    expect(loadProgramChainScopeRows).not.toHaveBeenCalled()
  })
})
