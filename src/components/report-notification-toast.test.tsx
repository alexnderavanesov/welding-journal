import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReportNotificationToast } from '@/components/report-notification-toast'

describe('ReportNotificationToast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('dismisses a report message after ten seconds', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    render(
      <ReportNotificationToast
        message="Выберите один или несколько стыков"
        onDismiss={onDismiss}
      />,
    )

    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Выберите один или несколько стыков')
    expect(toast).toHaveClass('bottom-20', 'xl:bottom-5', 'xl:right-20', 'z-[220]', 'max-w-sm')
    expect(toast.parentElement).toBe(document.body)

    act(() => vi.advanceTimersByTime(9_999))
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('can be closed manually and pauses automatic dismissal while hovered', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    render(
      <ReportNotificationToast
        message="Заявка создана"
        tone="success"
        onDismiss={onDismiss}
      />,
    )

    const toast = screen.getByRole('status')
    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(10_000))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.mouseLeave(toast)
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('can dismiss a loading error without a parent state callback', () => {
    render(
      <ReportNotificationToast
        message="Не удалось загрузить данные отчета"
        tone="error"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('moves above a modal footer when a dialog opens after the message appears', async () => {
    render(<ReportNotificationToast message="Запись сохранена" />)
    const toast = screen.getByRole('status')
    const modal = document.createElement('div')
    modal.dataset.modalDialog = 'true'

    document.body.appendChild(modal)
    await waitFor(() => expect(toast).toHaveClass('bottom-24', 'xl:bottom-24', 'xl:right-6'))

    modal.remove()
    await waitFor(() => expect(toast).toHaveClass('bottom-20', 'xl:bottom-5', 'xl:right-20'))
  })
})
