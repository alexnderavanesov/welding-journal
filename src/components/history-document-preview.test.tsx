import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HistoryDocumentPreview } from './history-document-preview'

const { read, download } = vi.hoisted(() => ({ read: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/generated-document-storage', () => ({ downloadBlob: download }))
vi.mock('@/lib/history-document-preview', () => ({
  readHistoryDocumentWorkbook: read, DOCUMENT_PREVIEW_PAGE_ROWS: 100, DOCUMENT_PREVIEW_PAGE_COLUMNS: 40,
}))
const blob = { arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) } as unknown as Blob
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  read.mockReset(); download.mockReset()
  read.mockResolvedValue({
    sheets: [{ name: 'Бланк', rowCount: 202, columnCount: 60 }, { name: 'Подписи', rowCount: 1, columnCount: 2 }],
    printRestriction: '', page: (sheet: number, row: number, col: number) => `<p>${sheet}:${row}:${col}</p>`, print: () => '<p>ALL SHEETS</p>',
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('opens once even in StrictMode, pages locally and downloads the exact preview snapshot', async () => {
  const createBlob = vi.fn(async () => blob), onClose = vi.fn()
  render(<StrictMode><HistoryDocumentPreview request={{ title: 'Документ', fileName: 'document.xlsx', createBlob }} onClose={onClose} /></StrictMode>)
  const frame = await screen.findByTitle('Документ') as HTMLIFrameElement
  fireEvent.load(frame)
  expect(screen.getByRole('dialog', { name: 'Предпросмотр документа' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  fireEvent.click(screen.getByRole('button', { name: 'Правее' }))
  expect(frame.srcdoc).toContain('0:1:1')
  fireEvent.change(screen.getByLabelText('Лист документа'), { target: { value: '1' } })
  expect(frame.srcdoc).toContain('1:0:0')
  fireEvent.change(screen.getByLabelText('Масштаб документа'), { target: { value: '50' } })
  fireEvent.load(frame)
  fireEvent.click(screen.getByRole('button', { name: 'Печать / Сохранить PDF' }))
  const printFrame = screen.getByTitle('Полный отчёт для печати') as HTMLIFrameElement
  expect(printFrame.srcdoc).toBe('<p>ALL SHEETS</p>')
  vi.spyOn(printFrame.contentWindow!, 'focus').mockImplementation(() => {})
  vi.spyOn(printFrame.contentWindow!, 'print').mockImplementation(() => {})
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' })))
  expect(download).toHaveBeenCalledWith(blob, 'document.xlsx')
  expect(createBlob).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce()
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  fireEvent(frame.contentDocument!, event)
  expect(event.defaultPrevented).toBe(true); expect(onClose).toHaveBeenCalledOnce()
})

it('shows errors, retries only on request and ignores completion after close', async () => {
  let resolve!: (value: Blob) => void
  const createBlob = vi.fn().mockRejectedValueOnce(new Error('Шаблон не найден')).mockImplementationOnce(() => new Promise<Blob>(done => { resolve = done }))
  const { unmount } = render(<HistoryDocumentPreview request={{ title: 'Retry', fileName: 'retry.xlsx', createBlob }} onClose={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Шаблон не найден')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await waitFor(() => expect(createBlob).toHaveBeenCalledTimes(2))
  unmount()
  await act(async () => resolve(blob))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(download).not.toHaveBeenCalled()
})
