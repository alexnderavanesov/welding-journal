import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowResultOptionPicker } from '@/components/workflow-result-option-picker'

describe('WorkflowResultOptionPicker', () => {
  it('keeps a help slot mounted when selection changes and restrictions appear', () => {
    const props = { value: '', options: ['годен', 'вырез'], onChange: vi.fn(), reserveHelpSpace: true, compact: true }
    const { container, rerender } = render(<WorkflowResultOptionPicker {...props} helperText="Выберите стыки" />)
    const slot = container.querySelector('[data-result-picker-help]')
    expect(slot).toHaveClass('min-h-4')
    expect(slot).toHaveTextContent('Выберите стыки')
    rerender(<WorkflowResultOptionPicker {...props} restrictionHelpHref="/settings#system-rule-lnk-results"
      restrictionHelpLabel="Правило СП-07" getDisabledReason={option => option === 'вырез' ? 'По ВИК вырез запрещён' : undefined} />)
    expect(container.querySelector('[data-result-picker-help]')).toBe(slot)
    expect(slot).not.toHaveTextContent('Правило СП-07')
    const link = screen.getByRole('link', { name: 'Правило СП-07' })
    expect(link).toHaveTextContent('')
    expect(link.querySelector('svg')).not.toBeNull()
    expect(link.closest('[data-result-picker-rule]')).not.toBeNull()
    rerender(<WorkflowResultOptionPicker {...props} />)
    expect(container.querySelector('[data-result-picker-help]')).toBe(slot)
    expect(slot).toBeEmptyDOMElement()
  })

  it('shows every restriction on hover and keyboard focus without invoking a disabled choice or its row', () => {
    const onChange = vi.fn()
    const onRowClick = vi.fn()
    render(<div onClick={onRowClick}>
      <WorkflowResultOptionPicker value="" options={['годен', 'ремонт']} onChange={onChange} restrictionHelpHref="/settings#system-rule-sp-05"
        getDisabledReason={(option) => option === 'ремонт' ? 'Диаметр меньше 89 мм\nУже выполнено два ремонта' : undefined} />
    </div>)
    const button = screen.getByRole('button', { name: 'ремонт' })
    const trigger = screen.getByRole('group', { name: 'ремонт' })
    expect(button).toBeDisabled()
    expect(trigger).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('link', { name: 'Подробнее о правиле СП-07' })).toHaveAttribute('href', '/settings#system-rule-sp-05')
    expect(screen.getByRole('link', { name: 'Подробнее о правиле СП-07' })).toHaveAttribute('target', '_blank')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.mouseEnter(trigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Диаметр меньше 89 мм')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Уже выполнено два ремонта')
    fireEvent.mouseLeave(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.focus(trigger)
    expect(trigger).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
    fireEvent.click(button)
    fireEvent.click(trigger)
    expect(onChange).not.toHaveBeenCalled()
    expect(onRowClick).not.toHaveBeenCalled()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.focus(trigger)
    fireEvent.blur(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'годен' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('годен')
    expect(onRowClick).not.toHaveBeenCalled()
  })
})
