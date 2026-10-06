import { expect, it, vi } from 'vitest'
import { generatedDocuments } from '@/db/schema'
import { changeSystemDocumentDate } from './system-document-date-workflow'

const state = vi.hoisted(() => ({ tx: {} as unknown, locks: [] as string[] }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: (run: (tx: unknown) => unknown) => run(state.tx) }) }))
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: async () => {} }))
vi.mock('@/server/control-process-settings', () => ({ loadControlProcessSettingsFromTransaction: async () => ({}) }))
vi.mock('@/server/weld-workflow-settings', () => ({ loadWeldWorkflowSettingsFromTransaction: async () => ({}) }))
vi.mock('@/server/weld-row-version', () => ({
  lockInteractiveWeldRows: async () => { state.locks.push('welds'); throw new Error('Stop after first weld lock') },
}))

it('does not lock the document or its assignments before the common weld lock', async () => {
  state.locks = []
  state.tx = { select: () => ({ from: (table: unknown) => {
    const name = table === generatedDocuments ? 'document' : 'assignments'
    const result = name === 'document'
      ? [{ id: 3, type: 'system:lnkRequest', title: 'R', periodFrom: '2026-09-01', sourceMetadata: null }]
      : [{ weldJointId: 1 }]
    const query = { where: () => query, limit: () => query, orderBy: () => query,
      for: () => { state.locks.push(name); return query },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return query
  } }) }
  await expect(changeSystemDocumentDate({ data: { reference: { documentId: 3, type: 'lnkRequest', title: 'R', date: '2026-09-01' },
    nextDate: '2026-09-02', expectedVersions: [{ id: 1, version: '1' }] } })).rejects.toThrow('Stop after first weld lock')
  expect(state.locks).toEqual(['welds'])
})
