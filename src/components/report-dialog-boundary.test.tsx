import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ReportDialogBoundary } from './report-dialog-boundary'
const retry = vi.hoisted(() => vi.fn())
vi.mock('@/lib/app-module-retry', () => ({ retryAppModules: retry }))

it('contains a failed dialog import without automatically reloading the journal', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const close = vi.fn()
  function FailedDialog(): never { throw new Error('Failed to fetch dynamically imported module') }
  try {
    render(<><p>Открытый журнал</p><ReportDialogBoundary onClose={close}><FailedDialog /></ReportDialogBoundary></>)
    expect(screen.getByText('Открытый журнал')).toBeVisible()
    expect(screen.getByRole('dialog', { name: 'Не удалось открыть окно' })).toBeVisible()
    expect(retry).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Закрыть' }).at(-1)!)
    expect(close).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить страницу' }))
    expect(retry).toHaveBeenCalledOnce()
  } finally { error.mockRestore() }
})
