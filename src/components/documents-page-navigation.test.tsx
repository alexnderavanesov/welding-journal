import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentsPage } from '@/components/documents-page'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'

const { loadGeneratedDocumentHistory, loadSystemDocumentHistory } = vi.hoisted(() => ({
  loadGeneratedDocumentHistory: vi.fn(),
  loadSystemDocumentHistory: vi.fn(),
}))

vi.mock('@/lib/security-context', () => ({
  useSecurityGuard: () => ({
    requireDeletePassword: vi.fn(async () => true),
    requireDocumentGenerationPassword: vi.fn(async () => true),
    requireEditPassword: vi.fn(async () => true),
  }),
}))

vi.mock('@/lib/confirm-action-context', () => ({
  useConfirmAction: () => vi.fn(async () => false),
}))

vi.mock('@/lib/use-system-document-template-availability', () => ({
  useSystemDocumentTemplateAvailability: () => new Set(),
}))

vi.mock('@/lib/system-document-storage', () => ({
  createCurrentSystemDocumentBlob: vi.fn(),
  downloadSystemDocument: vi.fn(),
  loadSystemDocumentHistory,
  loadSystemDocumentRows: vi.fn(),
  openSystemDocument: vi.fn(),
  renameSystemDocumentToCurrentName: vi.fn(),
}))

vi.mock('@/lib/generated-document-storage', () => ({
  deleteGeneratedDocument: vi.fn(),
  downloadGeneratedDocument: vi.fn(),
  downloadGeneratedDocumentArchive: vi.fn(),
  loadGeneratedDocumentHistory,
  loadGeneratedDocumentRows: vi.fn(),
  openGeneratedDocument: vi.fn(),
}))

describe('DocumentsPage report navigation', () => {
  beforeEach(() => {
    loadGeneratedDocumentHistory.mockReset()
    loadSystemDocumentHistory.mockReset()
  })

  it('loads the selected document through the title filter on the first request', async () => {
    loadSystemDocumentHistory.mockResolvedValue({
      documents: [{
        id: 'system-document:77',
        documentId: 77,
        type: 'pstoRequest',
        title: 'Заявка ПСТО-77',
        date: '2026-09-18',
        sourceKind: 'pstoCycle',
        cycleSequences: [1],
        label: 'Заявка ПСТО-77',
        fileName: 'psto-77.xlsx',
        methodCodes: [],
        rowCount: 1,
        positionCount: 1,
        projects: ['Проект'],
        subtitleCodes: ['Шифр'],
        lines: ['Линия'],
        periodFrom: '2026-09-18',
        periodTo: '2026-09-18',
        updatedAt: '2026-09-18T10:00:00.000Z',
        rowIds: [5],
      }],
      total: 1,
      filterOptions: {},
    })
    const onNavigationRequestHandled = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentsPage
          welderStamps={[]}
          navigationRequest={{
            requestId: 10,
            kind: 'system',
            documentId: 77,
            type: 'pstoRequest',
            title: 'Заявка ПСТО-77',
            date: '2026-09-18',
            sourceKind: 'pstoCycle',
            cycleSequences: [1],
          }}
          onNavigationRequestHandled={onNavigationRequestHandled}
        />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Заявка ПСТО-77')).toBeInTheDocument()
    await waitFor(() => expect(loadSystemDocumentHistory).toHaveBeenCalledTimes(1))
    const request = loadSystemDocumentHistory.mock.calls[0]?.[0]
    expect(request?.type).toBe('pstoRequest')
    expect(request?.documentId).toBe(77)
    expect(parseWeldColumnChoiceFilter(request?.columnFilters?.title ?? '')).toEqual({
      kind: 'values',
      values: ['Заявка ПСТО-77'],
    })
    expect(onNavigationRequestHandled).toHaveBeenCalledWith(10)
  })

  it('opens a generated document from the journal in its filtered registry', async () => {
    loadGeneratedDocumentHistory.mockResolvedValue({
      documents: [{
        id: 42,
        type: 'layeredVikLayers',
        title: 'ВИК слоев-42',
        fileName: 'vik-42.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        createdAt: '2026-09-18T10:00:00.000Z',
        updatedAt: '2026-09-18T10:00:00.000Z',
        periodFrom: '2026-09-18',
        periodTo: '2026-09-18',
        rowCount: 1,
        projects: ['Проект'],
        subtitleCodes: ['Шифр'],
        lines: ['Линия'],
      }],
      total: 1,
      filterOptions: {},
    })
    const onNavigationRequestHandled = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentsPage
          welderStamps={[]}
          navigationRequest={{
            requestId: 11,
            kind: 'generated',
            documentId: 42,
            type: 'layeredVikLayers',
            title: 'ВИК слоев-42',
          }}
          onNavigationRequestHandled={onNavigationRequestHandled}
        />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('ВИК слоев-42')).toBeInTheDocument()
    const filteredCall = loadGeneratedDocumentHistory.mock.calls.find((call) =>
      Boolean(call[0]?.columnFilters?.title),
    )
    expect(filteredCall?.[0]?.documentId).toBe(42)
    expect(parseWeldColumnChoiceFilter(filteredCall?.[0]?.columnFilters?.title ?? '')).toEqual({
      kind: 'values',
      values: ['ВИК слоев-42'],
    })
    expect(onNavigationRequestHandled).toHaveBeenCalledWith(11)
  })
})
