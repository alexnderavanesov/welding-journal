import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BlockedActionHint } from '@/components/blocked-action-hint'

describe('BlockedActionHint', () => {
  it.each(['warning', 'danger'] as const)('keeps %s text beside a non-shrinking icon, with wrapping inside the text column', tone => {
    const reason = 'Первая причина.\n' + 'ДлинноеНазвание'.repeat(30)
    const { container } = render(<BlockedActionHint reason={reason} tone={tone} />)
    const hint = container.firstElementChild!
    expect(hint).toHaveClass('flex-nowrap', 'items-start')
    expect(hint.firstElementChild).toHaveClass('shrink-0')
    expect(hint.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    const textColumn = hint.lastElementChild!
    expect(textColumn).toHaveClass('min-w-0', 'flex-1')
    expect(textColumn.firstElementChild).toHaveClass('whitespace-pre-line', 'break-words')
    expect(textColumn.firstElementChild?.textContent).toBe(reason)
    expect(textColumn.childElementCount).toBe(1)
  })

  it('shows and invokes every independent correction action', () => {
    const onFixLnk = vi.fn()
    const onFixPsto = vi.fn()

    render(
      <BlockedActionHint
        reason="Сохранение заблокировано: нарушен порядок дат."
        actions={[
          { key: 'lnk', label: 'Исправить дату заявки ВИК', onAction: onFixLnk },
          { key: 'psto', label: 'Исправить дату ПСТО', onAction: onFixPsto },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату заявки ВИК' }))
    fireEvent.click(screen.getByRole('button', { name: 'Исправить дату ПСТО' }))
    expect(onFixLnk).toHaveBeenCalledOnce()
    expect(onFixPsto).toHaveBeenCalledOnce()
  })
})
