import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PrintableReportPreview } from './printable-report-preview'

beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

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
