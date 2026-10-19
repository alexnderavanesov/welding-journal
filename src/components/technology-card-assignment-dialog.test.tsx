import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { TechnologyCardAssignmentDialog } from './technology-card-assignment-dialog'
import { emptyTechnologyCardAssignmentCounts } from '@/lib/technology-card-assignment'

const mocks = vi.hoisted(() => ({ preview: vi.fn(), details: vi.fn(), apply: vi.fn(), confirm: vi.fn(), guard: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/server/technology-cards-api', () => ({ previewTechnologyCardAssignments: mocks.preview, getTechnologyCardAssignmentDetails: mocks.details, applyTechnologyCardAssignmentBatch: mocks.apply }))
vi.mock('@/lib/confirm-action-context', () => ({ useConfirmAction: () => mocks.confirm }))
vi.mock('@/lib/security-context', () => ({ useSecurityGuard: () => ({ requireEditPassword: mocks.guard }) }))
vi.mock('@/lib/weld-query-utils', () => ({ scheduleWeldDataRefresh: mocks.invalidate }))
const context = { version: 1, fingerprint: 'registry', upperId: 6 }
const chunk = { afterId: 0, throughId: 3, fingerprint: 'rows', size: 3, counts: { ...emptyTechnologyCardAssignmentCounts(), assign: 1, reassign: 1, rename: 1 } }
const rows = ['assign', 'reassign', 'rename'].map((kind, i) => ({ id: i + 1, project: 'P', line: 'L', joint: `F${i + 1}`, oldName: i ? 'Old' : '', newName: 'New', kind, mismatch: kind === 'reassign', reason: 'Причина' }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.preview.mockResolvedValue({ context, chunks: [chunk], nextCursor: null })
  mocks.details.mockResolvedValue(rows)
  mocks.apply.mockResolvedValue({ assign: 1, reassign: 0, rename: 1 })
  mocks.confirm.mockResolvedValue(true); mocks.guard.mockResolvedValue(true)
})
const mount = () => render(<QueryClientProvider client={new QueryClient()}><TechnologyCardAssignmentDialog onClose={vi.fn()} /></QueryClientProvider>)
async function preview() {
  fireEvent.click(screen.getByRole('button', { name: 'Начать проверку' }))
  await screen.findByRole('checkbox', { name: 'Назначение ТК стыку 1' })
}
it('preview writes nothing; selection, exclusions and confirmation are independent', async () => {
  mount(); await preview()
  expect(mocks.apply).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: 'Назначение ТК стыку 2' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Заменить' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Назначение ТК стыку 1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Применить выбранное (2)' }))
  await screen.findByText('Результат операции')
  expect(mocks.apply).toHaveBeenCalledExactlyOnceWith({ data: { context, chunk, actions: ['assign', 'rename', 'reassign'], excludedIds: [1] } })
  expect(mocks.guard).toHaveBeenCalledOnce(); expect(mocks.confirm).toHaveBeenCalledOnce()
  expect(mocks.invalidate).toHaveBeenCalledOnce()
})
it.each(['guard', 'confirm'] as const)('cancelled %s never writes', async step => {
  mocks[step].mockResolvedValue(false)
  mount(); await preview()
  fireEvent.click(screen.getByRole('button', { name: 'Применить выбранное (2)' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Применить выбранное (2)' })).toBeEnabled())
  expect(mocks.apply).not.toHaveBeenCalled()
})
it('stops on a failed chunk, shows acknowledged partial completion and requires a new preview', async () => {
  mocks.preview.mockResolvedValue({ context, chunks: [chunk, { ...chunk, afterId: 3, throughId: 6 }], nextCursor: null })
  mocks.apply.mockResolvedValueOnce({ assign: 1, reassign: 0, rename: 1 }).mockRejectedValueOnce(new Error('Стыки изменились'))
  mount(); await preview()
  fireEvent.click(screen.getByRole('button', { name: 'Применить выбранное (4)' }))
  await screen.findByText('Результат операции')
  expect(screen.getByRole('alert')).toHaveTextContent('последней порции может быть неизвестен')
  expect(screen.getByRole('status')).toHaveTextContent('Обработано порций: 1 из 2')
  expect(screen.queryByRole('button', { name: /Применить выбранное/ })).toBeNull()
  expect(mocks.apply).toHaveBeenCalledTimes(2)
  expect(mocks.invalidate).toHaveBeenCalledOnce()
})
it('stops preview after an in-flight read without applying incomplete counts', async () => {
  let resolve!: (value: unknown) => void
  mocks.preview.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Начать проверку' }))
  fireEvent.click(screen.getByRole('button', { name: 'Остановить после текущей порции' }))
  await act(async () => { resolve({ context, chunks: [chunk], nextCursor: 3 }) })
  expect(mocks.preview).toHaveBeenCalledOnce(); expect(mocks.apply).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /Применить выбранное/ })).toBeNull()
})

