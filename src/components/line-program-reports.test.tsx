import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { LineProgramReports, type LineProgramReportsHandle } from './line-program-reports'
import type { PrintableReport } from '@/lib/printable-report'

const mocks = vi.hoisted(() => ({ report: vi.fn() }))
vi.mock('@/server/line-program-report', () => ({ getLineProgramReport: mocks.report }))
beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); mocks.report.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const report: PrintableReport = { title: 'Сводка по линиям', tables: [{ title: 'Линии', columns: ['Линия'], rows: [['L1']] }] }
function choose(label = 'Сводка по линиям') {
  fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
  fireEvent.click(screen.getByRole('button', { name: label }))
}
function mount() { return render(<LineProgramReports ids={[1, 2]} context="Отбор" disabled={false} />) }

it('uses the shared menu, dismisses it without loading and does not fetch on render, focus or reconnect', () => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
  expect(screen.getByRole('button', { name: 'Сводка по клеймам' })).toBeVisible()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('button', { name: 'Показать' })).toHaveFocus()
  expect(screen.queryByRole('button', { name: 'Сводка по клеймам' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
  fireEvent.pointerDown(document.body)
  fireEvent.focus(window); fireEvent(window, new Event('online'))
  expect(screen.queryByRole('button', { name: 'Сводка по клеймам' })).not.toBeInTheDocument()
  expect(mocks.report).not.toHaveBeenCalled()
})

it('previews with blocked popups, prints only the report and closes from inside the frame', async () => {
  const popup = vi.spyOn(window, 'open').mockReturnValue(null)
  mocks.report.mockResolvedValue(report)
  mount(); choose()
  const frame = await screen.findByTitle('Сводка по линиям') as HTMLIFrameElement
  expect(frame.srcdoc).toContain('<td>L1</td>')
  expect(frame.srcdoc).not.toContain('id="print-report"')
  // WebKit needs script-enabled frames for parent-owned wheel handlers;
  // document scripts remain forbidden by the first CSP in the frame.
  expect(frame.srcdoc).toContain("script-src 'none'")
  expect(frame.srcdoc).toContain("form-action 'none'")
  expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation')
  fireEvent.load(frame)
  expect(screen.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Печать / Сохранить PDF' }))
  const full = screen.getByTitle('Полный отчёт для печати') as HTMLIFrameElement
  expect(full.srcdoc).toContain('<td>L1</td>')
  vi.spyOn(full.contentWindow!, 'focus').mockImplementation(() => {})
  const print = vi.spyOn(full.contentWindow!, 'print').mockImplementation(() => {})
  fireEvent.load(full)
  expect(print).toHaveBeenCalledOnce()
  expect(popup).not.toHaveBeenCalled()
  expect(mocks.report).toHaveBeenCalledExactlyOnceWith({ data: { ids: [1, 2], mode: 'lines', context: 'Отбор' } })
  fireEvent.keyDown(frame.contentDocument!, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Показать' })).toHaveFocus())
})

it('offers an explicit retry after failure, retaining the selected report type', async () => {
  mocks.report.mockRejectedValueOnce(new Error('Нет соединения')).mockResolvedValueOnce(report)
  mount(); choose('Сводка по клеймам')
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет соединения')
  expect(screen.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByTitle('Сводка по линиям')
  expect(mocks.report).toHaveBeenCalledTimes(2)
  expect(mocks.report).toHaveBeenLastCalledWith({ data: { ids: [1, 2], mode: 'stamps', context: 'Отбор' } })
})

it('discards a late response after close and cannot overwrite a newer preview', async () => {
  let resolve!: (value: PrintableReport) => void
  mocks.report.mockReturnValueOnce(new Promise<PrintableReport>(done => { resolve = done })).mockResolvedValueOnce({ title: 'Новая сводка' })
  mount(); choose()
  expect(screen.getByRole('status')).toHaveTextContent('Подготавливаем')
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть предпросмотр' }))
  choose('Сводка по клеймам')
  await screen.findByTitle('Новая сводка')
  await act(async () => resolve(report))
  expect(screen.queryByTitle('Сводка по линиям')).not.toBeInTheDocument()
  expect(screen.getByTitle('Новая сводка')).toBeVisible()
  expect(mocks.report).toHaveBeenCalledTimes(2)
})

it('keeps the preview open when printing fails and permits retry', async () => {
  mocks.report.mockResolvedValue(report)
  mount(); choose()
  const frame = await screen.findByTitle('Сводка по линиям') as HTMLIFrameElement
  fireEvent.load(frame)
  fireEvent.click(screen.getByRole('button', { name: 'Печать / Сохранить PDF' }))
  const failed = screen.getByTitle('Полный отчёт для печати') as HTMLIFrameElement
  vi.spyOn(failed.contentWindow!, 'focus').mockImplementation(() => {})
  vi.spyOn(failed.contentWindow!, 'print').mockImplementation(() => { throw new Error('Unsupported') })
  fireEvent.load(failed)
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось открыть печать')
  fireEvent.click(screen.getByRole('button', { name: 'Печать / Сохранить PDF' }))
  const retried = screen.getByTitle('Полный отчёт для печати') as HTMLIFrameElement
  vi.spyOn(retried.contentWindow!, 'focus').mockImplementation(() => {})
  const print = vi.spyOn(retried.contentWindow!, 'print').mockImplementation(() => {})
  fireEvent.load(retried)
  expect(print).toHaveBeenCalledOnce()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(mocks.report).toHaveBeenCalledOnce()
})

it('retries the captured context-menu scope after props change and restores its trigger focus', async () => {
  const ref = createRef<LineProgramReportsHandle>()
  const renderReports = (ids: number[]) => <><button>Клеймо A</button><LineProgramReports ref={ref} ids={ids} context="Текущий список" disabled={false} /></>
  const view = render(renderReports([1, 2]))
  const trigger = screen.getByRole('button', { name: 'Клеймо A' })
  trigger.focus()
  mocks.report.mockRejectedValueOnce(new Error('Нет соединения')).mockResolvedValueOnce(report)
  const request = { ids: [1], mode: 'stamps' as const, stamp: 'A', context: 'Линия L1 · клеймо A' }
  act(() => ref.current!.open(request))
  await screen.findByRole('alert')
  view.rerender(renderReports([3]))
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByTitle('Сводка по линиям')
  expect(mocks.report.mock.calls.map(([args]) => args)).toEqual([{ data: request }, { data: request }])
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(trigger).toHaveFocus())
})
