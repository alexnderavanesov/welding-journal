import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { documentTemplates } from '@/db/schema'

type RecordType = typeof documentTemplates.$inferSelect
const state = vi.hoisted(() => ({
  record: undefined as RecordType | undefined,
  files: new Map<string, ArrayBuffer>(),
  failDelete: false,
  loseCommitReply: false,
  transaction: vi.fn(),
}))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: state.transaction }) }))
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: vi.fn() }))
vi.mock('@/server/layered-control-documents', () => ({ rebuildLayeredControlDocumentsInTransaction: vi.fn() }))
vi.mock('@/server/document-template-files', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/document-template-files')>(),
  assertPersistentDocumentTemplateStorage: vi.fn(),
  createDocumentTemplateFileStore: () => ({
    get: async (key: string) => state.files.get(key) ?? null,
    set: async (key: string, data: ArrayBuffer) => { state.files.set(key, data) },
    list: async (prefix: string) => [...state.files.keys()].filter(key => key.startsWith(prefix)),
    delete: async (key: string) => {
      if (state.failDelete) throw new Error('synthetic disk error')
      state.files.delete(key)
    },
  }),
}))

import { cleanupRemoteDocumentTemplateFiles, saveRemoteDocumentTemplate } from '@/server/document-templates'
import { assertPersistentDocumentTemplateStorage } from '@/server/document-template-files'

const oldKey = 'weldingJournal/old.xlsx'
const oldDate = new Date('2026-10-13T08:00:00Z')
const input = () => ({ id: 'weldingJournal' as const, expectedVersion: state.record!.updatedAt.toISOString(), fileName: 'replacement.xlsx', fileType: 'xlsx', fileSize: 3, fileDataBase64: Buffer.from([1, 2, 3]).toString('base64'), fields: [], markerCount: 0, locations: [], warnings: [] })

beforeEach(() => {
  state.files.clear()
  state.files.set(oldKey, new Uint8Array([4, 5, 6]).buffer)
  state.record = { id: 'weldingJournal', blobKey: oldKey, fileName: 'original.xlsx', fileType: 'xlsx', fileSize: 3, metadata: '{}', options: '{}', constructorConfig: null, uploadedAt: oldDate, updatedAt: oldDate }
  state.failDelete = false
  state.loseCommitReply = false
  state.transaction.mockImplementation(async action => {
    let pending: RecordType | undefined
    const select = () => {
      const query = { from: () => query, where: () => query, for: () => query, limit: async () => state.record ? [state.record] : [] }
      return query
    }
    const tx = { execute: async () => ({}), select, insert: () => ({ values: (value: RecordType) => ({ onConflictDoUpdate: () => ({ returning: async () => { pending = { ...state.record, ...value }; return [pending] } }) }) }) }
    const result = await action(tx)
    if (pending) {
      state.record = pending
      if (state.loseCommitReply) { state.loseCommitReply = false; throw new Error('synthetic lost COMMIT reply') }
    }
    return result
  })
})

describe('template save: file/database failure boundaries', () => {
  it('returns success after a lost COMMIT reply and never deletes the committed active file', async () => {
    state.loseCommitReply = true
    const result = await saveRemoteDocumentTemplate({ data: input() })
    expect(result.fileName).toBe('replacement.xlsx')
    expect(result.storageWarning).toBeUndefined()
    expect(state.record!.blobKey).not.toBe(oldKey)
    expect([...state.files.keys()]).toEqual([state.record!.blobKey])
  })

  it('reports cleanup separately from successful save; retry removes only garbage without rewriting settings', async () => {
    state.failDelete = true
    const result = await saveRemoteDocumentTemplate({ data: input() })
    expect(result.storageWarning).toContain('Шаблон сохранён')
    const saved = structuredClone(state.record)
    expect(state.files.size).toBe(2)
    state.failDelete = false
    vi.mocked(assertPersistentDocumentTemplateStorage).mockClear()
    await cleanupRemoteDocumentTemplateFiles({ data: { id: 'weldingJournal' } })
    expect(assertPersistentDocumentTemplateStorage).toHaveBeenCalledOnce()
    expect(state.record).toEqual(saved)
    expect([...state.files.keys()]).toEqual([saved!.blobKey])
  })

  it('refuses another upload when existing orphan cleanup fails, bounding garbage', async () => {
    state.files.set('weldingJournal/interrupted.xlsx', new Uint8Array([9]).buffer)
    state.failDelete = true
    const before = structuredClone(state.record)
    await expect(saveRemoteDocumentTemplate({ data: input() })).rejects.toThrow('synthetic disk error')
    expect(state.record).toEqual(before)
    expect([...state.files.keys()]).toEqual([oldKey, 'weldingJournal/interrupted.xlsx'])
  })
})
