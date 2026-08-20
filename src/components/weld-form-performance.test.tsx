import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WeldForm, getWeldFormFieldStatusKeys, getWeldFormTabForField } from '@/components/weld-form'
import { WeldFormField } from '@/components/weld-form-field'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

describe('weld form input performance', () => {
  it('maps the control basis summary to the control assignment tab', () => {
    expect(getWeldFormTabForField('controlBasisSummary')).toBe('control')
  })

  it('counts only changed visible fields while editing', () => {
    const fieldsByGroup = [
      {
        fields: [
          { key: 'projectTitle' as const },
          { key: 'line' as const },
        ],
      },
    ]

    const changedKeys = getWeldFormFieldStatusKeys(
      { projectTitle: 'Новый проект', line: '330-ATM-16-000' },
      { id: 1, projectTitle: 'Исходный проект', line: '330-ATM-16-000', joint: 'F18' },
      fieldsByGroup,
      true,
    )

    expect([...changedKeys]).toEqual(['projectTitle'])
  })

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

  it('keeps a control basis editable and preserves it when assignment state changes', () => {
    const field = FIELD_BY_KEY.get('hasRk')
    if (!field) throw new Error('RK assignment field is missing')

    function Harness() {
      const [draft, setDraft] = useState<WeldInput>({ hasRk: 'да', rkControlBasis: 'ТР №1' })
      return (
        <>
          <WeldFormField
            field={field as typeof field & { key: WeldFieldKey }}
            draft={draft}
            fieldRefs={{ current: {} }}
            setDraft={setDraft}
            controlPickerLayout="row"
          />
          <output>{`${draft.hasRk ?? ''}|${draft.rkControlBasis ?? ''}`}</output>
        </>
      )
    }

    renderWithQueryClient(<Harness />)

    const basisInput = screen.getByLabelText('Основание или документ для назначения контроля')
    expect(basisInput).toHaveValue('ТР №1')

    fireEvent.click(screen.getByRole('button', { name: /Отменен/ }))
    expect(screen.getByText('отменен|ТР №1')).toBeInTheDocument()
    expect(basisInput).toHaveValue('ТР №1')

    fireEvent.click(screen.getByRole('button', { name: /Дополнительный/ }))
    expect(screen.getByText('дополнительный|ТР №1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Пусто/ }))
    expect(screen.getByText('|ТР №1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Да/ }))
    expect(screen.getByText('true|ТР №1')).toBeInTheDocument()

    fireEvent.change(basisInput, { target: { value: 'Пересогласование №2' } })
    expect(screen.getByText('true|Пересогласование №2')).toBeInTheDocument()
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
