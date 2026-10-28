import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PrintableReportPreview } from './printable-report-preview'

beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('prepares horizontal print parts for a wide single-page preview without changing the preview', () => {
  const columns = ['Линия', 'Стык', ...Array.from({ length: 20 }, (_, i) => `Поле ${i}`)]
  render(<PrintableReportPreview report={{ title: 'Wide', tables: [{ title: '', columns, rows: [columns] }] }}
    busy={false} error="" onClose={vi.fn()} onRetry={vi.fn()} />)
  const preview = screen.getByTitle('Wide') as HTMLIFrameElement
  fireEvent.load(preview)
  const original = preview.srcdoc
  fireEvent.click(screen.getByRole('button', { name: 'Печать / Сохранить PDF' }))
  const full = screen.getByTitle('Полный отчёт для печати') as HTMLIFrameElement
  const target = full.contentWindow!
  vi.spyOn(target, 'focus').mockImplementation(() => {})
  const print = vi.spyOn(target, 'print').mockImplementation(() => target.dispatchEvent(new Event('afterprint')))
  expect(full.srcdoc).toContain('Часть 1 из')
  expect(full.srcdoc).toContain('print-continuation')
  expect(preview.srcdoc).toBe(original)
  fireEvent.load(full)
  expect(print).toHaveBeenCalledOnce()
})

it('cancels an unfinished file request when the preview closes', async () => {
  let signal: AbortSignal | undefined
  const download = vi.fn((requestSignal?: AbortSignal) => {
    signal = requestSignal
    return new Promise<void>(resolve => requestSignal!.addEventListener('abort', () => resolve(), { once: true }))
  })
  const { unmount } = render(<PrintableReportPreview report={{ title: 'Журнал' }} busy={false} error="" onClose={vi.fn()} onRetry={vi.fn()} onDownloadExcel={download} />)
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(signal?.aborted).toBe(false)
  await act(async () => unmount())
  expect(signal?.aborted).toBe(true)
  expect(download).toHaveBeenCalledOnce()
})

it('keeps Escape inside the document working after the parent updates its close callback', () => {
  const originalClose = vi.fn(), currentClose = vi.fn()
  const props = { report: { title: 'Document' }, busy: false, error: '', onRetry: vi.fn() }
  const { rerender } = render(<PrintableReportPreview {...props} onClose={originalClose} />)
  const iframe = screen.getByTitle('Document') as HTMLIFrameElement
  fireEvent.load(iframe)
  iframe.focus()
  rerender(<PrintableReportPreview {...props} onClose={currentClose} />)
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  iframe.contentDocument!.body.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(currentClose).toHaveBeenCalledOnce()
  expect(originalClose).not.toHaveBeenCalled()
  expect(iframe).toHaveFocus()
})

