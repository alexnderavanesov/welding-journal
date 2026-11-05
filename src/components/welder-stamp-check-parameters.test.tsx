import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { WelderStampCheckParameters } from './welder-stamp-check-parameters'
afterEach(cleanup)
it('preserves all twelve C/U and one T C/U/T qualification examples after moving the page', () => {
  render(<WelderStampCheckParameters />)
  const panel = within(screen.getByRole('region', { name: 'Таблица параметров проверки клейм' }))
    const table = panel.getByRole('table')
    expect(within(table).getAllByRole('columnheader').at(-1)).toHaveTextContent('Пример')
    const scenarios = table.querySelectorAll('[data-stamp-check-scenario]')
    expect(scenarios).toHaveLength(13)
    expect(table.querySelectorAll('tbody')).toHaveLength(4)
    for (const group of Array.from(table.querySelectorAll('tbody')).slice(0, 3)) {
      const rows = group.querySelectorAll('[data-stamp-check-scenario]')
      expect([...rows].map(row => `${row.children[0].textContent?.trim()[0]}:${row.children[0].textContent?.includes('Комбинированный')}`))
        .toEqual(['1:false', '2:false', '1:true', '2:true'])
      for (const row of rows) expect(row.children[2]).toHaveTextContent(/С17|У19/)
    }
    for (const group of Array.from(table.querySelectorAll('tbody')).slice(3)) {
      const rows = group.querySelectorAll('[data-stamp-check-scenario]')
      expect([...rows].map(row => `${row.children[0].textContent?.trim()[0]}:${row.children[0].textContent?.includes('Комбинированный')}`))
        .toEqual(['1:false'])
      for (const row of rows) expect(row.children[2]).toHaveTextContent('Т ·')
    }
    expect(panel.getAllByText('Диаметр: D1 ИЛИ D2')).toHaveLength(4)
    expect(panel.getAllByText('Если D1 < D2 → D1 И T1')).toHaveLength(4)
    expect(panel.getAllByText('Если D2 < D1 → D2 И T2')).toHaveLength(4)
    expect(panel.getAllByText('Если D1 = D2 → общий D И меньшая T')).toHaveLength(4)
    expect(panel.getAllByText('Группа 1 → D1 И T1')).toHaveLength(4)
    expect(panel.getAllByText('Группа 2 → D2 И T2')).toHaveLength(4)
})
