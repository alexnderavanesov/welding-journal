import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentsPage } from '@/components/documents-page'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { StoredDocumentTemplate } from '@/lib/document-template-storage'
import { DOCUMENT_TEMPLATE_STORAGE_EVENT } from '@/lib/document-storage-events'

const { loadTemplate, generationRows, saveDocuments, preview } = vi.hoisted(() => ({
  loadTemplate: vi.fn(), generationRows: vi.fn(), saveDocuments: vi.fn(), preview: vi.fn(),
}))

// Keep the real page, date/row filtering, naming and generation-plan grouping.
// Only RPC/file parsing and AG's browser layout are outside this unit test.
vi.mock('@/lib/document-template-storage', async original => ({
  ...await original<typeof import('@/lib/document-template-storage')>(),
  loadDocumentTemplate: loadTemplate,
  createWeldingJournalDocumentPreview: preview,
}))
vi.mock('@/server/weld-read-api', () => ({ getDocumentGenerationData: generationRows }))
vi.mock('@/components/documents-history-grid', () => ({ DocumentsHistoryGrid: () => <div data-testid="template-history-grid" /> }))
vi.mock('@/lib/use-system-document-template-availability', () => ({ useSystemDocumentTemplateAvailability: () => new Set() }))
vi.mock('@/lib/security-context', () => ({
  useAccess: () => ({ can: () => true }),
  useSecurityGuard: () => ({ requireDeletePassword: async () => true, requireDocumentGenerationPassword: async () => true }),
}))
vi.mock('@/lib/confirm-action-context', () => ({ useConfirmAction: () => async () => false }))
vi.mock('@/lib/generated-document-storage', () => ({
  saveGeneratedDocuments: saveDocuments,
  deleteGeneratedDocument: vi.fn(), downloadGeneratedDocument: vi.fn(), downloadGeneratedDocumentArchive: vi.fn(),
  loadGeneratedDocumentHistoryGrid: vi.fn(), loadGeneratedDocumentHistoryFilterOptions: vi.fn(), loadGeneratedDocumentRows: vi.fn(),
}))
vi.mock('@/lib/system-document-storage', () => ({
  createCurrentSystemDocumentBlob: vi.fn(), downloadSystemDocument: vi.fn(), loadSystemDocumentHistoryGrid: vi.fn(),
  loadSystemDocumentHistoryFilterOptions: vi.fn(), loadSystemDocumentRows: vi.fn(), createSystemDocumentPreviewRecord: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

function template(id: 'weldingJournal' | 'checklist' | 'zni', version: string, splitMode: 'project' | 'line'): StoredDocumentTemplate {
  return { id, version, fileName: `${id}-${version}.xlsx`, fileType: 'xlsx', fileSize: 1,
    uploadedAt: '2026-11-01T00:00:00.000Z', fileData: new ArrayBuffer(1), fields: [], markerCount: 0, locations: [], warnings: [],
    options: { [id]: { officialOnly: false, goodOnly: false, actualOnly: false, splitMode } } }
}

const clients: QueryClient[] = []
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><DocumentsPage welderStamps={[]} /></QueryClientProvider>)
}
const generate = () => screen.getByRole('button', { name: /^(?:Сформировать(?: \(\d+\))?|Обновляю)$/ })
const tab = (name: 'История' | 'Формирование') => fireEvent.click(screen.getByRole('tab', { name }))

describe('DocumentsPage template readiness', () => {
  beforeEach(() => {
    window.localStorage.clear(); window.sessionStorage.clear()
    loadTemplate.mockReset(); generationRows.mockReset(); saveDocuments.mockReset(); preview.mockReset()
    loadTemplate.mockResolvedValue(undefined)
    preview.mockResolvedValue(null)
    saveDocuments.mockResolvedValue([])
    const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    generationRows.mockResolvedValue({
      rows: [1, 2].map(id => ({ id, rowVersion: `v${id}`, projectTitle: 'Проект', subtitleCode: 'Шифр', line: `L${id}`,
        joint: `F${id}`, weldDate: month, officiality: 'действующий', revisionActuality: 'актуальная', wdi: 1 })) as WeldRow[],
      scopeOptions: { projects: ['Проект'], subtitles: ['Шифр'], lines: ['L1', 'L2'] },
    })
  })
  afterEach(() => { for (const client of clients.splice(0)) client.clear() })

  it('does not load a file for history, and waits for a fresh template on every entry to generation', async () => {
    const first = deferred<StoredDocumentTemplate>(), reopened = deferred<StoredDocumentTemplate>()
    loadTemplate.mockReturnValueOnce(first.promise).mockReturnValueOnce(reopened.promise)
    open()
    expect(screen.getByTestId('template-history-grid')).toBeVisible()
    expect(loadTemplate).not.toHaveBeenCalled()
    act(() => window.dispatchEvent(new Event(DOCUMENT_TEMPLATE_STORAGE_EVENT)))
    expect(loadTemplate).not.toHaveBeenCalled()
    tab('Формирование')
    await waitFor(() => expect(generationRows).toHaveBeenCalledTimes(1))
    expect(loadTemplate).toHaveBeenCalledWith('weldingJournal')
    expect(generate()).toBeDisabled()
    fireEvent.click(generate())
    expect(saveDocuments).not.toHaveBeenCalled()
    await act(async () => first.resolve(template('weldingJournal', 'first', 'project')))
    await waitFor(() => expect(generate()).toBeEnabled())
    expect(generate()).toHaveTextContent(/^Сформировать$/)
    tab('История')
    act(() => window.dispatchEvent(new Event(DOCUMENT_TEMPLATE_STORAGE_EVENT)))
    expect(loadTemplate).toHaveBeenCalledTimes(1)
    tab('Формирование')
    expect(loadTemplate).toHaveBeenCalledTimes(2)
    expect(generate()).toBeDisabled()
    await act(async () => reopened.resolve(template('weldingJournal', 'reopened', 'line')))
    await waitFor(() => expect(generate()).toBeEnabled())
    expect(generate()).toHaveTextContent('Сформировать (2)')
    fireEvent.click(generate())
    await waitFor(() => expect(saveDocuments).toHaveBeenCalledTimes(1))
    expect(saveDocuments.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: 'weldingJournal', weldJointIds: [1] }),
      expect.objectContaining({ type: 'weldingJournal', weldJointIds: [2] }),
    ])
  })

  it('cannot generate a new document type using the previous template while its own file is still loading', async () => {
    const checklist = deferred<StoredDocumentTemplate>(), zni = deferred<StoredDocumentTemplate>()
    loadTemplate.mockImplementation((id: string) => id === 'checklist' ? checklist.promise : id === 'zni' ? zni.promise
      : Promise.resolve(template('weldingJournal', 'journal', 'project')))
    open(); tab('Формирование')
    await waitFor(() => expect(generate()).toBeEnabled())
    expect(generate()).toHaveTextContent(/^Сформировать$/)
    fireEvent.click(screen.getByRole('button', { name: 'Чек-лист' }))
    await waitFor(() => expect(loadTemplate).toHaveBeenCalledWith('checklist'))
    // The row query is already warm: file readiness, not row loading, must
    // guard this change. The old default project split would save one file.
    expect(generate()).toBeDisabled()
    fireEvent.click(generate())
    expect(saveDocuments).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'ЗНИ' }))
    await waitFor(() => expect(loadTemplate).toHaveBeenCalledWith('zni'))
    await act(async () => checklist.resolve(template('checklist', 'late', 'project')))
    expect(generate()).toBeDisabled()
    expect(screen.queryByText('checklist-late.xlsx')).not.toBeInTheDocument()
    await act(async () => zni.resolve(template('zni', 'current', 'line')))
    await waitFor(() => expect(generate()).toBeEnabled())
    expect(generate()).toHaveTextContent('Сформировать (2)')
    fireEvent.click(generate())
    await waitFor(() => expect(saveDocuments).toHaveBeenCalledTimes(1))
    expect(saveDocuments.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: 'zni', weldJointIds: [1] }),
      expect.objectContaining({ type: 'zni', weldJointIds: [2] }),
    ])
  })

  it('does not let an older template notification response overwrite the latest loaded options', async () => {
    const older = deferred<StoredDocumentTemplate>(), newer = deferred<StoredDocumentTemplate>()
    loadTemplate.mockResolvedValueOnce(template('weldingJournal', 'initial', 'project'))
      .mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    open(); tab('Формирование')
    await waitFor(() => expect(generate()).toBeEnabled())
    act(() => window.dispatchEvent(new Event(DOCUMENT_TEMPLATE_STORAGE_EVENT)))
    expect(generate()).toBeDisabled()
    act(() => window.dispatchEvent(new Event(DOCUMENT_TEMPLATE_STORAGE_EVENT)))
    await act(async () => newer.resolve(template('weldingJournal', 'newer', 'line')))
    await waitFor(() => expect(generate()).toBeEnabled())
    expect(generate()).toHaveTextContent('Сформировать (2)')
    await act(async () => older.resolve(template('weldingJournal', 'older', 'project')))
    expect(screen.getByText('weldingJournal-newer.xlsx')).toBeInTheDocument()
    expect(generate()).toHaveTextContent('Сформировать (2)')
    fireEvent.click(generate())
    await waitFor(() => expect(saveDocuments).toHaveBeenCalledTimes(1))
    expect(saveDocuments.mock.calls[0][0]).toHaveLength(2)
  })

  it('keeps the built-in form available when the completed read confirms that no custom template exists', async () => {
    loadTemplate.mockResolvedValue(undefined)
    open(); tab('Формирование')
    await waitFor(() => expect(generate()).toBeEnabled())
    expect(screen.getByText('Системная форма')).toBeInTheDocument()
    fireEvent.click(generate())
    await waitFor(() => expect(saveDocuments).toHaveBeenCalledTimes(1))
    expect(saveDocuments.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: 'weldingJournal', weldJointIds: [1, 2] }),
    ])
  })

  it('falls back after a rejected template read and retries the current file on the next entry', async () => {
    const failed = deferred<StoredDocumentTemplate>()
    loadTemplate.mockReturnValueOnce(failed.promise).mockResolvedValueOnce(template('weldingJournal', 'recovered', 'line'))
    open(); tab('Формирование')
    await waitFor(() => expect(generationRows).toHaveBeenCalledTimes(1))
    expect(generate()).toBeDisabled()
    fireEvent.click(generate())
    expect(saveDocuments).not.toHaveBeenCalled()
    await act(async () => failed.reject(new Error('Template read failed')))
    await waitFor(() => expect(generate()).toBeEnabled())
    expect(screen.getByText('Системная форма')).toBeInTheDocument()
    expect(generate()).toHaveTextContent(/^Сформировать$/)
    fireEvent.click(generate())
    await waitFor(() => expect(saveDocuments).toHaveBeenCalledTimes(1))
    expect(saveDocuments.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: 'weldingJournal', weldJointIds: [1, 2],
        expectedVersions: [{ id: 1, version: 'v1' }, { id: 2, version: 'v2' }] }),
    ])
    tab('История'); tab('Формирование')
    await waitFor(() => expect(generate()).toBeEnabled())
    expect(loadTemplate).toHaveBeenCalledTimes(2)
    expect(screen.getByText('weldingJournal-recovered.xlsx')).toBeInTheDocument()
    expect(generate()).toHaveTextContent('Сформировать (2)')
  })

  it('releases template notifications on unmount and ignores the old pending file after reopening', async () => {
    const abandoned = deferred<StoredDocumentTemplate>(), reopened = deferred<StoredDocumentTemplate>()
    loadTemplate.mockReturnValueOnce(abandoned.promise).mockReturnValueOnce(reopened.promise)
    const first = open(); tab('Формирование')
    await waitFor(() => expect(generationRows).toHaveBeenCalledTimes(1))
    expect(generate()).toBeDisabled()
    first.unmount()
    act(() => window.dispatchEvent(new Event(DOCUMENT_TEMPLATE_STORAGE_EVENT)))
    expect(loadTemplate).toHaveBeenCalledTimes(1)
    open()
    expect(screen.getByTestId('template-history-grid')).toBeVisible()
    expect(loadTemplate).toHaveBeenCalledTimes(1)
    tab('Формирование')
    expect(loadTemplate).toHaveBeenCalledTimes(2)
    await act(async () => abandoned.resolve(template('weldingJournal', 'abandoned', 'project')))
    expect(generate()).toBeDisabled()
    expect(screen.queryByText('weldingJournal-abandoned.xlsx')).not.toBeInTheDocument()
    expect(preview).not.toHaveBeenCalled()
    expect(saveDocuments).not.toHaveBeenCalled()
    await act(async () => reopened.resolve(template('weldingJournal', 'fresh', 'line')))
    await waitFor(() => expect(generate()).toBeEnabled())
    expect(screen.getByText('weldingJournal-fresh.xlsx')).toBeInTheDocument()
    expect(generate()).toHaveTextContent('Сформировать (2)')
    fireEvent.click(generate())
    await waitFor(() => expect(saveDocuments).toHaveBeenCalledTimes(1))
    expect(saveDocuments.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: 'weldingJournal', weldJointIds: [1] }),
      expect.objectContaining({ type: 'weldingJournal', weldJointIds: [2] }),
    ])
  })
})
