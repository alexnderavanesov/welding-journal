import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WeldFormSections } from './weld-form-sections'
import { FIELD_BY_KEY, type WeldInput } from '@/lib/weld-fields'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'

vi.mock('@/lib/security-context', () => ({ useSecurityGuard: () => ({ requireEditPassword: vi.fn() }) }))
vi.mock('@/server/line-program-control', () => ({ changeLayeredControl: vi.fn() }))
vi.mock('@/server/line-program', () => ({ findLineProgram: vi.fn() }))

function renderControls(draft: WeldInput) {
  const setDraft = vi.fn()
  render(<QueryClientProvider client={new QueryClient()}>
    <ConfirmActionProvider><WeldFormSections
      fieldsByGroup={[{ section: 'Контроль', fields: (['hasVik', 'hasRk', 'hasUzk', 'hasPvk'] as const).map((key) => FIELD_BY_KEY.get(key)!) }]}
      draft={draft} setDraft={setDraft} activeTab="control" onActiveTabChange={vi.fn()}
      collapsedSections={new Set()} fieldRefs={{ current: {} }} onToggleSection={vi.fn()}
    /></ConfirmActionProvider>
  </QueryClientProvider>)
  return setDraft
}

describe('layered control placement in the weld form', () => {
  it('explains and protects a mandatory repair method without exposing system metadata as fields', () => {
    renderControls({ id: 7, joint: 'F1R1', hasRk: 'да', programRepairRequirements: [
      { method: 'РК', sourceRowId: 1, sourceJoint: 'F1', reason: 'Обязателен после негодного РК на F1' },
    ] })
    const block = screen.getByText('Обязательный метод: Обязателен после негодного РК на F1').parentElement!
    expect(block).toHaveClass('border-amber-400')
    expect(within(block).getByRole('button', { name: 'Пусто' })).toBeDisabled()
    expect(within(block).getByRole('button', { name: 'Отменен' })).toBeDisabled()
    expect(within(block).getByRole('button', { name: 'Да' })).toBeEnabled()
    expect(screen.queryByLabelText('programRepairRequirements')).not.toBeInTheDocument()
  })
  it.each([undefined, 1])('places the complete block directly after PVK for joint id %s', (id) => {
    const draft: WeldInput = { id, connectionType: 'У17', hasPvk: 'да' }
    const setDraft = renderControls(draft)
    const checkbox = screen.getByRole('checkbox', { name: 'Послойная замена РК/УЗК' })
    const block = checkbox.closest('label')!.parentElement!
    const pvkRow = screen.getByText('Назначение ПВК').parentElement!
    expect(pvkRow.nextElementSibling).toBe(block)
    expect(block.nextElementSibling).toBeNull()
    expect(block).toHaveTextContent('Четыре послойных заключения')
    expect(setDraft).not.toHaveBeenCalled()
    fireEvent.click(checkbox)
    expect(setDraft.mock.calls[0]![0](draft)).toMatchObject({
      hasPvk: 'да', layeredControlRequest: { assigned: true, confirmPvk: true },
    })
  })

  it('keeps an assigned block and its removal command together below PVK', () => {
    renderControls({ id: 1, connectionType: 'У17', hasPvk: 'да', layeredControlAssigned: true })
    const block = screen.getByText('Назначение ПВК').parentElement!.nextElementSibling!
    expect(block).toContainElement(screen.getByRole('button', { name: 'Убрать послойный контроль' }))
    expect(screen.getByRole('checkbox', { name: 'Послойная замена РК/УЗК' })).toBeDisabled()
  })

  it('does not show layered control on an unassigned non-angular joint', () => {
    renderControls({ connectionType: 'С17' })
    expect(screen.queryByRole('checkbox', { name: 'Послойная замена РК/УЗК' })).not.toBeInTheDocument()
  })
})
