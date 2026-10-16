import { afterEach, expect, it, vi } from 'vitest'
import { createRowDocumentPreviewRequest } from './row-document-preview'
import type { WeldFieldKey } from './weld-fields'

const mocks = vi.hoisted(() => ({ system: vi.fn(), generated: vi.fn() }))
vi.mock('@/lib/system-document-storage', () => ({ createCurrentSystemDocumentBlob: mocks.system }))
vi.mock('@/lib/welding-journal-document', () => ({ createGeneratedDocumentBlobForRow: mocks.generated }))
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

it.each([
  ['vikConclusion', 'ВИК'], ['rkConclusion', 'РК'], ['uzkConclusion', 'УЗК'], ['pvkConclusion', 'ПВК'], ['tvmtConclusion', 'ТВМТ'],
] as const)('loads %s only on opening and keeps the document identity', async (field, methodCode) => {
  const open = vi.spyOn(window, 'open')
  const blob = new Blob(['document'])
  mocks.system.mockResolvedValue(blob)
  const row = { id: 1, [field]: 'НК/123', [`${field}Date`]: '2026-10-03', systemDocumentIds: { [field]: 42 } }
  const request = createRowDocumentPreviewRequest(row, field as WeldFieldKey, [])
  expect(mocks.system).not.toHaveBeenCalled()
  expect(request.fileName).toBe('НК-123.xlsx')
  await expect(request.createBlob()).resolves.toBe(blob)
  expect(mocks.system).toHaveBeenCalledExactlyOnceWith({ reference: expect.objectContaining({ type: 'lnkConclusion', title: 'НК/123', methodCode, documentId: 42 }), welderStamps: [] })
  expect(open).not.toHaveBeenCalled()
})

it('keeps generated document IDs and reports unavailable metadata in the preview', async () => {
  const row = { id: 1, jsrDocument: 'ЖСР 4', jsrDocumentId: 4 }
  const request = createRowDocumentPreviewRequest(row, 'jsrDocument', [])
  expect(mocks.generated).not.toHaveBeenCalled()
  await request.createBlob()
  expect(mocks.generated).toHaveBeenCalledExactlyOnceWith(row, 'jsrDocument', [])
  await expect(createRowDocumentPreviewRequest({ id: 1 }, 'vikConclusion', []).createBlob()).rejects.toThrow('не сохранён номер')
})

it.each([
  ['pstoRequest', 'pstoRequest', 'pstoRequestDate'],
  ['heatTreatmentDiagram', 'pstoConclusion', 'pstoDate'],
] as const)('keeps the exact saved PSTO document and date for %s', async (field, type, dateField) => {
  const blob = new Blob(['document'])
  mocks.system.mockResolvedValue(blob)
  const row = { id: 1, [field]: 'ПСТО-17', [dateField]: '2026-10-03', systemDocumentIds: { [field]: 17 } }
  await expect(createRowDocumentPreviewRequest(row, field, []).createBlob()).resolves.toBe(blob)
  expect(mocks.system).toHaveBeenCalledExactlyOnceWith({
    reference: expect.objectContaining({ documentId: 17, type, title: 'ПСТО-17', date: '2026-10-03' }),
    welderStamps: [],
  })
})
