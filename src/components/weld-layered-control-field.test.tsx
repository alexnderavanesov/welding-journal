import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WeldLayeredControlField } from './weld-line-program-fields'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

const mocks = vi.hoisted(() => ({ password: vi.fn(), change: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/security-context', () => ({ useSecurityGuard: () => ({ requireEditPassword: mocks.password }) }))
vi.mock('@/server/line-program-control', () => ({ changeLayeredControl: mocks.change }))
vi.mock('@/server/line-program', () => ({ findLineProgram: vi.fn() }))
vi.mock('@/lib/weld-query-utils', () => ({ scheduleWeldDataRefresh: mocks.invalidate }))

const assigned = { id: 42, rowVersion: 'before', line: 'L-1', joint: 'F42', connectionType: 'У17',
  layeredControlAssigned: true, hasPvk: 'да', pvkResult: 'годен', pvkConclusion: 'ПВК-42', isometry: 'Несохранённая изометрия' } as WeldRow

function renderField(row: WeldInput = assigned) {
  function Harness() {
    const [draft, setDraft] = useState(row)
    return <><WeldLayeredControlField draft={draft} setDraft={setDraft} /><output data-testid="draft">{JSON.stringify(draft)}</output></>
  }
  render(<QueryClientProvider client={new QueryClient()}><ConfirmActionProvider><Harness /></ConfirmActionProvider></QueryClientProvider>)
}

function openRemoval() {
  fireEvent.click(screen.getByRole('button', { name: 'Убрать послойный контроль' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('Убрать послойный контроль?')
  expect(dialog).toHaveTextContent('L-1 · F42')
  expect(dialog).toHaveTextContent('четыре заключения')
  expect(dialog).toHaveTextContent('Обычные назначения, результаты, заявки и документы сохранятся')
  expect(mocks.change).not.toHaveBeenCalled()
  return within(dialog)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.password.mockResolvedValue(true)
  mocks.change.mockResolvedValue([{ ...assigned, rowVersion: 'after', layeredControlAssigned: false }])
})

describe('layered-control confirmation in the assignment form', () => {
  it.each([{ officiality: 'неофициальный' }, { revisionActuality: 'не актуален' }])('keeps excluded layered history read-only: %j', excluded => {
    renderField({ ...assigned, ...excluded })
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Убрать послойный контроль' })).toBeDisabled()
    expect(screen.getByText(/Сначала верните официальность и актуальность/)).toBeVisible()
    expect(mocks.change).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'escape', 'close'])('keeps the assignment and does not save on %s', async (action) => {
    renderField()
    const dialog = openRemoval()
    if (action === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
    else fireEvent.click(dialog.getByRole('button', { name: action === 'close' ? 'Закрыть' : 'Отмена' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(JSON.parse(screen.getByTestId('draft').textContent!)).toEqual(assigned)
    expect(mocks.password).not.toHaveBeenCalled()
    expect(mocks.change).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })

  it('saves once after confirmation without overwriting other draft fields or ordinary PVK', async () => {
    renderField()
    const dialog = openRemoval()
    fireEvent.click(dialog.getByRole('button', { name: 'Убрать послойный контроль' }))
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked())
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ data: {
      targets: [{ id: 42, version: 'before' }], assigned: false, confirmedRemoval: true,
    } })
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(JSON.parse(screen.getByTestId('draft').textContent!)).toEqual({ ...assigned, layeredControlAssigned: false, rowVersion: 'after' })
  })

  it('does not remove the assignment when password authorization is cancelled', async () => {
    mocks.password.mockResolvedValue(false)
    renderField()
    fireEvent.click(openRemoval().getByRole('button', { name: 'Убрать послойный контроль' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Убрать послойный контроль' })).toBeEnabled())
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(mocks.change).not.toHaveBeenCalled()
  })

  it('keeps the assignment on a save error and permits a fresh retry', async () => {
    mocks.change.mockRejectedValueOnce(new Error('Стык изменён другим пользователем'))
    renderField()
    fireEvent.click(openRemoval().getByRole('button', { name: 'Убрать послойный контроль' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Стык изменён другим пользователем')
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(mocks.invalidate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Убрать послойный контроль' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Убрать послойный контроль' }))
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked())
    expect(mocks.change).toHaveBeenCalledTimes(2)
  })

  it.each(['отменен', 'дополнительный'])('uses the same custom dialog for the PVK transition from %s', async (hasPvk) => {
    renderField({ ...assigned, hasPvk, layeredControlAssigned: false })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('dialog')).toHaveTextContent(`с «${hasPvk}» на «да»`)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled())
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Перевести ПВК в «да»' }))
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())
    expect(JSON.parse(screen.getByTestId('draft').textContent!)).toMatchObject({ hasPvk: 'да', layeredControlRequest: { assigned: true, confirmPvk: true } })
    // Assignment is still a draft; only removal is an immediate dedicated save.
    expect(mocks.change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
