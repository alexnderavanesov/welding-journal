import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WeldForm, getWeldFormFieldStatusKeys, getWeldFormTabForField } from '@/components/weld-form'
import { WeldFormField } from '@/components/weld-form-field'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'

vi.mock('@/lib/security-context', () => ({ useSecurityGuard: () => ({ requireEditPassword: vi.fn() }) }))

describe('weld form input performance', () => {
  it('updates assignment availability on officiality/actuality transitions through the memoized field', () => {
    const field = FIELD_BY_KEY.get('hasUzk')!
    const fieldRefs = { current: {} }
    const setDraft = vi.fn()
    const control = (draft: WeldInput) => <QueryClientProvider client={client}><WeldFormField field={field} draft={draft} setDraft={setDraft} fieldRefs={fieldRefs} /></QueryClientProvider>
    const client = new QueryClient()
    const view = render(control({ id: 1, hasUzk: 'да', officiality: 'неофициальный' }))
    expect(screen.getByRole('textbox', { name: field.label })).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Да' })).not.toBeInTheDocument()
    view.rerender(control({ id: 1, hasUzk: 'да', revisionActuality: 'не актуален' }))
    expect(screen.getByRole('textbox', { name: field.label })).toHaveAttribute('readonly')
    view.rerender(control({ id: 1, hasUzk: 'да' }))
    expect(screen.getByRole('button', { name: 'Да' })).toBeEnabled()
    expect(setDraft).not.toHaveBeenCalled()
  })
  it.each([
    { rkRequest: 'Заявка' },
    { rkConclusion: 'Заключение', rkResult: 'годен' },
    { preHeatTreatmentControls: [{ method: 'РК', requestName: 'До ТО' }] },
    { duplicateControls: [{ method: 'РК', conclusion: 'Дубль' }] },
  ])('disables clearing a factual assignment immediately, but keeps cancellation available: %j', history => {
    renderWithQueryClient(<WeldFormField field={FIELD_BY_KEY.get('hasRk')!} draft={{ id: 1, hasRk: 'да', ...history } as WeldInput} setDraft={vi.fn()} fieldRefs={{ current: {} }} />)
    expect(screen.getByRole('button', { name: 'Пусто' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Пусто' })).toHaveAttribute('title', expect.stringContaining('есть заявка, результат или заключение'))
    expect(screen.getByRole('button', { name: 'Отменен' })).toBeEnabled()
  })
  it('confirms official cancellation and preserves the factual result and conclusion', () => {
    HTMLElement.prototype.scrollTo = vi.fn()
    const onSave = vi.fn()
    renderWithQueryClient(<ConfirmActionProvider><WeldForm value={{
      id: 1, joint: 'F1', hasRk: 'да', rkRequest: 'Заявка РК',
      rkResult: 'ремонт', rkConclusion: 'Заключение РК',
    }} onSave={onSave} onCancel={vi.fn()} suggestionRows={[]} /></ConfirmActionProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Назначение контроля' }))
    const rk = screen.getByText('Назначение РК').parentElement!
    fireEvent.click(within(rk).getByRole('button', { name: /Отменен/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Отменить назначения?')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к редактированию' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену и сохранить' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      hasRk: 'отменен', rkRequest: 'Заявка РК', rkResult: 'ремонт', rkConclusion: 'Заключение РК',
      finalStatus: 'не годен',
    }))
  })

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

  it.each([['new', undefined], ['existing', 1]])('locks only shared line properties in the %s form', (_mode, id) => {
    HTMLElement.prototype.scrollTo = vi.fn()
    renderWithQueryClient(<WeldForm value={{ id, projectTitle: 'Проект', subtitleCode: 'Шифр', joint: 'F1' }} onSave={vi.fn()} onCancel={vi.fn()} />)
    // The floating report controls (z=60) must not overlap the form's Save button.
    expect(screen.getByRole('dialog').parentElement).toHaveClass('z-[70]')
    for (const label of ['Проект', 'Шифр']) {
      expect((screen.getByRole('textbox', { name: label }) as HTMLInputElement).readOnly).toBe(Boolean(id))
    }
    for (const label of ['Группа трубопровода', 'Категория трубопровода', 'Контроль швов, (%)']) {
      expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('readonly')
    }
    for (const label of ['Линия', 'Изометрия', 'Номер листа', 'Номер ИЗМа']) {
      const input = screen.getByRole('textbox', { name: label })
      expect(input).not.toHaveAttribute('readonly')
      expect(input).toBeEnabled()
      fireEvent.change(input, { target: { value: '12' } })
      expect(input).toHaveValue('12')
    }
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

  it('creates no remote suggestion observers for closed or locally supplied fields', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const field = FIELD_BY_KEY.get('responsible')!
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <WeldFormField field={field} draft={{ responsible: '' }} fieldRefs={{ current: {} }} setDraft={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    rerender(
      <QueryClientProvider client={queryClient}>
        <WeldFormField field={field} draft={{ responsible: '' }} suggestionRows={[{ responsible: 'Иванов' }]} fieldRefs={{ current: {} }} setDraft={vi.fn()} />
      </QueryClientProvider>,
    )
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.getByText('Иванов')).toBeInTheDocument()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('refreshes suggestions for the typed field after its debounced value catches up', () => {
    const field = FIELD_BY_KEY.get('responsible')!
    const refs = { current: {} }
    const setDraft = vi.fn()
    const sourceRows = [{ responsible: 'Иванов' }, { responsible: 'Петров' }]
    const client = new QueryClient()
    const view = (suggestionDraft: WeldInput) => (
      <QueryClientProvider client={client}>
        <WeldFormField field={field} draft={{ responsible: 'Пет' }} suggestionDraft={suggestionDraft}
          suggestionRows={sourceRows} fieldRefs={refs} setDraft={setDraft} />
      </QueryClientProvider>
    )
    const { rerender } = render(view({ responsible: 'Ива' }))
    fireEvent.focus(screen.getByRole('textbox'))
    rerender(view({ responsible: 'Пет' }))
    expect(screen.getByText('Петров')).toBeInTheDocument()
    expect(screen.queryByText('Иванов')).not.toBeInTheDocument()
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

  it('saves the last character without waiting for suggestions or deferred validation', () => {
    const onSave = vi.fn()
    HTMLElement.prototype.scrollTo = vi.fn()
    renderWithQueryClient(<WeldForm value={{ id: 1, joint: 'F1', responsible: '' }} onSave={onSave} onCancel={vi.fn()} suggestionRows={[]} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Ответственный' }), { target: { value: 'Последний символ Я' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ responsible: 'Последний символ Я' }))
  })

  it('keeps a line-move decision inside the form until the user saves explicitly', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    const onDecisionAction = vi.fn()
    HTMLElement.prototype.scrollTo = vi.fn()

    renderWithQueryClient(
      <WeldForm
        value={{ id: 1, joint: 'S1' }}
        preSaveDecision={{
          status: 'resolved',
          message: 'Выбрано: основной комплект будет перенесен в «До ТО».',
          actionLabel: 'Изменить',
          onAction: onDecisionAction,
        }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }))
    expect(onDecisionAction).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  // This verifies the debounced callback, not a wall-clock rendering SLA.
  // Rendering the full form can exceed Vitest's 5-second default when its
  // worker runs alongside hundreds of other test files.
  it('reports a changed line identity before the form is saved', async () => {
    const onLineIdentityChange = vi.fn()
    HTMLElement.prototype.scrollTo = vi.fn()

    renderWithQueryClient(
      <WeldForm
        value={{
          id: 1,
          projectTitle: 'Проект',
          subtitleCode: '400',
          line: 'L-1',
          joint: 'S1',
        }}
        onLineIdentityChange={onLineIdentityChange}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await waitFor(() => expect(onLineIdentityChange).toHaveBeenCalledWith({
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
    }))

    fireEvent.change(screen.getByDisplayValue('L-1'), { target: { value: 'L-2' } })
    await waitFor(() => expect(onLineIdentityChange).toHaveBeenCalledWith({
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-2',
    }))
  }, 15_000)
})

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}
