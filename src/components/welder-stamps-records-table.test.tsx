import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WelderStampsRecordsTable } from './welder-stamps-records-table'
import { createEmptyNaksPermit } from '@/lib/welder-stamp-permits'
import { createEmptyWelderStampDraft } from '@/lib/welder-stamp-registry'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function prepareTable() {
  vi.useFakeTimers({ toFake: ['Date'] })
  // Business dates use Europe/Moscow, independently of the runner's time zone.
  vi.setSystemTime(new Date('2026-11-05T20:59:00Z'))
  const record = {
    ...createEmptyWelderStampDraft(),
    id: 1,
    naksStamp: 'ABCD',
    naksPermits: [{ ...createEmptyNaksPermit(), id: 'expires-today', validTo: '2026-11-05' }],
  }
  const props = { records: [record], emptyMessage: 'Пусто', onDelete: vi.fn() }
  const result = render(<WelderStampsRecordsTable {...props} />)
  const row = screen.getByText('ABCD').closest('tr')!
  const permitIcon = () => row.cells[6].querySelector('svg')!
  expect(permitIcon()).toHaveClass('text-amber-600')
  return { ...result, props, row, permitIcon }
}

describe('memoized welder row business date', () => {
  it('refreshes validity on a local context-menu render after midnight without changing table props', () => {
    const { row, permitIcon } = prepareTable()
    vi.setSystemTime(new Date('2026-11-05T21:01:00Z'))
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 })
    expect(screen.getByText('Открыть карточку')).toBeVisible()
    expect(permitIcon()).toHaveClass('text-rose-600')
  })

  it('refreshes validity when the parent renders after midnight with unchanged records and callbacks', () => {
    const { rerender, props, permitIcon } = prepareTable()
    vi.setSystemTime(new Date('2026-11-05T21:01:00Z'))
    rerender(<WelderStampsRecordsTable {...props} />)
    expect(permitIcon()).toHaveClass('text-rose-600')
  })
})
