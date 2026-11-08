import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import type { WelderStatisticsRow } from '@/lib/welder-statistics-summary'
import { StatisticsPage } from './statistics-page'
import { buildStatisticsServerResult } from '@/lib/statistics-server-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/use-statistics-server-query', () => ({ useStatisticsServerQuery: mocks.query }))
vi.mock('@/components/line-program-page', () => ({ LineProgramPage: () => null }))
// jsdom has no virtual viewport geometry. Keep the screen's real filtering,
// renderers, detail chart and callbacks; browser tests exercise AG's lifecycle.
vi.mock('./read-only-grid', () => ({ ReadOnlyGrid: ({ rowData, columnDefs, detailCellRenderer: Detail, expandedIds }: {
  rowData: WelderStatisticsRow[]
  columnDefs: Array<{ cellRenderer?: ComponentType<{ data: WelderStatisticsRow }> }>
  detailCellRenderer: ComponentType<{ data: WelderStatisticsRow }>
  expandedIds: ReadonlySet<string>
}) => <div>{rowData.map(data => <div key={data.stamp}>
  {columnDefs.map(({ cellRenderer: Cell }, index) => Cell ? <Cell key={index} data={data} /> : null)}
  {expandedIds.has(data.stamp) ? <Detail data={data} /> : null}
</div>)}</div> }))
afterEach(cleanup)

it('keeps the actual welder detail chart and opens exact daily/all-joint sets after filtering and reopening', async () => {
  const data = buildStatisticsServerResult({
    rows: [1, 2, 3].map(id => ({ id, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `F${id}`,
      weldDate: id === 3 ? '2026-09-02' : '2026-09-01', materialGroup: 'М01',
      stamp1KFact: 'AB12', stamp1ZFact: 'AB12',
    })), welderStamps: [], systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
    request: { tab: 'welders', unit: 'joints', from: '', to: '' },
  })
  mocks.query.mockReturnValue({ data, isSuccess: true, isPlaceholderData: false, fetchStatus: 'idle' })
  const open = vi.fn()
  const { container } = render(<StatisticsPage fixedTab="welders" onOpenWeldRowIds={open} />)
  const grid = within(container.querySelector<HTMLElement>('[data-statistics-grid="welders"]')!)
  fireEvent.click(await grid.findByRole('button', { name: 'Подробности сварщика AB12' }))
  await grid.findByText('Динамика по дням', { exact: true })
  fireEvent.click(grid.getByTitle(/01.09.2026:.*Открыть стыки/))
  expect(open).toHaveBeenLastCalledWith([1, 2], expect.stringContaining('01.09.2026'))
  fireEvent.click(grid.getByTitle('Открыть стыки сварщика AB12'))
  expect(open).toHaveBeenLastCalledWith([1, 2, 3], expect.any(String))
  const search = screen.getByPlaceholderText(/Клеймо.*ФИО/)
  fireEvent.change(search, { target: { value: 'missing' } })
  await waitFor(() => expect(grid.queryByRole('button', { name: 'Подробности сварщика AB12' })).toBeNull())
  fireEvent.change(search, { target: { value: 'AB12' } })
  await grid.findByText('Динамика по дням', { exact: true })
  fireEvent.click(grid.getByTitle(/02.09.2026:.*Открыть стыки/))
  expect(open).toHaveBeenLastCalledWith([3], expect.stringContaining('02.09.2026'))
})

it('shows a half-joint contribution in the welder table, cards and daily detail without rounding it to one', async () => {
  localStorage.clear()
  const data = buildStatisticsServerResult({
    rows: [{ id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', weldDate: '2026-09-01',
      materialGroup: 'М01', stamp1KFact: 'PAIR-A', stamp1ZFact: 'PAIR-B' }],
    welderStamps: [], systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
    request: { tab: 'welders', unit: 'joints', from: '', to: '' },
  })
  mocks.query.mockReturnValue({ data, isSuccess: true, isPlaceholderData: false, fetchStatus: 'idle' })
  const { container } = render(<StatisticsPage fixedTab="welders" />)
  const grid = within(container.querySelector<HTMLElement>('[data-statistics-grid="welders"]')!)
  expect(grid.getAllByText('0,5', { exact: true }).length).toBeGreaterThanOrEqual(2)
  fireEvent.click(await grid.findByRole('button', { name: 'Подробности сварщика PAIR-A' }))
  expect(grid.getByTitle(/01.09.2026: 0,5 /)).toBeVisible()
  expect(grid.getAllByText('F: 0,5', { exact: true }).length).toBeGreaterThan(0)
})
