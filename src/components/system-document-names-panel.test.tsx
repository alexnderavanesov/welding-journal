import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SystemDocumentNamesPanel } from '@/components/system-document-names-panel'
import type { WeldRow } from '@/lib/dispatcher-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'

const rows = [
  { id: 1, projectTitle: 'Проект А', subtitleCode: '500', line: 'L-10', joint: 'F5' },
  { id: 2, projectTitle: 'Проект Б', subtitleCode: '600', line: 'L-20', joint: 'F6' },
] as WeldRow[]

function createPstoPlan(naming: RequestNamingState) {
  return buildSystemDocumentCreationPlan({
    type: 'pstoConclusion',
    date: '2026-08-26',
    rows,
    naming,
    settings: {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
        pstoConclusion: 'joint',
      },
    },
    nextNumber: 7,
  })
}

describe('SystemDocumentNamesPanel', () => {
  it('uses PSTO labels while showing every calculated diagram name', () => {
    const naming = { mode: 'system' as const, customName: '' }
    const plan = createPstoPlan(naming)

    const { container } = render(
      <SystemDocumentNamesPanel
        plan={plan}
        naming={naming}
        documentNameLabel="Наименование диаграммы"
        documentNameAriaLabel="Название диаграммы"
        documentNamePlaceholder="Название диаграммы"
        emptyMessage="Выберите результат и хотя бы один стык."
        onNamingChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Наименование диаграммы')).toBeInTheDocument()
    expect(screen.getByText(plan.groups[0].name)).toBeInTheDocument()
    expect(screen.getByText(plan.groups[1].name)).toBeInTheDocument()

    const groupsList = screen.getByText(plan.groups[0].name).closest('.overflow-y-auto')
    expect(groupsList).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    expect(groupsList?.parentElement).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden')
    expect(container.firstElementChild).toHaveClass('min-h-0', 'flex-1')
  })

  it('keeps an arbitrary custom diagram name for each split group', () => {
    const naming = { mode: 'custom' as const, customName: '', customGroupNames: {} }
    const plan = createPstoPlan(naming)
    const onNamingChange = vi.fn()

    render(
      <SystemDocumentNamesPanel
        plan={plan}
        naming={naming}
        documentNameLabel="Наименование диаграммы"
        documentNameAriaLabel="Название диаграммы"
        documentNamePlaceholder="Название диаграммы"
        emptyMessage="Выберите результат и хотя бы один стык."
        onNamingChange={onNamingChange}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Название диаграммы: Стык F5' }), {
      target: { value: 'Диаграмма подрядчика' },
    })
    fireEvent.blur(screen.getByRole('textbox', { name: 'Название диаграммы: Стык F5' }))

    expect(onNamingChange).toHaveBeenCalledWith({
      ...naming,
      customGroupNames: {
        [plan.groups[0].key]: 'Диаграмма подрядчика',
      },
    })
  })

  it('opens group actions from the row and menu button but keeps the native input context menu', () => {
    const naming = { mode: 'custom' as const, customName: '', customGroupNames: {} }
    const plan = createPstoPlan(naming)
    const onOpenGroupContextMenu = vi.fn()

    const { container } = render(
      <SystemDocumentNamesPanel
        plan={plan}
        naming={naming}
        documentNameLabel="Наименование диаграммы"
        documentNameAriaLabel="Название диаграммы"
        documentNamePlaceholder="Название диаграммы"
        emptyMessage="Выберите результат и хотя бы один стык."
        onNamingChange={vi.fn()}
        onOpenGroupContextMenu={onOpenGroupContextMenu}
      />,
    )

    const firstGroupRow = container.querySelector('.group\\/dialog-row')
    fireEvent.contextMenu(firstGroupRow!)
    expect(onOpenGroupContextMenu).toHaveBeenCalledWith(expect.anything(), plan.groups[0])

    onOpenGroupContextMenu.mockClear()
    fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Название диаграммы: Стык F5' }))
    expect(onOpenGroupContextMenu).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Действия: Стык F5' }))
    expect(onOpenGroupContextMenu).toHaveBeenCalledWith(expect.anything(), plan.groups[0])
  })
})
