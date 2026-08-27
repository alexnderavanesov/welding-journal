import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  RkExposureTableEditorDialog,
  WdiTableEditorDialog,
} from '@/components/settings-reference-table-dialogs'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'

function renderWithConfirmAction(children: ReactNode) {
  return render(<ConfirmActionProvider>{children}</ConfirmActionProvider>)
}

describe('settings reference table dialogs', () => {
  it('pastes an Excel range into the WDI matrix and saves the edited table', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    renderWithConfirmAction(
      <WdiTableEditorDialog
        table={{
          fileName: 'Старая таблица.xlsx',
          uploadedAt: '2026-08-01T00:00:00.000Z',
          diameters: [25, 50],
          thicknesses: [3],
          values: [[1], [1.5]],
        }}
        onClose={onClose}
        onSave={onSave}
      />,
    )

    fireEvent.paste(screen.getByLabelText('Диаметр 1'), {
      clipboardData: { getData: () => '57\t2,25\r\n89\t3,5\r\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить справочник' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      fileName: 'Старая таблица.xlsx',
      diameters: [57, 89],
      thicknesses: [3],
      values: [[2.25], [3.5]],
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pastes grouped RK exposure rows and saves the same structured variants', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    renderWithConfirmAction(
      <RkExposureTableEditorDialog table={null} onClose={onClose} onSave={onSave} />,
    )

    fireEvent.paste(screen.getByLabelText('Диаметр группы 1'), {
      clipboardData: { getData: () => '57\t1\t+\tэллипс\r\n\t2\t\t\r\n89\t0-100\t+\tкоординаты\r\n\t100-0\t\t\r\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить справочник' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      entries: [
        {
          diameter: 57,
          options: [{ values: ['1', '2'], isDefault: true, note: 'эллипс' }],
        },
        {
          diameter: 89,
          options: [{ values: ['0-100', '100-0'], isDefault: true, note: 'координаты' }],
        },
      ],
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps row and column creation available in the WDI dialog footer', () => {
    renderWithConfirmAction(
      <WdiTableEditorDialog
        table={{
          fileName: 'Таблица WDI',
          uploadedAt: '2026-08-09T00:00:00.000Z',
          diameters: [25],
          thicknesses: [3],
          values: [[1]],
        }}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(true)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Добавить диаметр' }))
    fireEvent.click(screen.getByRole('button', { name: 'Добавить толщину' }))

    expect(screen.getByLabelText('Диаметр 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Толщина 2')).toBeInTheDocument()
  })

  it('creates diameter columns and variants in the RK exposure matrix', () => {
    renderWithConfirmAction(
      <RkExposureTableEditorDialog
        table={{
          fileName: 'Экспозиции по диаметрам',
          uploadedAt: '2026-08-09T00:00:00.000Z',
          entries: [{
            diameter: 57,
            options: [{ values: ['1'], isDefault: true, label: 'по 1 экспозиции', note: 'эллипс' }],
          }],
        }}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(true)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Добавить вариант для диаметра 57' }))
    expect(screen.getByRole('columnheader', { name: 'Вариант 2' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить диаметр' }))
    fireEvent.change(screen.getByLabelText('Новый диаметр'), { target: { value: '89' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать столбец' }))

    expect(screen.getByLabelText('Диаметр группы 2')).toHaveValue('89')
  })

  it('edits matrix intervals without changing the saved RK exposure structure', async () => {
    const onSave = vi.fn().mockResolvedValue(true)

    renderWithConfirmAction(
      <RkExposureTableEditorDialog
        table={{
          fileName: 'Экспозиции по диаметрам',
          uploadedAt: '2026-08-09T00:00:00.000Z',
          entries: [{
            diameter: 18,
            options: [
              { values: ['1', '2'], isDefault: true, label: 'по 2 экспозициям', note: 'эллипс' },
              { values: ['0-100', '100-0'], isDefault: false, label: 'по координатам', note: 'мерный пояс' },
            ],
          }],
        }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(screen.getByLabelText('Диаметр группы 1')).toHaveAttribute('readonly')
    const firstDefault = screen.getByLabelText('Вариант по умолчанию 18:1')
    const secondDefault = screen.getByLabelText('Вариант по умолчанию 18:2')
    expect(firstDefault).toBeChecked()
    fireEvent.click(secondDefault)
    expect(firstDefault).not.toBeChecked()
    expect(secondDefault).toBeChecked()

    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить интервал' })[0])
    fireEvent.change(screen.getByLabelText('Интервал варианта 18:1, строка 3'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить справочник' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      entries: [{
        diameter: 18,
        options: [
          { values: ['1', '2', '3'], isDefault: false, note: 'эллипс' },
          { values: ['0-100', '100-0'], isDefault: true, note: 'мерный пояс' },
        ],
      }],
    })
  })

  it('inserts new RK diameters in order and adds duplicate diameters as variants', () => {
    renderWithConfirmAction(
      <RkExposureTableEditorDialog
        table={{
          fileName: 'Экспозиции по диаметрам',
          uploadedAt: '2026-08-09T00:00:00.000Z',
          entries: [
            { diameter: 57, options: [{ values: ['1'], isDefault: true, label: 'по 1 экспозиции', note: '' }] },
            { diameter: 89, options: [{ values: ['2'], isDefault: true, label: 'по 1 экспозиции', note: '' }] },
          ],
        }}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(true)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Добавить диаметр' }))
    fireEvent.change(screen.getByLabelText('Новый диаметр'), { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать столбец' }))

    expect(screen.getAllByLabelText(/^Диаметр группы/).map((input) => (input as HTMLInputElement).value)).toEqual(['57', '70', '89'])

    fireEvent.click(screen.getByRole('button', { name: 'Добавить диаметр' }))
    fireEvent.change(screen.getByLabelText('Новый диаметр'), { target: { value: '57' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать столбец' }))

    expect(screen.getAllByLabelText(/^Диаметр группы/)).toHaveLength(3)
    expect(screen.getByLabelText('Интервал варианта 57:2, строка 1')).toBeInTheDocument()
  })
})
