import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createProgramDocumentPreviewRequest } from './line-program-document-link'

const mocks = vi.hoisted(() => ({ registry: vi.fn(), system: vi.fn(), generated: vi.fn() }))
vi.mock('@/server/welder-stamps', () => ({ loadWelderStampRegistrySnapshot: mocks.registry }))
vi.mock('@/lib/system-document-storage', () => ({ createCurrentSystemDocumentBlob: mocks.system }))
vi.mock('@/lib/welding-journal-document', () => ({ createGeneratedDocumentBlobForRow: mocks.generated }))
const reference = { type: 'lnkConclusion' as const, title: 'РК-123', date: '2026-09-01', methodCode: 'РК' }
let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(window, 'open').mockReturnValue(null)
  mocks.registry.mockResolvedValue({ stamps: [] })
  mocks.system.mockResolvedValue(new Blob())
  mocks.generated.mockResolvedValue(new Blob())
})
afterEach(() => { client.clear(); vi.restoreAllMocks(); vi.resetAllMocks() })

it('loads on demand, reuses the registry cache and preserves an exact stage reference', async () => {
  const scoped = { ...reference, sourceKind: 'pstoCycle' as const, cycleSequences: [2], methodCode: 'ТВМТ' }
  await createProgramDocumentPreviewRequest({ reference: scoped }, client).createBlob()
  await createProgramDocumentPreviewRequest({ reference }, client).createBlob()
  expect(window.open).not.toHaveBeenCalled()
  expect(mocks.registry).toHaveBeenCalledOnce()
  expect(mocks.system).toHaveBeenNthCalledWith(1, { reference: scoped, welderStamps: [] })
  expect(mocks.system).toHaveBeenNthCalledWith(2, { reference, welderStamps: [] })
})

it('opens the saved layered document by ID instead of a similarly named ordinary PVK conclusion', async () => {
  const row = { id: 1, layeredPvkEdgesDocumentId: 25, layeredPvkEdgesDocument: 'ПВК кромок 25' }
  await createProgramDocumentPreviewRequest({ row, field: 'layeredPvkEdgesDocument' }, client).createBlob()
  expect(mocks.generated).toHaveBeenCalledWith(row, 'layeredPvkEdgesDocument', [])
  expect(mocks.system).not.toHaveBeenCalled()
})

it('does no data work while merely preparing a link', () => {
  createProgramDocumentPreviewRequest({ reference }, client)
  expect(mocks.registry).not.toHaveBeenCalled()
  expect(mocks.system).not.toHaveBeenCalled()
  expect(window.open).not.toHaveBeenCalled()
})

it('reports an incomplete historical document before fetching the registry', async () => {
  const request = createProgramDocumentPreviewRequest({ row: { id: 1, layeredPvkEdgesDocumentId: 25 }, field: 'layeredPvkEdgesDocument' }, client)
  await expect(request.createBlob()).rejects.toThrow('не сохранён номер')
  expect(mocks.registry).not.toHaveBeenCalled()
  expect(mocks.generated).not.toHaveBeenCalled()
})

it('passes a readable failure to the shared preview and never opens a window', async () => {
  mocks.system.mockRejectedValue(new Error('Документ недоступен'))
  await expect(createProgramDocumentPreviewRequest({ reference }, client).createBlob()).rejects.toThrow('Документ недоступен')
  expect(window.open).not.toHaveBeenCalled()
})
