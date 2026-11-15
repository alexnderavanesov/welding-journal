import { beforeEach, expect, it, vi } from 'vitest'
import type { documentTemplates } from '@/db/schema'

type RecordType = typeof documentTemplates.$inferSelect
const state = vi.hoisted(() => ({ records: [] as RecordType[], files: new Map<string, ArrayBuffer>(), get: vi.fn(), exists: vi.fn(), list: vi.fn(), locks: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: async (read: (tx: unknown) => unknown) => read({
  execute: state.locks,
  select: () => {
    const query = { from: () => query, where: () => query, limit: async () => state.records.slice(0, 1), then: (resolve: (rows: RecordType[]) => unknown) => Promise.resolve(state.records).then(resolve) }
    return query
  },
}) }) }))
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: vi.fn() }))
vi.mock('@/server/layered-control-documents', () => ({ rebuildLayeredControlDocumentsInTransaction: vi.fn() }))
vi.mock('@/server/document-template-files', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/document-template-files')>(),
  createDocumentTemplateFileStore: () => ({ get: state.get, exists: state.exists, list: state.list }),
}))
import { getRemoteDocumentTemplateInventory, getRemoteDocumentTemplate } from './document-templates'

beforeEach(() => {
  vi.clearAllMocks()
  state.files.clear()
  const date = new Date('2026-11-14T06:30:00Z')
  state.records = (['weldingJournal', 'checklist'] as const).map(id => ({ id, blobKey: `${id}/active.xlsx`, fileName: `${id}.xlsx`, fileType: 'xlsx', fileSize: 256 * 1024, metadata: '{}', options: '{}', constructorConfig: null, uploadedAt: date, updatedAt: date }))
  for (const row of state.records) state.files.set(row.blobKey, new Uint8Array(row.fileSize).buffer)
  state.get.mockImplementation(async key => state.files.get(key) ?? null)
  state.exists.mockImplementation(async key => state.files.has(key))
  state.list.mockImplementation(async prefix => [...state.files.keys()].filter(key => key.startsWith(prefix)))
})

it('lists metadata and file availability without reading or transmitting file contents', async () => {
  const inventory = await getRemoteDocumentTemplateInventory()
  expect(state.get).not.toHaveBeenCalled()
  expect(state.exists).toHaveBeenCalledTimes(2)
  expect(state.locks).toHaveBeenCalledOnce()
  expect(inventory.templates.map(template => template.id)).toEqual(['weldingJournal', 'checklist'])
  expect(inventory.missing).toEqual([])
  expect(Buffer.byteLength(JSON.stringify(inventory))).toBeLessThan(1000)
  for (const template of inventory.templates) expect(template).not.toHaveProperty('fileDataBase64')
})

it('keeps missing-file metadata, version and storage warnings distinct from unloaded bytes', async () => {
  state.files.delete(state.records[0].blobKey)
  state.files.set('checklist/orphan.xlsx', new ArrayBuffer(1))
  const inventory = await getRemoteDocumentTemplateInventory()
  expect(inventory.templates.map(template => template.id)).toEqual(['checklist'])
  expect(inventory.missing).toEqual([expect.objectContaining({ id: 'weldingJournal', version: state.records[0].updatedAt.toISOString() })])
  expect(inventory.storageWarnings.checklist).toContain('лишние файлы')
  expect(state.get).not.toHaveBeenCalled()
})

it('does not disguise an availability-check failure as a missing template', async () => {
  state.exists.mockRejectedValueOnce(new Error('storage permission denied'))
  await expect(getRemoteDocumentTemplateInventory()).rejects.toThrow('storage permission denied')
})

it('reads only the requested file with its metadata', async () => {
  const selected = await getRemoteDocumentTemplate({ data: { id: 'weldingJournal' } })
  expect(state.get).toHaveBeenCalledExactlyOnceWith('weldingJournal/active.xlsx')
  expect(Buffer.from(selected!.fileDataBase64, 'base64')).toHaveLength(256 * 1024)
})