it('stops applying after the current chunk, retaining acknowledged changes without starting the next', async () => {
  let resolve!: (value: unknown) => void
  mocks.preview.mockResolvedValue({ context, chunks: [chunk, { ...chunk, afterId: 3, throughId: 6 }], nextCursor: null })
  mocks.apply.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  mount(); await preview()
  fireEvent.click(screen.getByRole('button', { name: 'Применить выбранное (4)' }))
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Остановить после текущей порции' }))
  await act(async () => { resolve({ assign: 1, reassign: 0, rename: 1 }) })
  expect(mocks.apply).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('Обработано порций: 1 из 2')
  expect(screen.getByRole('alert')).toHaveTextContent('Уже сохранённые изменения не отменены')
  expect(mocks.invalidate).toHaveBeenCalledOnce()
})

it('shows at most 50 proposals per page without another request inside the loaded chunk', async () => {
  mocks.preview.mockResolvedValue({ context: { ...context, upperId: 55 }, chunks: [{ ...chunk, throughId: 55, size: 55, counts: { ...emptyTechnologyCardAssignmentCounts(), assign: 55 } }], nextCursor: null })
  mocks.details.mockResolvedValue(Array.from({ length: 55 }, (_, i) => ({ ...rows[0], id: i + 1, joint: `F${i + 1}` })))
  mount(); await preview()
  expect(screen.getAllByRole('checkbox', { name: /^Назначение ТК стыку/ })).toHaveLength(50)
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  expect(screen.getAllByRole('checkbox', { name: /^Назначение ТК стыку/ })).toHaveLength(5)
  expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
  expect(screen.getAllByRole('checkbox', { name: /^Назначение ТК стыку/ })).toHaveLength(50)
  expect(mocks.details).toHaveBeenCalledOnce()
})

it('filters cached proposals without new requests or changing selection, including an empty result', async () => {
  mount(); await preview()
  const filter = screen.getByRole('combobox', { name: 'Показать стыки' })
  expect([...filter.querySelectorAll('option')].map(option => option.textContent))
    .toEqual(['Все', 'Предлагаемые изменения', 'Требуют внимания', 'Без изменений', 'Пропущены'])
  fireEvent.change(filter, { target: { value: 'changes' } })
  expect(screen.getByRole('checkbox', { name: 'Назначение ТК стыку 1' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Назначение ТК стыку 3' })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Применить выбранное (2)' })).toBeEnabled()
  expect(mocks.details).toHaveBeenCalledOnce()
  fireEvent.change(filter, { target: { value: 'attention' } })
  expect(screen.getByText('Стыков нет.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Применить выбранное (2)' })).toBeEnabled()
  expect(mocks.details).toHaveBeenCalledOnce()
})

it('jumps across irrelevant chunks and paginates filtered proposals in bounded detail requests', async () => {
  const noChanges = { ...chunk, counts: { ...emptyTechnologyCardAssignmentCounts(), unchanged: 3 } }
  const renames = { ...chunk, afterId: 3, throughId: 6, counts: { ...emptyTechnologyCardAssignmentCounts(), rename: 3 } }
  mocks.preview.mockResolvedValue({ context, chunks: [noChanges, renames], nextCursor: null })
  mocks.details.mockResolvedValueOnce(rows.map(row => ({ ...row, kind: 'unchanged' }))).mockResolvedValueOnce(rows.map(row => ({ ...row, id: row.id + 3, kind: 'rename' })))
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Начать проверку' }))
  await screen.findByRole('combobox', { name: 'Показать стыки' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Далее' })).toBeEnabled())
  fireEvent.change(screen.getByRole('combobox', { name: 'Показать стыки' }), { target: { value: 'changes' } })
  await screen.findByRole('checkbox', { name: 'Назначение ТК стыку 4' })
  expect(mocks.details).toHaveBeenLastCalledWith({ data: { context, chunk: renames } })
  expect(mocks.details).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled()
})

it('finds attention cases beyond an irrelevant chunk and shows the whole filtered page without another read', async () => {
  const attentionRows = Array.from({ length: 51 }, (_, i) => ({ ...rows[0], id: i + 4, joint: `F${i + 4}`,
    kind: ['ambiguous', 'none', 'incomplete'][i % 3], mismatch: i % 3 === 1, newName: '' }))
  const attentionChunk = { ...chunk, afterId: 3, throughId: 54, size: 51,
    counts: { ...emptyTechnologyCardAssignmentCounts(), ambiguous: 17, none: 17, incomplete: 17, mismatch: 17 } }
  mocks.preview.mockResolvedValue({ context: { ...context, upperId: 54 }, chunks: [chunk, attentionChunk], nextCursor: null })
  mocks.details.mockResolvedValueOnce(rows).mockResolvedValueOnce(attentionRows)
  mount(); await preview()
  fireEvent.change(screen.getByRole('combobox', { name: 'Показать стыки' }), { target: { value: 'attention' } })
  await screen.findByText('L / F4')
  expect(screen.getAllByRole('row')).toHaveLength(51) // header + 50, not mismatch duplicates
  expect(screen.getByRole('button', { name: 'Применить выбранное (2)' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  expect(screen.getByText('L / F54')).toBeInTheDocument()
  expect(screen.getAllByRole('row')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  expect(mocks.details).toHaveBeenCalledTimes(2)
  expect(mocks.apply).not.toHaveBeenCalled()
})
