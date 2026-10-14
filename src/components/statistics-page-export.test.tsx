import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StatisticsPage } from './statistics-page'
import { buildStatisticsServerResult, type StatisticsServerRequest, type StatisticsServerResult } from '@/lib/statistics-server-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { PrintableReport } from '@/lib/printable-report'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn<(input: { data: StatisticsServerRequest }) => Promise<StatisticsServerResult>>(),
  download: vi.fn<(report: PrintableReport) => Promise<void>>(),
}))
vi.mock('@/server/statistics', () => ({ getStatisticsServerResult: mocks.rpc }))
vi.mock('@/lib/download-printable-report', () => ({ downloadPrintableReport: mocks.download }))
vi.mock('@/components/line-program-page', () => ({ LineProgramPage: () => null }))
// Keep the real query observer, report builder and snapshot lifecycle. Only the
// iframe/download boundary is replaced; browser/XLSX coverage is in the E2E.
vi.mock('@/components/printable-report-preview', () => ({
  PrintableReportPreview: ({ report, onDownloadExcel, onClose }: {
    report: PrintableReport | null; onDownloadExcel?: () => Promise<void>; onClose: () => void
  }) => <div role="dialog" aria-label="Предпросмотр отчёта">
    {report ? <pre data-testid="preview-report">{JSON.stringify(report)}</pre> : null}
    <button disabled={!onDownloadExcel} onClick={() => { void onDownloadExcel?.() }}>Скачать Excel</button>
    <button onClick={onClose}>Закрыть предпросмотр</button>
  </div>,
}))

const clients: QueryClient[] = []
beforeEach(() => {
  mocks.rpc.mockReset()
  mocks.download.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach(client => client.clear())
  onlineManager.setOnline(true)
})

function deferredResult() {
  let resolve!: (result: StatisticsServerResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<StatisticsServerResult>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function resultFor(request: StatisticsServerRequest, welded: number) {
  // Complete transport fixture with deliberately distinguishable old/new
  // totals. Expected numbers below are constants, not calculated from the UI.
  const empty = buildStatisticsServerResult({ rows: [], welderStamps: [], systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, request })
  return {
    ...empty,
    projectOptions: [{ value: 'project a', label: 'Project A' }],
    subtitleOptions: [{ value: 'sub a', label: 'Sub A' }],
    summary: { ...empty.summary, welded, totalRows: welded },
  }
}

function renderStatistics() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
  clients.push(client)
  render(<QueryClientProvider client={client}><StatisticsPage /></QueryClientProvider>)
  return client
}

const reportButton = () => screen.getByRole('button', { name: 'Отчет PDF' })
const readPreview = (): PrintableReport => JSON.parse(screen.getByTestId('preview-report').textContent!)
const metric = (report: PrintableReport) => report.metrics?.find(item => item.label === 'Сварено за период')?.value
const meta = (report: PrintableReport, label: string) => report.meta?.find(item => item.label === label)?.value
const closePreview = () => fireEvent.click(screen.getByRole('button', { name: 'Закрыть предпросмотр' }))

async function openPreview() {
  fireEvent.click(reportButton())
  await screen.findByTestId('preview-report')
  return readPreview()
}

it('blocks initial pending and error states, exposes the cause and retries only explicitly', async () => {
  const first = deferredResult(), retry = deferredResult()
  mocks.rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
  renderStatistics()
  expect(reportButton()).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Обновляем статистику для выбранных параметров')
  expect(screen.getByText('Сварено за период', { exact: true })).not.toBeVisible()
  fireEvent.click(reportButton())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => first.reject(new Error('Расчёт недоступен')))
  expect(await screen.findByRole('alert')).toHaveTextContent('Расчёт недоступен')
  expect(reportButton()).toBeDisabled()
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Повторить расчёт' }))
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
  expect(reportButton()).toBeDisabled()
  await act(async () => retry.resolve(resultFor(mocks.rpc.mock.calls[1][0].data, 5)))
  await waitFor(() => expect(reportButton()).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(metric(await openPreview())).toBe('5')
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(metric(mocks.download.mock.calls[0][0])).toBe('5')
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
})

const transitions: Array<{
  name: string
  change: () => void
  expectedRequest: Partial<StatisticsServerRequest>
  expectedMeta?: [string, string]
  expectedTitle?: string
}> = [
  { name: 'unit', change: () => fireEvent.click(screen.getByRole('button', { name: 'Стыки' })),
    expectedRequest: { unit: 'joints' }, expectedMeta: ['Единица', 'стыки'] },
  { name: 'project scope', change: () => fireEvent.change(screen.getByRole('combobox', { name: 'Проект' }), { target: { value: 'project a' } }),
    expectedRequest: { projectFilter: 'project a' }, expectedMeta: ['Срез', 'проект Project A'] },
  { name: 'subtitle scope', change: () => fireEvent.click(screen.getByRole('button', { name: 'Sub A' })),
    expectedRequest: { selectedSubtitles: ['sub a'] }, expectedMeta: ['Срез', 'шифры Sub A'] },
  { name: 'period start', change: () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Период отчета' }), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Период с'), { target: { value: '2000-01-01' } })
  }, expectedRequest: { from: '2000-01-01' } },
  { name: 'period end', change: () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Период отчета' }), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Период по'), { target: { value: '2099-12-31' } })
  }, expectedRequest: { to: '2099-12-31' } },
  { name: 'joint type', change: () => fireEvent.click(screen.getByRole('button', { name: 'F поле' })),
    expectedRequest: { jointFilter: 'f' }, expectedMeta: ['Тип стыка', 'F поле'] },
  ...([
    ['ЛНК', 'lnk', 'Статистика ЛНК'],
    ['ПСТО', 'psto', 'Статистика ПСТО'],
    ['Сварщики', 'welders', 'Статистика сварщиков'],
    ['Полинейная сводка', 'lineSummary', 'Полинейная сводка'],
  ] as const).map(([label, tab, title]) => ({ name: `tab ${tab}`,
    change: () => fireEvent.click(screen.getByRole('button', { name: label })),
    expectedRequest: { tab }, expectedTitle: title })),
]

