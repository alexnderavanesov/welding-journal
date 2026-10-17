import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PrintableReportPreview } from './printable-report-preview'

beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('fits only the screen page proportionally on resize and preserves manual zoom and full print HTML', () => {
  const callbacks = new Set<() => void>()
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe() { callbacks.add(this.callback) }
    disconnect() { callbacks.delete(this.callback); disconnect() }
  })
  const template = { title: 'Excel page', html: '<div data-document-preview-page>Preview</div>',
    navigation: null, printRestriction: '', buildPrintHtml: vi.fn(() => '<p>Original full print</p>'), scale: 'auto' as const }
  const props = { report: null, busy: false, error: '', onClose: vi.fn(), onRetry: vi.fn() }
  const { rerender, unmount } = render(<PrintableReportPreview {...props} templateDocument={template} />)
  const iframe = screen.getByTitle('Excel page') as HTMLIFrameElement
  // JSDOM does not lay out srcDoc, so supply the real shell's sizing contract.
  const doc = iframe.contentDocument!
  doc.body.style.padding = '16px'
  doc.body.innerHTML = template.html
  const paper = doc.querySelector<HTMLElement>('[data-document-preview-page]')!
  let viewportWidth = 1460, pageWidth = 1250
  Object.defineProperty(doc.documentElement, 'clientWidth', { get: () => viewportWidth })
  Object.defineProperty(paper, 'offsetWidth', { get: () => pageWidth })
  fireEvent.load(iframe)
  expect(Number(paper.style.zoom)).toBeCloseTo((1460 - 32) / 1250)
  expect(paper.style.width).toBe('')
  const resize = () => act(() => callbacks.forEach(callback => callback()))
  viewportWidth = 600; resize()
  expect(Number(paper.style.zoom)).toBeCloseTo((600 - 32) / 1250)
  pageWidth = 240; resize()
  expect(Number(paper.style.zoom)).toBe(1.5)
  viewportWidth = 0; resize()
  expect(Number(paper.style.zoom)).toBe(1.5)

  rerender(<PrintableReportPreview {...props} templateDocument={{ ...template, scale: 75 }} />)
  expect(Number(paper.style.zoom)).toBe(0.75)
  expect(callbacks.size).toBe(0)
  viewportWidth = 900; resize()
  expect(Number(paper.style.zoom)).toBe(0.75)
  expect(iframe.srcdoc).toBe(template.html)
  fireEvent.click(screen.getByRole('button', { name: 'Печать / Сохранить PDF' }))
  expect((screen.getByTitle('Полный отчёт для печати') as HTMLIFrameElement).srcdoc).toBe('<p>Original full print</p>')
  expect(template.buildPrintHtml).toHaveBeenCalledOnce()
  unmount()
  expect(callbacks.size).toBe(0)
  expect(disconnect).toHaveBeenCalled()
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
