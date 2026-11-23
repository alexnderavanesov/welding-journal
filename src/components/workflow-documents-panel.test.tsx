import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowManagerViews, useWorkflowManagerView } from './workflow-manager-views'
import { LNK_CONCLUSION_DOCUMENTS } from '@/lib/workflow-document-choices'
import type { SystemDocumentReference } from '@/lib/system-document-types'

const mocks = vi.hoisted(() => ({ list: vi.fn(), context: vi.fn(), change: vi.fn(), confirm: vi.fn(), password: vi.fn(), can: vi.fn() }))
vi.mock('@/lib/system-document-storage', () => ({ loadWorkflowDocumentHistoryGrid: mocks.list, loadSystemDocumentDateContext: mocks.context }))
vi.mock('@/lib/security-context', () => ({ useAccess: () => ({ can: mocks.can }), useSecurityGuard: () => ({ requireEditPassword: mocks.password }) }))
vi.mock('@/lib/confirm-action-context', () => ({ useConfirmAction: () => mocks.confirm }))
vi.mock('@/server/weld-mutations-api', () => ({ changeSystemDocumentDate: mocks.change }))
const reference: SystemDocumentReference = { documentId: 7, type: 'lnkConclusion', title: 'Общее заключение', date: '2026-08-10', methodCode: 'ВИК' }
function Harness({ references }: { references?: SystemDocumentReference[] }) {
  const view = useWorkflowManagerView()
  return <WorkflowManagerViews view={view} documents={{ choices: LNK_CONCLUSION_DOCUMENTS, references, onOpenJournalRows: vi.fn() }}>
    <input aria-label="Черновик результата" defaultValue="" />
    <button onClick={() => view.openDocument(reference)}>К документу</button>
  </WorkflowManagerViews>
}
function mount(references?: SystemDocumentReference[]) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Harness references={references} /></QueryClientProvider>)
}
describe('Workflow document tab', () => {
  beforeEach(() => {
    mocks.can.mockReset().mockReturnValue(true)
    mocks.change.mockReset()
    mocks.confirm.mockReset().mockResolvedValue(true)
    mocks.password.mockReset().mockResolvedValue(true)
    mocks.list.mockReset().mockResolvedValue({ rows: [reference], total: 51 })
    mocks.context.mockReset().mockResolvedValue({ rows: [1, 2, 3].map(id => ({ id, line: 'L', joint: `F${id}`, vikConclusion: reference.title, vikConclusionDate: reference.date })), sourcePositions: [] })
  })
  it('loads only on demand, shares a single full composition read and retains drafts between tabs', async () => {
    mount()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.context).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Черновик результата'), { target: { value: 'ремонт' } })
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    const name = await screen.findByLabelText('Название документа')
    await waitFor(() => expect(name).toBeEnabled())
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.context).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: 'Полный состав документа' })).toHaveTextContent('F3')
    fireEvent.change(name, { target: { value: 'Новое общее имя' } })
    expect(screen.getByRole('button', { name: 'Сохранить изменения документа' })).toBeEnabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Стыки' }))
    expect(screen.getByLabelText('Черновик результата')).toHaveValue('ремонт')
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    expect(name).toHaveValue('Новое общее имя')
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.context).toHaveBeenCalledTimes(1)
  })
  it('view-only workflow users can read their composition without opening metadata edits or journal actions', async () => {
    mocks.can.mockImplementation((permission: string) => permission === 'lnk.view')
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Полный состав документа' })).toHaveTextContent('F3'))
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ workflowArea: 'lnk' }))
    expect(screen.getByRole('button', { name: 'Редактировать' })).toBeDisabled()
    expect(screen.queryByLabelText('Название документа')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Связи документов' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Показать стык в журнале' })).not.toBeInTheDocument()
    expect(mocks.change).not.toHaveBeenCalled()
  })
  it('requests the next bounded page from the server instead of filtering only the loaded joints', async () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1))
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ startRow: 0, endRow: 50, columnFilters: { stage: expect.any(String) } }))
    fireEvent.click(await screen.findByRole('button', { name: 'Следующая страница документов' }))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ startRow: 50, endRow: 100 }))
    // The selected document is retained while paging the registry: no N+1 composition reads.
    expect(mocks.context).toHaveBeenCalledTimes(1)
  })
  it('opens the requested document again after selecting another document in its tab', async () => {
    const other = { ...reference, documentId: 8, title: 'Другое заключение' }
    mocks.list.mockResolvedValue({ rows: [reference, other], total: 2 })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    expect(await screen.findByRole('heading', { name: reference.title })).toBeVisible()
    fireEvent.click(await within(screen.getByRole('complementary')).findByRole('button', { name: /Другое заключение/ }))
    expect(screen.getByRole('heading', { name: other.title })).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Стыки' }))
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    expect(await screen.findByRole('heading', { name: reference.title })).toBeVisible()
    expect(screen.queryByRole('heading', { name: other.title })).not.toBeInTheDocument()
  })
  it('retains the initially displayed document and its draft when a refreshed list changes order', async () => {
    const other = { ...reference, documentId: 8, title: 'Другое заключение' }
    mocks.list.mockResolvedValueOnce({ rows: [reference, other], total: 2 })
      .mockResolvedValue({ rows: [other, reference], total: 2 })
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    expect(await screen.findByRole('heading', { name: reference.title })).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Редактировать' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
    const name = await screen.findByLabelText('Название документа')
    await waitFor(() => expect(name).toBeEnabled())
    fireEvent.change(name, { target: { value: 'Несохранённое имя' } })
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(screen.getByRole('complementary')).getAllByRole('button', { name: /заключение/ })[0]).toHaveTextContent(other.title))
    expect(screen.getByRole('heading', { name: reference.title })).toBeVisible()
    expect(screen.getByLabelText('Название документа')).toHaveValue('Несохранённое имя')
    expect(mocks.context).toHaveBeenCalledTimes(1)
  })
  it('opens only the requested editor and keeps ordinary document selections in view mode', async () => {
    const other = { ...reference, documentId: 8, title: 'Другое заключение' }
    mocks.list.mockResolvedValue({ rows: [reference, other], total: 2 })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    expect(await screen.findByLabelText('Название документа')).toBeVisible()
    fireEvent.click(await within(screen.getByRole('complementary')).findByRole('button', { name: /Другое заключение/ }))
    expect(screen.getByRole('heading', { name: other.title })).toBeVisible()
    expect(screen.queryByLabelText('Название документа')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Редактировать' })).toBeVisible()
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /Общее заключение/ }))
    expect(screen.queryByLabelText('Название документа')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Редактировать' })).toBeVisible()
  })
  it('reopens the same requested editor after folding without resetting its draft', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    const name = await screen.findByLabelText('Название документа')
    await waitFor(() => expect(name).toBeEnabled())
    fireEvent.change(name, { target: { value: 'Несохранённое имя' } })
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть редактирование' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Стыки' }))
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    expect(name).toBeVisible()
    expect(name).toHaveValue('Несохранённое имя')
    expect(mocks.context).toHaveBeenCalledTimes(1)
  })
  it('limits an explicit joint selection without querying unrelated documents', async () => {
    mount([reference, reference])
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    expect(await screen.findByText('Документы выбранных стыков')).toBeVisible()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(within(screen.getByRole('complementary')).getAllByRole('button', { name: /Общее заключение/ })).toHaveLength(1)
  })
  it.each(['cancel', 'error', 'success'])('blocks joint editing by pointer and keyboard until a document save finishes with %s', async outcome => {
    let finish!: (value: unknown) => void
    let fail!: (error: Error) => void
    const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject })
    if (outcome === 'cancel') mocks.confirm.mockReturnValueOnce(pending)
    else mocks.change.mockReturnValueOnce(pending)
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    const name = await screen.findByLabelText('Название документа')
    await waitFor(() => expect(name).toBeEnabled())
    fireEvent.change(name, { target: { value: 'Сохранённое имя' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения документа' }))
    await waitFor(() => expect(outcome === 'cancel' ? mocks.confirm : mocks.change).toHaveBeenCalledTimes(1))
    const jointsTab = screen.getByRole('tab', { name: 'Стыки' })
    const documentsTab = screen.getByRole('tab', { name: 'Документы' })
    expect(jointsTab).toBeDisabled()
    fireEvent.click(jointsTab)
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home']) fireEvent.keyDown(documentsTab, { key })
    expect(documentsTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Черновик результата')).not.toBeVisible()
    await act(async () => {
      if (outcome === 'cancel') finish(false)
      else if (outcome === 'error') fail(new Error('Состав документа изменился'))
      else finish({
        nextReference: { ...reference, title: 'Сохранённое имя' }, nextTitle: 'Сохранённое имя', nextDate: reference.date,
        previousTitle: reference.title, previousDate: reference.date, rowCount: 3, positionCount: 3,
        rows: [1, 2, 3].map(id => ({ id, vikConclusion: 'Сохранённое имя', vikConclusionDate: reference.date })),
      })
    })
    await waitFor(() => expect(jointsTab).toBeEnabled())
    if (outcome === 'cancel') expect(mocks.change).not.toHaveBeenCalled()
    fireEvent.keyDown(documentsTab, { key: 'Home' })
    expect(jointsTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Черновик результата')).toBeVisible()
  })
  it('keeps a newly selected document when a refresh for the previous selection finishes', async () => {
    const other = { ...reference, documentId: 8, title: 'Другое заключение' }
    let finishRefresh!: (result: unknown) => void
    mocks.list.mockResolvedValueOnce({ rows: [reference, other], total: 2 })
      .mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    const name = await screen.findByLabelText('Название документа')
    await waitFor(() => expect(name).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /Другое заключение/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Редактировать' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
    const otherName = await screen.findByLabelText('Название документа')
    await waitFor(() => expect(otherName).toBeEnabled())
    fireEvent.change(otherName, { target: { value: 'Несохранённое имя B' } })
    await act(async () => finishRefresh({ rows: [reference, other], total: 2 }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Обновить список' })).toBeEnabled())
    expect(screen.getByRole('heading', { name: other.title })).toBeVisible()
    expect(screen.getByLabelText('Название документа')).toHaveValue('Несохранённое имя B')
  })
  it('keeps another document selectable while preventing a second edit until an earlier save completes', async () => {
    const other = { ...reference, documentId: 8, title: 'Другое заключение' }
    mocks.list.mockResolvedValue({ rows: [reference, other], total: 2 })
    let finishSave!: (result: unknown) => void
    mocks.change.mockImplementation(() => new Promise(resolve => { finishSave = resolve }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'К документу' }))
    const name = await screen.findByLabelText('Название документа')
    await waitFor(() => expect(name).toBeEnabled())
    fireEvent.change(name, { target: { value: 'Сохранённое имя A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения документа' }))
    await waitFor(() => expect(mocks.change).toHaveBeenCalledTimes(1))
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /Другое заключение/ }))
    expect(screen.getByRole('heading', { name: other.title })).toBeVisible()
    expect(screen.queryByLabelText('Название документа')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Редактировать' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Стыки' })).toBeDisabled()
    await act(async () => finishSave({
      nextReference: { ...reference, title: 'Сохранённое имя A' }, nextTitle: 'Сохранённое имя A', nextDate: reference.date,
      previousTitle: reference.title, previousDate: reference.date, rowCount: 3, positionCount: 3,
      rows: [1, 2, 3].map(id => ({ id, vikConclusion: 'Сохранённое имя A', vikConclusionDate: reference.date })),
    }))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Стыки' })).toBeEnabled())
    expect(screen.getByRole('heading', { name: other.title })).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Редактировать' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
    const otherName = await screen.findByLabelText('Название документа')
    expect(otherName).toBeEnabled()
    expect(otherName).toHaveValue(other.title)
    expect(mocks.change).toHaveBeenCalledTimes(1)
  })
})
