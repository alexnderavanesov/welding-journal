import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { DocumentsPage } from '@/components/documents-page'
import type { DocumentHistoryGridRequest, DocumentHistoryGridResult } from '@/lib/document-history-grid'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'

const { getDocumentGenerationData, loadGeneratedDocumentHistoryGrid, loadSystemDocumentHistoryGrid,
  loadGeneratedDocumentHistoryFilterOptions, loadSystemDocumentHistoryFilterOptions, downloadGeneratedDocument } = vi.hoisted(() => ({
  getDocumentGenerationData: vi.fn(),
  loadGeneratedDocumentHistoryGrid: vi.fn(),
  loadSystemDocumentHistoryGrid: vi.fn(),
  loadGeneratedDocumentHistoryFilterOptions: vi.fn(),
  loadSystemDocumentHistoryFilterOptions: vi.fn(),
  downloadGeneratedDocument: vi.fn(),
}))

// Exercise the page-to-server request contract without AG Grid's browser layout.
// Facet interaction, selection and virtual scrolling are covered by the grid tests.
vi.mock('@/components/documents-history-grid', async () => {
  const { useEffect, useRef, useState } = await import('react')
  type Record = { id: string | number; title: string }
  type Props = {
    viewId: string
    sourceRevision: string | number
    columnFilters: { [key: string]: string }
    loadRows: (request: DocumentHistoryGridRequest) => Promise<DocumentHistoryGridResult<Record>>
    onTotalChange?: (total: number) => void
    renderActions?: (row: Record) => ReactNode
  }
  return {
    DocumentsHistoryGrid: function GridRequestHarness(props: Props) {
      const callbacks = useRef(props)
      callbacks.current = props
      const [rows, setRows] = useState<Record[]>([])
      const [loaded, setLoaded] = useState(false)
      const filters = JSON.stringify(props.columnFilters)
      useEffect(() => {
        let disposed = false
        setLoaded(false)
        void callbacks.current.loadRows({ startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }).then(result => {
          if (disposed) return
          setRows(result.rows.filter((row): row is Record => !('__group' in row)))
          setLoaded(true)
          callbacks.current.onTotalChange?.(result.total)
        })
        return () => { disposed = true }
      }, [props.viewId, props.sourceRevision, filters])
      return <div data-testid="document-history-grid" aria-busy={!loaded}>
        {rows.map(row => <div key={row.id}><span>{row.title}</span>{props.renderActions?.(row)}</div>)}
      </div>
    },
  }
})

vi.mock('@/server/weld-read-api', () => ({
  getDocumentGenerationData,
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
  loadSystemDocumentHistoryGrid,
  loadSystemDocumentHistoryFilterOptions,
  loadSystemDocumentRows: vi.fn(),
  renameSystemDocumentToCurrentName: vi.fn(),
}))

vi.mock('@/lib/generated-document-storage', () => ({
  deleteGeneratedDocument: vi.fn(),
  downloadGeneratedDocument,
  downloadGeneratedDocumentArchive: vi.fn(),
  loadGeneratedDocumentHistoryGrid,
  loadGeneratedDocumentHistoryFilterOptions,
  loadGeneratedDocumentRows: vi.fn(),
}))