it.each(transitions)('does not use previous-key data when changing $name', async scenario => {
  const next = deferredResult()
  mocks.rpc.mockImplementationOnce(async ({ data }) => resultFor(data, 5)).mockReturnValue(next.promise)
  renderStatistics()
  await waitFor(() => expect(reportButton()).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Настройки отчета' }))
  scenario.change()
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
  expect(mocks.rpc.mock.calls[1][0].data).toMatchObject(scenario.expectedRequest)
  expect(reportButton()).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Обновляем статистику для выбранных параметров')
  fireEvent.click(reportButton())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(mocks.download).not.toHaveBeenCalled()
  await act(async () => next.resolve(resultFor(mocks.rpc.mock.calls[1][0].data, 2)))
  await waitFor(() => expect(reportButton()).toBeEnabled())
  const report = await openPreview()
  if (scenario.expectedMeta) expect(meta(report, scenario.expectedMeta[0])).toBe(scenario.expectedMeta[1])
  if (scenario.expectedTitle) expect(report.title).toBe(scenario.expectedTitle)
  else expect(metric(report)).toBe('2')
  if (scenario.name === 'period start') expect(meta(report, 'Период')).toMatch(/^01\.01\.2000 - /)
  if (scenario.name === 'period end') expect(meta(report, 'Период')).toMatch(/ - 31\.12\.2099$/)
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(mocks.download).toHaveBeenCalledWith(report)
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
})

it('uses a fresh cached key immediately and ignores a late response for another unit', async () => {
  const next = deferredResult()
  mocks.rpc.mockImplementationOnce(async ({ data }) => resultFor(data, 5)).mockReturnValue(next.promise)
  renderStatistics()
  await waitFor(() => expect(reportButton()).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Настройки отчета' }))
  fireEvent.click(screen.getByRole('button', { name: 'Стыки' }))
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
  expect(reportButton()).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'WDI' }))
  expect(reportButton()).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
  await act(async () => next.resolve(resultFor(mocks.rpc.mock.calls[1][0].data, 2)))
  const report = await openPreview()
  expect(meta(report, 'Единица')).toBe('WDI')
  expect(metric(report)).toBe('5')
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
})

