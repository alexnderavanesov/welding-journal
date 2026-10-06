import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openProgramDocument } from './line-program-document-link'

const mocks = vi.hoisted(() => ({ registry: vi.fn(), system: vi.fn(), generated: vi.fn() }))
vi.mock('@/server/welder-stamps', () => ({ loadWelderStampRegistrySnapshot: mocks.registry }))
vi.mock('@/lib/system-document-storage', () => ({ openSystemDocument: mocks.system }))
vi.mock('@/lib/welding-journal-document', () => ({ openGeneratedDocumentForRow: mocks.generated }))
const reference = { type: 'lnkConclusion' as const, title: 'РК-123', date: '2026-09-01', methodCode: 'РК' }
let client: QueryClient
let preview: Window
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  preview = { closed: false, opener: window, document: { title: '', body: { textContent: '' } } } as unknown as Window
  vi.spyOn(window, 'open').mockReturnValue(preview)
  mocks.registry.mockResolvedValue({ stamps: [] })
})
afterEach(() => { client.clear(); vi.restoreAllMocks(); vi.resetAllMocks() })

it('opens the original-click window, reuses the registry cache and preserves an exact stage reference', async () => {
  const scoped = { ...reference, sourceKind: 'pstoCycle' as const, cycleSequences: [2], methodCode: 'ТВМТ' }
  await openProgramDocument({ reference: scoped }, client)
  await openProgramDocument({ reference }, client)
  expect(window.open).toHaveBeenCalledTimes(2)
  expect(preview.opener).toBeNull()
  expect(mocks.registry).toHaveBeenCalledOnce()
  expect(mocks.system).toHaveBeenNthCalledWith(1, { reference: scoped, welderStamps: [], previewWindow: preview })
  expect(mocks.system).toHaveBeenNthCalledWith(2, { reference, welderStamps: [], previewWindow: preview })
})

it('opens the saved layered document by ID instead of a similarly named ordinary PVK conclusion', async () => {
  const row = { id: 1, layeredPvkEdgesDocumentId: 25, layeredPvkEdgesDocument: 'ПВК кромок 25' }
  await openProgramDocument({ row, field: 'layeredPvkEdgesDocument' }, client)
  expect(mocks.generated).toHaveBeenCalledWith(row, 'layeredPvkEdgesDocument', [], preview)
  expect(mocks.system).not.toHaveBeenCalled()
})

it('does no data work when the browser blocks the popup', async () => {
  vi.mocked(window.open).mockReturnValue(null)
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
  await openProgramDocument({ reference }, client)
  expect(alert).toHaveBeenCalledOnce()
  expect(mocks.registry).not.toHaveBeenCalled()
})

it('explains an incomplete historical document instead of leaving an endless loading tab', async () => {
  await openProgramDocument({ row: { id: 1, layeredPvkEdgesDocumentId: 25 }, field: 'layeredPvkEdgesDocument' }, client)
  expect(preview.document.body.textContent).toContain('не сохранён номер')
  expect(mocks.registry).not.toHaveBeenCalled()
  expect(mocks.generated).not.toHaveBeenCalled()
})

it('shows a readable failure without unhandled rejection or any mutation', async () => {
  mocks.system.mockRejectedValue(new Error('Документ недоступен'))
  await expect(openProgramDocument({ reference }, client)).resolves.toBeUndefined()
  expect(preview.document.body.textContent).toBe('Документ недоступен')
})
