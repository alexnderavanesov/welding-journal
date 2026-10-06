import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LineProgramCalculationDialog } from './line-program-calculation-dialog'
import { explainLineProgram } from '@/lib/line-program-explanation'
import { calculateLineProgram } from '@/lib/line-program-calculation'
import { buildLineProgramDisplay } from '@/lib/line-program-display'
import { getProgramRemovalHints, projectProgramExcess } from '@/lib/line-program-excess'
import type { WeldRow } from '@/lib/dispatcher-types'

const read = vi.hoisted(() => vi.fn())
vi.mock('@/server/line-program', () => ({ getLineProgramExplanation: read }))
const line = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 10, configurationIssue: null, version: '2026-09-01' }
const rows: WeldRow[] = Array.from({ length: 55 }, (_, i) => ({ id: i + 1, joint: `F${i + 1}`, connectionType: 'С17', stamp1K: i === 54 ? 'B' : 'A', weldDate: '2026-09-01', hasRk: i < 3 ? 'да' : null }))
let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  read.mockReset().mockImplementation(async ({ data }) => explainLineProgram(rows, 10, 10, data))
})
afterEach(() => { cleanup(); client.clear(); focusManager.setFocused(undefined); onlineManager.setOnline(true) })
function mount(initialSelection?: React.ComponentProps<typeof LineProgramCalculationDialog>['initialSelection'], sourceRows = rows) {
  const raw = calculateLineProgram(sourceRows, 10, 10), groups = projectProgramExcess(1, sourceRows, raw, new Set())
  const display = buildLineProgramDisplay(sourceRows, groups, 10, 10, getProgramRemovalHints(1, sourceRows, raw, new Set()))
  const choose = vi.fn(), close = vi.fn()
  render(<QueryClientProvider client={client}><LineProgramCalculationDialog line={line} groups={[display.summary, ...display.stampRows]} initialSelection={initialSelection} stamp={initialSelection?.stamp} onChoose={choose} onClose={close} /></QueryClientProvider>)
  return { choose, close }
}
it('does not offset another stamp deficit against excess when explaining the line total', () => {
  mount(undefined, [1, 2, 3, 4].map(id => ({ id, connectionType: 'С17', weldDate: '2026-09-01', stamp1K: id === 4 ? 'B' : 'A', hasPvk: id === 4 ? null : 'да' })))
  const pvk = screen.getByTestId('demand-pvk')
  expect(pvk).toHaveTextContent('Превышение зачёта: 2.')
  expect(within(pvk).getByRole('button', { name: 'Зачтено, включая сверх нормы 3' })).toBeVisible()
  expect(within(pvk).getByRole('button', { name: 'К назначению 1' })).toBeVisible()
})
it('loads one chosen metric, keeps dialog open, and reuses fresh data without focus/reconnect requests', async () => {
  const { choose } = mount()
  expect(read).not.toHaveBeenCalled()
  const assigned = within(screen.getByTestId('demand-common')).getByRole('button', { name: 'Назначено в расчётной группе 3' })
  fireEvent.click(assigned)
  await screen.findByText(/Считаются стыки с «да»/)
  expect(read).toHaveBeenCalledExactlyOnceWith({ data: { id: 1, stamp: undefined, kind: 'common', list: 'assigned', page: 0 } })
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(choose).not.toHaveBeenCalled()
  expect(assigned).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(assigned)
  expect(screen.queryByRole('region', { name: 'Подробности расчёта' })).not.toBeInTheDocument()
  fireEvent.click(assigned)
  await screen.findByText(/Считаются стыки с «да»/)
  focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true)
  expect(read).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Показать стыки в рабочей таблице' }))
  expect(choose).toHaveBeenCalledWith({ stamp: undefined, kind: 'common', slice: 'assigned' })
})
it('opens the requested metric in its stamp/method and resets pagination and details on scope changes', async () => {
  mount({ stamp: 'A', kind: 'pvk', slice: 'missing' })
  await screen.findByText(/К назначению =/)
  expect(read).toHaveBeenLastCalledWith({ data: { id: 1, stamp: 'A', kind: 'pvk', list: 'missing', page: 0 } })
  fireEvent.click(screen.getByRole('button', { name: 'Страница 2' }))
  await waitFor(() => expect(read).toHaveBeenLastCalledWith({ data: { id: 1, stamp: 'A', kind: 'pvk', list: 'missing', page: 1 } }))
  fireEvent.change(screen.getByLabelText('Состав расчёта ПВК'), { target: { value: 'physical' } })
  await waitFor(() => expect(read).toHaveBeenLastCalledWith({ data: { id: 1, stamp: 'A', kind: 'pvk', list: 'physical', page: 0 } }))
  fireEvent.change(screen.getByLabelText('Клеймо в расчёте'), { target: { value: 'B' } })
  expect(screen.queryByRole('region', { name: 'Подробности расчёта' })).not.toBeInTheDocument()
  expect(read).toHaveBeenCalledTimes(3)
})
it('uses matched select styling and accessible method buttons without reading the active method twice', async () => {
  mount({ kind: 'common', slice: 'additional' })
  await screen.findByText(/«Дополнительный» закрывает норму/)
  const scope = screen.getByLabelText('Клеймо в расчёте'), list = screen.getByLabelText('Состав расчёта РК/УЗК')
  for (const select of [scope, list]) {
    expect(select).toHaveClass('h-10', 'rounded-xl', 'appearance-none', 'bg-none', 'pr-10')
    expect(select.parentElement?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  }
  const methods = within(screen.getByRole('group', { name: 'Метод подробного расчёта' }))
  const common = methods.getByRole('button', { name: 'РК - УЗК', pressed: true })
  fireEvent.click(common)
  expect(read).toHaveBeenCalledTimes(1)
  fireEvent.click(methods.getByRole('button', { name: 'ПВК', pressed: false }))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  expect(read).toHaveBeenLastCalledWith({ data: { id: 1, stamp: undefined, kind: 'pvk', list: 'additional', page: 0 } })
  expect(methods.getByRole('button', { name: 'ПВК' })).toHaveAttribute('aria-pressed', 'true')
  expect(common).toHaveAttribute('aria-pressed', 'false')
})
it('shows a retryable explanation error without hiding the calculation or mutating anything', async () => {
  read.mockRejectedValueOnce(new Error('Не удалось прочитать'))
  const { choose, close } = mount({ kind: 'common', slice: 'excess' })
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось прочитать')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByText(/«Лишнее» объединяет/)
  expect(read).toHaveBeenCalledTimes(2)
  expect(choose).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
})
