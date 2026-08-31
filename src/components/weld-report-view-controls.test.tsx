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
  it('keeps the portaled columns panel open while the user scrolls inside it', () => {
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /Столбцы/ }))

    const panel = screen.getByRole('dialog', { name: 'Настройка столбцов отчета' })
    fireEvent.scroll(panel)

    expect(screen.getByRole('dialog', { name: 'Настройка столбцов отчета' })).toBeInTheDocument()
  })

  it('closes the panel when the report page scrolls', () => {
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /Столбцы/ }))

    fireEvent.scroll(document)

    expect(screen.queryByRole('dialog', { name: 'Настройка столбцов отчета' })).not.toBeInTheDocument()
  })
})