describe('DocumentsPage report navigation', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    getDocumentGenerationData.mockReset()
    getDocumentGenerationData.mockResolvedValue({
      rows: [],
      scopeOptions: { projects: [], subtitles: [], lines: [] },
    })
    loadGeneratedDocumentHistoryGrid.mockReset()
    loadGeneratedDocumentHistoryGrid.mockResolvedValue({ rows: [], rowCount: 0, total: 0 })
    loadSystemDocumentHistoryGrid.mockReset()
    loadSystemDocumentHistoryGrid.mockResolvedValue({ rows: [], rowCount: 0, total: 0 })
    loadGeneratedDocumentHistoryFilterOptions.mockReset()
    loadGeneratedDocumentHistoryFilterOptions.mockResolvedValue({ options: [], hasMore: false })
    loadSystemDocumentHistoryFilterOptions.mockReset()
    loadSystemDocumentHistoryFilterOptions.mockResolvedValue({ options: [], hasMore: false })
    downloadGeneratedDocument.mockReset()
  })

  it('shows a failed Excel download and lets the operator retry without losing the registry', async () => {
    loadGeneratedDocumentHistoryGrid.mockResolvedValue({
      rows: [{ id: 8, title: 'ЖСР для повторного скачивания', rowCount: 2 }], rowCount: 1, total: 1,
    })
    downloadGeneratedDocument.mockRejectedValueOnce(new Error('Файл временно недоступен')).mockResolvedValue(undefined)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><DocumentsPage welderStamps={[]} /></QueryClientProvider>)
    const download = await screen.findByTitle('Скачать Excel')
    fireEvent.click(download)
    await expect(screen.findByRole('alert')).resolves.toHaveTextContent('Файл временно недоступен')
    expect(screen.getByText('ЖСР для повторного скачивания')).toBeInTheDocument()
    fireEvent.click(download)
    await waitFor(() => expect(downloadGeneratedDocument).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(loadGeneratedDocumentHistoryGrid).toHaveBeenCalledTimes(1)
  })

  it('loads generation rows only after the user opens the generation tab', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentsPage welderStamps={[]} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('document-history-grid')).toHaveAttribute('aria-busy', 'false'))
    expect(loadGeneratedDocumentHistoryGrid).toHaveBeenCalledTimes(1)
    expect(loadGeneratedDocumentHistoryFilterOptions).not.toHaveBeenCalled()
    expect(loadSystemDocumentHistoryFilterOptions).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Перейти к формированию' })).toBeInTheDocument()
    expect(screen.getByText('Общие')).toBeInTheDocument()
    expect(screen.getByText('ЛНК')).toBeInTheDocument()
    expect(screen.getByText('ПСТО и ТВМТ')).toBeInTheDocument()
    expect(screen.getByText('Послойный контроль')).toBeInTheDocument()
    expect(getDocumentGenerationData).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: 'Формирование' }))

    await waitFor(() => expect(getDocumentGenerationData).toHaveBeenCalledTimes(1))
  })

  it('loads the selected document through the title filter on the first request', async () => {
    loadSystemDocumentHistoryGrid.mockResolvedValue({
      rows: [{
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
      rowCount: 1,
      total: 1,
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
    await waitFor(() => expect(loadSystemDocumentHistoryGrid).toHaveBeenCalledTimes(1))
    expect(loadGeneratedDocumentHistoryGrid).not.toHaveBeenCalled()
    const request = loadSystemDocumentHistoryGrid.mock.calls[0]?.[0]
    expect(request).toMatchObject({ startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] })
    expect(request?.type).toBe('pstoRequest')
    expect(request?.documentId).toBe(77)
    expect(parseWeldColumnChoiceFilter(request?.columnFilters?.title ?? '')).toEqual({
      kind: 'values',
      values: ['Заявка ПСТО-77'],
    })
    expect(onNavigationRequestHandled).toHaveBeenCalledWith(10)
  })

  it('opens a generated document from the journal in its filtered registry', async () => {
    loadGeneratedDocumentHistoryGrid.mockResolvedValue({
      rows: [{
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
      rowCount: 1,
      total: 1,
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
    await waitFor(() => expect(loadGeneratedDocumentHistoryGrid).toHaveBeenCalledTimes(1))
    expect(loadSystemDocumentHistoryGrid).not.toHaveBeenCalled()
    const request = loadGeneratedDocumentHistoryGrid.mock.calls[0]?.[0]
    expect(request).toMatchObject({ documentId: 42, types: ['layeredVikEdges', 'layeredVikLayers'], startRow: 0, endRow: 100 })
    expect(parseWeldColumnChoiceFilter(request?.columnFilters?.title ?? '')).toEqual({
      kind: 'values',
      values: ['ВИК слоев-42'],
    })
    expect(onNavigationRequestHandled).toHaveBeenCalledWith(11)
  })
})
