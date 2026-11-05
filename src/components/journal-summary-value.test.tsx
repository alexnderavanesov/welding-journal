import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from '@/lib/clipboard'
import { JournalSummaryValue } from './journal-summary-value'

vi.mock('@/lib/clipboard', () => ({ copyTextToClipboard: vi.fn() }))
beforeEach(() => vi.mocked(copyTextToClipboard).mockReset())
afterEach(() => vi.useRealTimers())
it('copies only the visible decimal number, keeps it visible and reports failure honestly', async () => {
  vi.useFakeTimers()
  vi.mocked(copyTextToClipboard).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  render(<JournalSummaryValue label="WDI" value={'5\u00a0936,75'} />)
  const button = screen.getByRole('button', { name: /Скопировать WDI: 5\s936,75/ })
  await act(async () => fireEvent.click(button))
  expect(copyTextToClipboard).toHaveBeenLastCalledWith('5936,75')
  expect(screen.getByRole('status')).toHaveTextContent('Скопировано')
  expect(button).toHaveTextContent('5 936,75')
  await act(async () => vi.advanceTimersByTimeAsync(1600))
  expect(screen.queryByRole('status')).toBeNull()
  await act(async () => fireEvent.click(button))
  expect(screen.getByRole('status')).toHaveTextContent('Не удалось скопировать')
})

it('does not attach a delayed success to a changed value', async () => {
  let finish!: (copied: boolean) => void
  vi.mocked(copyTextToClipboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = render(<JournalSummaryValue label="Стыков" value={2} />)
  fireEvent.click(screen.getByRole('button'))
  view.rerender(<JournalSummaryValue label="Стыков" value={3} />)
  await act(async () => finish(true))
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('button')).toHaveTextContent('3')
})
