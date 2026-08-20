import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RequestNamingControls } from '@/components/request-naming-controls'

describe('RequestNamingControls', () => {
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
