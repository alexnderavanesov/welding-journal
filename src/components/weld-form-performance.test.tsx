import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WeldForm } from '@/components/weld-form'
import { WeldFormField } from '@/components/weld-form-field'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

describe('weld form input performance', () => {
  it.each([
    ['create', {}],
    ['edit', { id: 1, joint: 'S1' }],
  ])('keeps system-managed fields out of the %s form', (_mode, value) => {
    HTMLElement.prototype.scrollTo = vi.fn()

    const { unmount } = renderWithQueryClient(
      <WeldForm
        value={value}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    for (const label of [
      'Заявки',
      'Результат',
      'Заключения',
      'Документы',
      'Дата заявки ВИК',
      'Итоговый статус',
      'Задачи диспетчера',
      'ЖСР',
      'Чек-лист',
      'ЗНИ',
      'Внесен сварка',
      'Обновлен сварка',
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }

    unmount()
  })

  it('does not scan suggestion rows until a suggestion field is opened', () => {
    const sourceRows = [{ responsible: 'Иванов', projectTitle: 'Проект' }] as WeldInput[]
    const iterate = vi.fn(() => sourceRows[Symbol.iterator]())
    const suggestionRows = {
      [Symbol.iterator]: iterate,
    } as unknown as readonly WeldInput[]
    const field = FIELD_BY_KEY.get('responsible')

    if (!field) throw new Error('Responsible field is missing')

    renderWithQueryClient(
      <WeldFormField
        field={field as typeof field & { key: WeldFieldKey }}
        draft={{ responsible: '' }}
        suggestionRows={suggestionRows}
        fieldRefs={{ current: {} }}
        setDraft={vi.fn()}
      />,
    )

    expect(iterate).not.toHaveBeenCalled()

    fireEvent.focus(screen.getByRole('textbox'))

    expect(iterate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Иванов')).toBeInTheDocument()
  })

  it('validates the latest draft synchronously when save is requested', () => {
    const onSave = vi.fn()
    window.scrollTo = vi.fn()
    HTMLElement.prototype.scrollTo = vi.fn()

    renderWithQueryClient(
      <WeldForm
        value={{ id: 1, joint: 'S1', responsible: 'исходное' }}
        getExternalSaveBlockReason={(draft) => (draft.responsible === 'запрещено' ? 'Проверка последнего значения' : null)}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('исходное'), { target: { value: 'запрещено' } })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Проверка последнего значения')).toBeInTheDocument()
  })
})

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}
