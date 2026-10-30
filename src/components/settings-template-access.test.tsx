import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsPage } from './settings-page'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'

const mocks = vi.hoisted(() => ({ permissions: [] as string[], inventory: vi.fn(), remove: vi.fn(), reset: vi.fn() }))
vi.mock('@/lib/security-context', () => ({
  useAccess: () => ({ can: (permission: string) => mocks.permissions.includes(permission) }),
  useSecurityGuard: () => ({ requireSettingsChangePassword: async () => mocks.permissions.includes('templates.edit'), requireDeletePassword: async () => false }),
}))
vi.mock('@/lib/document-template-storage', async importOriginal => ({
  ...await importOriginal<object>(), loadDocumentTemplateInventory: mocks.inventory, deleteDocumentTemplate: mocks.remove,
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