it.each([1001, 10000])('blocks button and keyboard printing of %i rows without preparing a full document', count => {
  const report = { title: 'Large', tables: [{ title: '', columns: ['Joint'], rows: Array.from({ length: count }, (_, i) => [`S${i}`]) }] }
  const props = { busy: false, error: '', onClose: vi.fn(), onRetry: vi.fn(), onDownloadExcel: vi.fn() }
  render(<PrintableReportPreview {...props} report={report} />)
  const frame = screen.getByTitle('Large') as HTMLIFrameElement
  fireEvent.load(frame)
  const print = vi.spyOn(frame.contentWindow!, 'print').mockImplementation(() => {})
  expect(screen.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(`В отчёте ${count} строк`)
  expect(screen.getByRole('button', { name: 'Скачать Excel' })).toBeEnabled()
  expect(screen.queryByText(/Excel и печать\/PDF — весь отчёт/)).not.toBeInTheDocument()
  for (const doc of [document, frame.contentDocument!]) {
    for (const key of ['ctrlKey', 'metaKey']) {
      const event = new KeyboardEvent('keydown', { key: 'p', [key]: true, bubbles: true, cancelable: true })
      doc.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  }
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  fireEvent.load(frame)
  expect(screen.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeDisabled()
  expect(screen.queryByTitle('Полный отчёт для печати')).not.toBeInTheDocument()
  expect(print).not.toHaveBeenCalled()
})

it('recalculates the boundary on report replacement and prints all 1000 allowed rows', () => {
  const props = { busy: false, error: '', onClose: vi.fn(), onRetry: vi.fn() }
  const large = { title: 'Boundary', tables: [{ title: '', columns: ['Joint'], rows: Array.from({ length: 1001 }, (_, i) => [`S${i}`]) }] }
  const { rerender } = render(<PrintableReportPreview {...props} report={large} />)
  fireEvent.load(screen.getByTitle('Boundary'))
  expect(screen.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeDisabled()
  rerender(<PrintableReportPreview {...props} report={{ ...large, tables: [{ ...large.tables[0], rows: large.tables[0].rows.slice(0, 1000) }] }} />)
  fireEvent.load(screen.getByTitle('Boundary'))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  const print = screen.getByRole('button', { name: 'Печать / Сохранить PDF' })
  expect(print).toBeEnabled()
  fireEvent.click(print)
  const full = screen.getByTitle('Полный отчёт для печати') as HTMLIFrameElement
  expect(full.srcdoc).toContain('>S999<')
  expect(full.srcdoc).not.toContain('>S1000<')
  rerender(<PrintableReportPreview {...props} report={large} />)
  expect(full.isConnected).toBe(false)
})

it('keeps Excel errors in the modal, allows retry and prevents double downloads', async () => {
  let resolve!: () => void
  const download = vi.fn().mockRejectedValueOnce(new Error('Failure')).mockImplementationOnce(() => new Promise<void>(done => { resolve = done }))
  render(<PrintableReportPreview report={{ title: 'Журнал' }} busy={false} error="" onClose={vi.fn()} onRetry={vi.fn()} onDownloadExcel={download} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' })))
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось скачать Excel')
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  const pending = screen.getByRole('button', { name: 'Подготавливаем Excel…' })
  expect(pending).toBeDisabled()
  fireEvent.click(pending)
  expect(download).toHaveBeenCalledTimes(2)
  await act(async () => resolve())
  expect(screen.getByRole('button', { name: 'Скачать Excel' })).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('pages a snapshot, resets a new report and removes deferred print on close', () => {
  const report = { title: 'Paged', tables: [{ title: '', columns: ['Joint'], rows: Array.from({ length: 205 }, (_, i) => [`S${i + 1}`]) }] }
  const props = { busy: false, error: '', onClose: vi.fn(), onRetry: vi.fn() }
  const { rerender, unmount } = render(<PrintableReportPreview {...props} report={report} />)
  const iframe = () => screen.getByTitle('Paged') as HTMLIFrameElement
  expect(iframe().srcdoc.match(/<tr/g)).toHaveLength(101)
  expect(iframe().srcdoc).not.toContain('>S101<')
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  expect(iframe().srcdoc).toContain('>S101<')
  expect(iframe().srcdoc).not.toContain('>S1<')
  fireEvent.load(iframe())
  fireEvent.click(screen.getByRole('button', { name: 'Печать / Сохранить PDF' }))
  const full = screen.getByTitle('Полный отчёт для печати') as HTMLIFrameElement
  expect(full.srcdoc.match(/<tr/g)).toHaveLength(206)
  expect(full.srcdoc).toContain('>S205<')
  expect(screen.getByRole('button', { name: 'Подготавливаем печать…' })).toBeDisabled()
  // A changed snapshot cancels the old deferred print and starts on page one.
  rerender(<PrintableReportPreview {...props} report={{ ...report }} />)
  expect(full.isConnected).toBe(false)
  expect(iframe().srcdoc).toContain('>S1<')
  fireEvent.load(iframe())
  fireEvent.click(screen.getByRole('button', { name: 'Печать / Сохранить PDF' }))
  const pending = screen.getByTitle('Полный отчёт для печати')
  unmount()
  expect(pending.isConnected).toBe(false)
})