it('keeps an open snapshot coherent during refetch/error and exports new data only after recovery', async () => {
  const update = deferredResult(), retry = deferredResult()
  mocks.rpc.mockImplementationOnce(async ({ data }) => resultFor(data, 5))
    .mockReturnValueOnce(update.promise).mockReturnValueOnce(retry.promise)
  const client = renderStatistics()
  await waitFor(() => expect(reportButton()).toBeEnabled())
  const snapshot = await openPreview()
  act(() => { void client.invalidateQueries({ queryKey: ['statistics-server'] }) })
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
  expect(reportButton()).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(mocks.download).toHaveBeenLastCalledWith(snapshot)
  await act(async () => update.reject(new Error('Обновление не удалось')))
  expect(await screen.findByRole('alert')).toHaveTextContent('Обновление не удалось')
  expect(reportButton()).toBeDisabled()
  expect(readPreview()).toEqual(snapshot)
  closePreview()
  fireEvent.click(reportButton())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить расчёт' }))
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(3))
  expect(screen.getByRole('status')).toHaveTextContent('Обновляем статистику для выбранных параметров')
  expect(screen.getByRole('alert')).toHaveTextContent('Обновление не удалось')
  await act(async () => retry.resolve(resultFor(mocks.rpc.mock.calls[2][0].data, 2)))
  await waitFor(() => expect(reportButton()).toBeEnabled())
  expect(metric(await openPreview())).toBe('2')
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(metric(mocks.download.mock.calls[1][0])).toBe('2')
})

it('preserves both labels and values of an open snapshot when filters change and finish loading', async () => {
  const next = deferredResult()
  mocks.rpc.mockImplementationOnce(async ({ data }) => resultFor(data, 5)).mockReturnValue(next.promise)
  renderStatistics()
  await waitFor(() => expect(reportButton()).toBeEnabled())
  const original = await openPreview()
  expect(meta(original, 'Единица')).toBe('WDI')
  expect(metric(original)).toBe('5')
  fireEvent.click(screen.getByRole('button', { name: 'Настройки отчета' }))
  fireEvent.click(screen.getByRole('button', { name: 'Стыки' }))
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
  expect(reportButton()).toBeDisabled()
  expect(readPreview()).toEqual(original)
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(mocks.download).toHaveBeenLastCalledWith(original)
  await act(async () => next.resolve(resultFor(mocks.rpc.mock.calls[1][0].data, 2)))
  await waitFor(() => expect(reportButton()).toBeEnabled())
  expect(readPreview()).toEqual(original)
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(mocks.download).toHaveBeenLastCalledWith(original)
  closePreview()
  const current = await openPreview()
  expect(meta(current, 'Единица')).toBe('стыки')
  expect(metric(current)).toBe('2')
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(mocks.download).toHaveBeenLastCalledWith(current)
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
})

it('closes a previous-tab preview and waits for the newly selected tab', async () => {
  const next = deferredResult()
  mocks.rpc.mockImplementationOnce(async ({ data }) => resultFor(data, 5)).mockReturnValue(next.promise)
  renderStatistics()
  await waitFor(() => expect(reportButton()).toBeEnabled())
  await openPreview()
  fireEvent.click(screen.getByRole('button', { name: 'ЛНК' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(reportButton()).toBeDisabled()
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
  await act(async () => next.resolve(resultFor(mocks.rpc.mock.calls[1][0].data, 2)))
  await waitFor(() => expect(reportButton()).toBeEnabled())
  expect((await openPreview()).title).toBe('Статистика ЛНК')
  expect(mocks.download).not.toHaveBeenCalled()
})

it('allows a successfully calculated empty selection without treating it as pending', async () => {
  mocks.rpc.mockImplementation(async ({ data }) => resultFor(data, 0))
  renderStatistics()
  await waitFor(() => expect(reportButton()).toBeEnabled())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(metric(await openPreview())).toBe('0')
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(metric(mocks.download.mock.calls[0][0])).toBe('0')
})

it('keeps a paused initial query unavailable instead of exporting an empty fallback', async () => {
  const pending = deferredResult()
  mocks.rpc.mockReturnValue(pending.promise)
  onlineManager.setOnline(false)
  renderStatistics()
  expect(reportButton()).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Ожидаем подключения')
  expect(mocks.rpc).not.toHaveBeenCalled()
  act(() => onlineManager.setOnline(true))
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
  expect(reportButton()).toBeDisabled()
  await act(async () => pending.resolve(resultFor(mocks.rpc.mock.calls[0][0].data, 5)))
  await waitFor(() => expect(reportButton()).toBeEnabled())
})
