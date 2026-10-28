import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appSettings, generatedDocumentWeldJoints, preHeatTreatmentControls, pstoRepeatCycles, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { loadRemoteGeneratedDocumentRows } from './generated-documents'
import { getDocumentGenerationData } from './weld-read'

const state = vi.hoisted(() => ({ rows: [] as WeldRow[], tables: [] as unknown[], transaction: vi.fn() }))
// No pool-level select: a relation accidentally escaping the transaction fails.
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: state.transaction }) }))
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: async () => {} }))

function select(projection?: Record<string, unknown>, distinct = false) {
  return { from(table: unknown) {
    state.tables.push(table)
    const lastId = state.rows.length
    const rows = distinct || table === appSettings ? []
      : table === weldJoints ? state.rows
      : table === generatedDocumentWeldJoints ? projection?.weld
        ? state.rows.map(weld => ({ weld }))
        : [{ documentId: 88, type: 'weldingJournal', title: 'JSR', weldJointIds: state.rows.map(row => row.id) }]
      : table === preHeatTreatmentControls ? [{ id: 1, weldJointId: lastId, method: 'ВИК', result: 'годен' }]
      : table === pstoRepeatCycles ? [{ id: 2, weldJointId: lastId, sequence: 2, pstoRequest: 'REPEAT' }]
      : []
    const query = Object.assign(Promise.resolve(rows), { where: () => query, orderBy: () => query,
      innerJoin: () => query, groupBy: () => query, limit: () => query })
    return query
  } }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.tables = []
  state.transaction.mockImplementation(callback => callback({ select, selectDistinct: (projection: Record<string, unknown>) => select(projection, true) }))
})

describe('manual document sources use one bounded database snapshot', () => {
  for (const entry of ['history', 'generation'] as const) it.each([1, 1000, 200000])(`${entry}: %i rows retain their cycle history and document links`, async count => {
    state.rows = Array.from({ length: count }, (_, index) => ({ id: index + 1, joint: `F${index + 1}`,
      line: 'L', weldDate: '2026-09-01', pstoRequest: 'PRIMARY' })) as WeldRow[]
    const rows = entry === 'history' ? await loadRemoteGeneratedDocumentRows(88)
      : (await getDocumentGenerationData({ data: {} })).rows
    expect(rows).toHaveLength(count)
    expect(rows.at(-1)).toMatchObject({ id: count, pstoRequest: 'PRIMARY', jsrDocument: 'JSR',
      pstoRepeatCycles: [expect.objectContaining({ sequence: 2, pstoRequest: 'REPEAT' })] })
    expect(rows[0].jsrDocument).toBe('JSR')
    expect(state.rows.at(-1)).not.toHaveProperty('pstoRepeatCycles')
    expect(state.tables).toHaveLength(entry === 'history' ? 5 : 9)
    expect(state.tables.filter(table => table === pstoRepeatCycles)).toHaveLength(1)
    expect(state.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: 'repeatable read', accessMode: 'read only',
    })
  })
})
