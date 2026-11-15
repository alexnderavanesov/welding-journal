import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsPage } from './settings-page'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'

const mocks = vi.hoisted(() => ({ permissions: [] as string[], inventory: vi.fn(), load: vi.fn(), remove: vi.fn(), reset: vi.fn(), options: vi.fn() }))
vi.mock('@/lib/security-context', () => ({
  useAccess: () => ({ can: (permission: string) => mocks.permissions.includes(permission) }),
  useSecurityGuard: () => ({ requireSettingsChangePassword: async () => mocks.permissions.includes('templates.edit'), requireDeletePassword: async () => false }),
}))
vi.mock('@/lib/document-template-storage', async importOriginal => ({
  ...await importOriginal<object>(), loadDocumentTemplateInventory: mocks.inventory, loadDocumentTemplate: mocks.load, deleteDocumentTemplate: mocks.remove, updateDocumentTemplateOptions: mocks.options,
}))
vi.mock('@/lib/generated-document-storage', async importOriginal => ({
  ...await importOriginal<object>(), loadGeneratedDocumentSequence: async () => ({ nextNumber: 7 }), resetGeneratedDocumentSequence: mocks.reset,
}))
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  window.history.replaceState(null, '', '/settings')
  mocks.inventory.mockResolvedValue({ templates: { weldingJournal: { id: 'weldingJournal', fileName: 'template.xlsx', fileType: 'xlsx', fileSize: 20, fileData: new ArrayBuffer(0), version: 'revision', uploadedAt: '2026-10-30' } }, missing: {}, storageWarnings: {} })
  mocks.remove.mockResolvedValue({})
  mocks.reset.mockResolvedValue({ nextNumber: 1 })
})
afterEach(cleanup)
async function mount(permissions: string[]) {
  mocks.permissions = ['templates.view', ...permissions]
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ConfirmActionProvider><SettingsPage /></ConfirmActionProvider></QueryClientProvider>)
  await screen.findByText('template.xlsx')
  fireEvent.click(screen.getByLabelText('Управление файлом шаблона'))
}
it('view alone can switch templates and inspect the file, while mutation controls stay disabled', async () => {
  await mount([])
  expect(screen.getByRole('button', { name: /Скачать шаблон/ })).toBeEnabled()
  expect(screen.getByRole('button', { name: /Заменить файл шаблона/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /Удалить шаблон/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeDisabled()
  const checklist = screen.getByRole('button', { name: /^Чек-лист/ })
  expect(checklist).toBeEnabled()
  fireEvent.click(checklist)
  await screen.findByRole('button', { name: 'Загрузить первый шаблон' })
})
it('template deletion uses its own permission without edit or welding deletion', async () => {
  await mount(['templates.delete'])
  fireEvent.click(screen.getByRole('button', { name: /Удалить шаблон/ }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Удалить шаблон' }))
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('weldingJournal', 'revision'))
})
it('template editing does not grant deletion or numbering changes', async () => {
  await mount(['templates.edit'])
  expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeEnabled()
  expect(screen.getByRole('button', { name: /Удалить шаблон/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Обнулить счетчик' })).toBeDisabled()
})
it('numbering permission allows its own reset without template editing', async () => {
  await mount(['numbering.view', 'numbering.edit'])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Обнулить счетчик' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Обнулить счетчик' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Обнулить счетчик' }))
  await waitFor(() => expect(mocks.reset).toHaveBeenCalledWith('weldingJournal'))
})

it('stages document options, retains failed changes and keeps other document drafts when one is saved', async () => {
  const template = { fileName: 'template.xlsx', fileType: 'xlsx', fileSize: 20, fileData: new ArrayBuffer(0), version: 'revision', uploadedAt: '2026-10-30' }
  const templates = { weldingJournal: { ...template, id: 'weldingJournal' }, checklist: { ...template, id: 'checklist', fileName: 'checklist.xlsx' } }
  mocks.inventory.mockResolvedValue({ templates, missing: {}, storageWarnings: {} })
  await mount(['templates.edit'])
  const options = () => screen.getByRole('checkbox', { name: /Учет официальных стыков/ })
  fireEvent.click(options())
  expect(mocks.options).not.toHaveBeenCalled()
  const tab = screen.getByRole('button', { name: 'Документы' })
  expect(within(tab).getByLabelText('Есть несохранённые изменения')).toBeVisible()
  mocks.options.mockRejectedValueOnce(new Error('Ошибка сети'))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить параметры документа' }))
  await screen.findByText('Ошибка сети')
  expect(screen.getByRole('button', { name: 'Сохранить параметры документа' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: /^Чек-лист/ }))
  fireEvent.click(options())
  mocks.options.mockImplementationOnce(async (_id, values) => ({ ...templates.checklist, options: values.checklist, version: 'new-revision' }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить параметры документа' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранить параметры документа' })).not.toBeInTheDocument())
  expect(within(tab).getByLabelText('Есть несохранённые изменения')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /^ЖСР/ }))
  expect(screen.getByRole('button', { name: 'Сохранить параметры документа' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить изменения' }))
  await waitFor(() => expect(within(tab).queryByLabelText('Есть несохранённые изменения')).not.toBeInTheDocument())
})


const summary = (id: 'weldingJournal' | 'checklist') => ({ id, fileName: `${id}.xlsx`, fileType: 'xlsx', fileSize: 256 * 1024, version: 'revision', uploadedAt: '2026-11-14', fields: [], markerCount: 0, locations: [], warnings: [] })
function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function mountSummaries() {
  mocks.permissions = ['templates.view', 'templates.edit']
  mocks.inventory.mockResolvedValue({ templates: { weldingJournal: summary('weldingJournal'), checklist: summary('checklist') }, missing: {}, storageWarnings: {} })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ConfirmActionProvider><SettingsPage /></ConfirmActionProvider></QueryClientProvider>)
  await screen.findByText('weldingJournal.xlsx')
}

it('shows metadata immediately, loads only the selected file and reuses it when switching back', async () => {
  const first = pending<ReturnType<typeof summary> & { fileData: ArrayBuffer }>()
  mocks.load.mockReturnValue(first.promise)
  await mountSummaries()
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith('weldingJournal')
  expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: /Учет официальных стыков/ })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Загрузить первый шаблон' })).not.toBeInTheDocument()
  await act(async () => first.resolve({ ...summary('weldingJournal'), fileData: new ArrayBuffer(2) }))
  expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeEnabled()
  mocks.load.mockResolvedValueOnce({ ...summary('checklist'), fileData: new ArrayBuffer(3) })
  fireEvent.click(screen.getByRole('button', { name: /^Чек-лист/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: /^ЖСР/ }))
  expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeEnabled()
  expect(mocks.load.mock.calls).toEqual([['weldingJournal'], ['checklist']])
  expect(mocks.inventory).toHaveBeenCalledOnce()
})

it('ignores a late file reply after selecting a different template', async () => {
  const first = pending<ReturnType<typeof summary> & { fileData: ArrayBuffer }>()
  const second = pending<ReturnType<typeof summary> & { fileData: ArrayBuffer }>()
  mocks.load.mockImplementation(id => id === 'weldingJournal' ? first.promise : second.promise)
  await mountSummaries()
  fireEvent.click(screen.getByRole('button', { name: /^Чек-лист/ }))
  await act(async () => first.resolve({ ...summary('weldingJournal'), fileData: new ArrayBuffer(2) }))
  expect(screen.getByText('checklist.xlsx')).toBeVisible()
  expect(screen.queryByText('weldingJournal.xlsx')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeDisabled()
  await act(async () => second.resolve({ ...summary('checklist'), fileData: new ArrayBuffer(3) }))
  expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeEnabled()
})

it('keeps a file error distinct from missing metadata and only retries explicitly', async () => {
  mocks.load.mockRejectedValue(new Error('Хранилище недоступно'))
  await mountSummaries()
  await screen.findByText('Хранилище недоступно')
  expect(screen.getByText('weldingJournal.xlsx')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Загрузить первый шаблон' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeDisabled()
  expect(mocks.load).toHaveBeenCalledOnce()
  mocks.load.mockResolvedValueOnce({ ...summary('weldingJournal'), fileData: new ArrayBuffer(2) })
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку файла' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Открыть конструктор' })).toBeEnabled())
  expect(mocks.load).toHaveBeenCalledTimes(2)
})

it('retains an option draft but prevents saving it if the selected file reports a newer version', async () => {
  const first = pending<ReturnType<typeof summary> & { fileData: ArrayBuffer }>()
  mocks.load.mockReturnValue(first.promise)
  await mountSummaries()
  fireEvent.click(screen.getByRole('checkbox', { name: /Учет официальных стыков/ }))
  expect(screen.getByRole('button', { name: 'Сохранить параметры документа' })).toBeEnabled()
  await act(async () => first.resolve({ ...summary('weldingJournal'), version: 'new-version', fileData: new ArrayBuffer(2) }))
  expect(screen.getByRole('checkbox', { name: /Учет официальных стыков/ })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Сохранить параметры документа' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Сбросить изменения' })).toBeEnabled()
  expect(mocks.options).not.toHaveBeenCalled()
})

