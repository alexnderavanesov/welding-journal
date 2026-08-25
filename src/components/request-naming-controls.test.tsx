import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RequestNamingControls } from '@/components/request-naming-controls'

describe('RequestNamingControls', () => {
  it('shows a document-series summary instead of one misleading system name', () => {
    render(
      <RequestNamingControls
        naming={{ mode: 'system', customName: '' }}
        systemName="Заключение-ВИК-25.08.2026-013"
        systemDocumentCount={4}
        label="Наименование заключения"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Будет создано документов: 4')).toBeInTheDocument()
    expect(screen.getByText(/Каждая группа получит отдельное системное имя/)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Заключение-ВИК-25.08.2026-013')).not.toBeInTheDocument()
  })

  it('keeps buffered custom-name typing local until the field is committed', () => {
    const onChange = vi.fn()

    render(
      <RequestNamingControls
        naming={{ mode: 'custom', customName: 'Заключение-001' }}
        systemName="Заключение-ВИК-001"
        label="Наименование заключения"
        bufferCustomNameInput
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: /^Наименование заключения/ })
    fireEvent.change(input, { target: { value: 'Заключение заказчика №77' } })

    expect(input).toHaveValue('Заключение заказчика №77')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      mode: 'custom',
      customName: 'Заключение заказчика №77',
    })
  })

  it('preserves the buffered name when switching back to the system mode', () => {
    const onChange = vi.fn()

    render(
      <RequestNamingControls
        naming={{ mode: 'custom', customName: '' }}
        systemName="Заключение-ВИК-001"
        label="Наименование заключения"
        bufferCustomNameInput
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: /^Наименование заключения/ }), {
      target: { value: 'Заключение заказчика №77' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Системное' }))

    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'system',
      customName: 'Заключение заказчика №77',
    })
  })
})
