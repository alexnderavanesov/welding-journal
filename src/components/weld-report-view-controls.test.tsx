import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeldReportViewControls } from '@/components/weld-report-view-controls'
import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'

const sections = [{
  section: 'Сварка',
  fields: (['line', 'joint', 'weldDate'] as WeldFieldKey[]).map((key) => FIELD_BY_KEY.get(key)!),
}]

function renderControls() {
  render(
    <WeldReportViewControls
      sections={sections}
      alwaysVisibleFieldKeys={new Set(['line', 'joint'])}
      hiddenFieldKeys={new Set()}
      activePreset="custom"
      savedViews={[]}
      sort={null}
      onApplyPreset={vi.fn()}
      onToggleField={vi.fn()}
      onShowAllFields={vi.fn()}
      onSortChange={vi.fn()}
      onSaveView={vi.fn(() => true)}
      onApplySavedView={vi.fn()}
      onDeleteSavedView={vi.fn()}
    />,
  )
}

describe('WeldReportViewControls', () => {
  it('renders as a compact group for the fixed toolbar slot', () => {
    renderControls()

    const controls = screen.getByRole('button', { name: /Наборы/ }).parentElement

    expect(controls).toHaveAttribute('data-report-view-controls')
    expect(controls).toHaveClass(
      'relative',
      'flex',
      'shrink-0',
      'justify-end',
      'z-10',
      'bg-white',
    )
    expect(controls).not.toHaveClass(
      'sticky',
      'right-3',
      'w-[27rem]',
      'mr-[-0.75rem]',
      'border-l',
      'right-0',
      'right-6',
      'pr-8',
      'before:w-8',
      'before:bg-slate-50',
      'before:bg-gradient-to-r',
      'before:from-transparent',
      'before:border-r',
      'after:border-l',
      'after:bg-white',
    )
  })

  it('keeps the portaled columns panel open while the user scrolls inside it', () => {
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /Столбцы/ }))

    const panel = screen.getByRole('dialog', { name: 'Настройка столбцов отчета' })
    fireEvent.scroll(panel)

    expect(screen.getByRole('dialog', { name: 'Настройка столбцов отчета' })).toBeInTheDocument()
  })

  it('ignores a simultaneous report scroll while the pointer is over the columns panel', () => {
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /Столбцы/ }))

    const panel = screen.getByRole('dialog', { name: 'Настройка столбцов отчета' })
    fireEvent.pointerEnter(panel)
    fireEvent.wheel(panel, { deltaY: 120 })
    fireEvent.scroll(document)

    expect(screen.getByRole('dialog', { name: 'Настройка столбцов отчета' })).toBeInTheDocument()
  })

  it('closes the panel when the report page scrolls', () => {
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /Столбцы/ }))

    fireEvent.scroll(document)

    expect(screen.queryByRole('dialog', { name: 'Настройка столбцов отчета' })).not.toBeInTheDocument()
  })
})
