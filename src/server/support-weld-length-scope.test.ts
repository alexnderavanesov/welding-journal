import { expect, it, vi } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { lockSupportWeldLengthMemberships } from './support-weld-length-scope'

const root = { id: 1, line: 'A', projectTitle: 'P', subtitleCode: 'S', connectionType: 'Т1' }
const moved = { ...root, id: 2, line: 'B' }
const state = (id: number) => ({ weldJointId: id, physicalRootId: 1, kind: id === 1 ? 'primary' : 'repair' })
const snapshot = [root, moved].map(row => ({ row, state: state(row.id) }))
function transaction(results: typeof snapshot[]) {
  const events: string[] = []
  const execute = vi.fn(async (_query: SQL) => { events.push('lock') })
  const select = vi.fn((projection: object) => {
    const query = { from: () => query, leftJoin: () => query, where: () => query, orderBy: () => query,
      getSQL: () => sql`select 1`,
      then: (resolve: (value: typeof snapshot) => void) => { events.push('read'); return Promise.resolve(results.shift() ?? []).then(resolve) } }
    return query
  })
  return { tx: { execute, select } as never, execute, select, events }
}

it('locks the sorted union of original/moved/destination lines before rechecking membership', async () => {
  const mock = transaction([snapshot, snapshot])
  await lockSupportWeldLengthMemberships(mock.tx, [root, { ...root, line: 'C' }], [{ id: 1, weldLength: '800' }])
  expect(mock.events).toEqual(['read', 'lock', 'read'])
  expect(mock.execute).toHaveBeenCalledOnce()
  const keys = new PgDialect().sqlToQuery(mock.execute.mock.calls[0][0]).params[0] as string[]
  expect(keys).toHaveLength(3)
  expect(keys).toEqual([...keys].sort())
  expect(keys.join(' ')).toContain('b')
})

it.each(['move', 'insert', 'root'] as const)('rejects a concurrent %s after locking, without acquiring late additional locks', async change => {
  const current = snapshot.map(item => ({ row: { ...item.row }, state: { ...item.state } }))
  if (change === 'move') current[1].row.line = 'C'
  if (change === 'insert') current.push({ row: { ...moved, id: 3 }, state: state(3) })
  if (change === 'root') current[1].state.physicalRootId = 4
  const mock = transaction([snapshot, current])
  await expect(lockSupportWeldLengthMemberships(mock.tx, [root], [{ id: 1, weldLength: null }])).rejects.toThrow('Состав или расположение')
  expect(mock.events).toEqual(['read', 'lock', 'read'])
  expect(mock.execute).toHaveBeenCalledOnce()
})

it('does not query physical links for unrelated changes or C/U lengths', async () => {
  const mock = transaction([])
  await lockSupportWeldLengthMemberships(mock.tx, [root], [{ id: 1, weldingJournalNote: 'corrected' }, { id: 2, connectionType: 'С17', weldLength: null }])
  expect(mock.select).not.toHaveBeenCalled()
  expect(mock.execute).toHaveBeenCalledOnce()
})
