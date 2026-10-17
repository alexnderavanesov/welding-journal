import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GridDateFilterOptions, type GridFilterOption } from './grid-value-filter'

afterEach(cleanup)

function setup(options: GridFilterOption[], initial: string[] = [], search = '') {
  const changes = vi.fn()
  function Test() {
    const [selected, setSelected] = useState(initial)
    return <GridDateFilterOptions options={options} selectedValues={new Set(selected)} search={search} onToggleValues={values => {
      const next = new Set(selected), remove = values.every(value => next.has(value))
      for (const value of values) remove ? next.delete(value) : next.add(value)
      changes([...next]); setSelected([...next])
    }} />
  }
  render(<Test />)
  return changes
}

describe('shared grid date filter', () => {
  it('expands year, month and day independently from selection, using displayed business dates and all exact timestamp values', () => {
    const first = '2026-10-01T21:10:00.001Z', sameSecond = '2026-10-01T21:10:00.002Z', second = '2026-10-02T10:00:00Z'
    const change = setup([
      { value: first, values: [first, sameSecond], label: '02.10.26 00:10:00', count: 3 },
      { value: second, values: [second], label: '02.10.26 13:00:00', count: 2 },
      { value: '', values: [''], label: '(пусто)', count: 4 },
      { value: 'legacy', values: ['legacy'], label: 'Старая дата', count: 1 },
    ], [sameSecond, 'hidden-selection'])
    expect(screen.getByRole('checkbox', { name: 'Год 2026' })).toBePartiallyChecked()
    expect(screen.queryByRole('checkbox', { name: 'Октябрь 2026' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть Год 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть Октябрь 2026' }))
    expect(screen.getByRole('checkbox', { name: 'День 02.10.2026' })).toBePartiallyChecked()
    expect(screen.queryByRole('checkbox', { name: 'День 01.10.2026' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть День 02.10.2026' }))
    expect(screen.getByRole('checkbox', { name: /02.10.26 00:10:00/ })).toBePartiallyChecked()
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'День 02.10.2026' }))
    expect(change.mock.lastCall![0]).toEqual([sameSecond, 'hidden-selection', first, second])
    expect(screen.getByRole('checkbox', { name: /пусто/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Старая дата/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Октябрь 2026' }))
    expect(change.mock.lastCall![0]).toEqual(['hidden-selection'])
  })

  it('keeps pure dates as day leaves, preserves period tokens, and auto-expands search matches', () => {
    const period = '01.10.2026 - 12.10.2026'
    const partialPeriod = ' - 03.10.2026'
    const change = setup([
      { value: '2026-10-02', values: ['2026-10-02'], label: '2026-10-02', count: 2 },
      { value: period, values: [period], label: period, count: 3 },
      { value: partialPeriod, values: [partialPeriod], label: partialPeriod, count: 1 },
      { value: '31.02.2026', values: ['31.02.2026'], label: '31.02.2026', count: 1 },
    ], [], '2026')
    expect(screen.getByRole('button', { name: 'Свернуть Год 2026' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: /День 02.10.2026/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /31.02.2026/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'День 01.10.2026' }))
    expect(change.mock.lastCall![0]).toEqual([period])
    fireEvent.click(screen.getByRole('checkbox', { name: 'День 02.10.2026' }))
    expect(change.mock.lastCall![0]).toEqual([period, '2026-10-02'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'День 03.10.2026' }))
    expect(change.mock.lastCall![0]).toEqual([period, '2026-10-02', partialPeriod])
  })

  it('keeps a large day collapsed while its year checkbox still selects every exact timestamp', () => {
    const options = Array.from({ length: 20_000 }, (_, index): GridFilterOption => {
      const value = new Date(Date.UTC(2026, 9, 1, 21, 0, index)).toISOString()
      const time = [Math.floor(index / 3600), Math.floor(index / 60) % 60, index % 60].map(value => String(value).padStart(2, '0')).join(':')
      return { value, values: [value], label: `02.10.26 ${time}`, count: 1 }
    })
    const change = setup(options)
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByText('20000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Год 2026' }))
    expect(change.mock.lastCall![0]).toHaveLength(20_000)
    expect(new Set(change.mock.lastCall![0]).size).toBe(20_000)
    expect(change.mock.lastCall![0][0]).toBe(options[0].value)
    expect(change.mock.lastCall![0].at(-1)).toBe(options.at(-1)!.value)
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })
})