it('does not replace a just-saved template with an earlier file reply in the same React batch', async () => {
  const file = pending<ReturnType<typeof summary> & { fileData: ArrayBuffer }>()
  const saved = { ...summary('weldingJournal'), version: 'saved-version', fileData: new ArrayBuffer(3), options: { weldingJournal: { officialOnly: true } } }
  const save = pending<typeof saved>()
  mocks.load.mockReturnValue(file.promise)
  mocks.options.mockReturnValue(save.promise)
  await mountSummaries()
  fireEvent.click(screen.getByRole('checkbox', { name: /Учет официальных стыков/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить параметры документа' }))
  await waitFor(() => expect(mocks.options).toHaveBeenCalledOnce())
  await act(async () => {
    save.resolve(saved)
    // Queue the save state first, then the older file state before effects run.
    await Promise.resolve()
    file.resolve({ ...summary('weldingJournal'), fileData: new ArrayBuffer(2) })
    await Promise.resolve()
  })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранить параметры документа' })).not.toBeInTheDocument())
  expect(screen.getByRole('checkbox', { name: /Учет официальных стыков/ })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: /Учет официальных стыков/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить параметры документа' }))
  await waitFor(() => expect(mocks.options).toHaveBeenLastCalledWith('weldingJournal', expect.any(Object), 'saved-version'))
})
