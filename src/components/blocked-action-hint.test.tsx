import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BlockedActionHint } from '@/components/blocked-action-hint'

describe('BlockedActionHint', () => {
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
