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

    fireEvent.paste(screen.getByLabelText('Диаметр строки 1'), {
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

  it('keeps row creation available in the RK exposure dialog footer', () => {
    renderWithConfirmAction(
      <RkExposureTableEditorDialog table={null} onClose={vi.fn()} onSave={vi.fn().mockResolvedValue(true)} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }))

    expect(screen.getByLabelText('Диаметр строки 2')).toBeInTheDocument()
  })
})
