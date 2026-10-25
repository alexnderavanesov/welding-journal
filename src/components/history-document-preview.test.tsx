import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HistoryDocumentPreview } from './history-document-preview'
const { read, download } = vi.hoisted(() => ({ read: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/generated-document-storage', () => ({ downloadBlob: download }))
vi.mock('@/lib/history-document-preview', () => ({ readHistoryDocumentWorkbook: read, DOCUMENT_PREVIEW_PAGE_ROWS: 100, DOCUMENT_PREVIEW_PAGE_COLUMNS: 111 }))
const blob = { arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) } as unknown as Blob
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  read.mockReset().mockResolvedValue({ sheets: [{ name: 'Лист', rowCount: 1, columnCount: 2 }], page: () => '<p>Лист</p>' })
  download.mockReset()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('StrictMode builds once, downloads the same Excel and restores focus on Escape', async () => {
  const createBlob = vi.fn(async () => blob), onClose = vi.fn()
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  const { unmount } = render(<StrictMode><HistoryDocumentPreview request={{ title: 'Документ', fileName: 'document.xlsx', createBlob }} onClose={onClose} /></StrictMode>)
  await screen.findByTitle('Лист документа: Документ')
  expect(screen.queryByRole('button', { name: /PDF|Вид для печати/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(download).toHaveBeenCalledWith(blob, 'document.xlsx')
  expect(createBlob).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce()
  // Do not let the browser print a partial, paged sheet.
  expect(fireEvent.keyDown(document, { key: 'p', ctrlKey: true })).toBe(false)
  expect(screen.getByRole('button', { name: 'Скачать Excel' })).toHaveFocus()
  expect(download).toHaveBeenCalledOnce()
  fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce()
  unmount(); expect(trigger).toHaveFocus(); trigger.remove()
})
it('retries a failed document load and offers the complete Excel', async () => {
  const createBlob = vi.fn().mockRejectedValueOnce(new Error('Не удалось загрузить документ')).mockResolvedValueOnce(blob)
  render(<HistoryDocumentPreview request={{ title: 'Документ', fileName: 'd.xlsx', createBlob }} onClose={() => {}} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить документ')
  expect(screen.getByRole('button', { name: 'Скачать Excel' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByTitle('Лист документа: Документ')
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(download).toHaveBeenCalledWith(blob, 'd.xlsx')
  expect(createBlob).toHaveBeenCalledTimes(2); expect(read).toHaveBeenCalledOnce()
})
it('ignores an old load after replacing or closing the request', async () => {
  let finish!: (value: Blob) => void
  const old = { title: 'Старый', fileName: 'old.xlsx', createBlob: () => new Promise<Blob>(resolve => { finish = resolve }) }
  const nextBlob = { arrayBuffer: async () => new ArrayBuffer(2) } as Blob
  const fresh = { title: 'Новый', fileName: 'new.xlsx', createBlob: vi.fn(async () => nextBlob) }
  const view = render(<HistoryDocumentPreview request={old} onClose={() => {}} />)
  view.rerender(<HistoryDocumentPreview request={fresh} onClose={() => {}} />)
  await screen.findByTitle('Лист документа: Новый')
  await act(async () => finish(blob))
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(download).toHaveBeenCalledWith(nextBlob, 'new.xlsx')
  view.unmount()
  const again = render(<HistoryDocumentPreview request={old} onClose={() => {}} />)
  again.unmount(); await act(async () => finish(blob))
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('pages large documents locally and downloads the full original', async () => {
  const page = vi.fn(() => '<p>Большой документ</p>'), createBlob = vi.fn(async () => blob)
  read.mockResolvedValue({ sheets: [{ name: 'Все строки', rowCount: 10000, columnCount: 2 }], page })
  render(<HistoryDocumentPreview request={{ title: 'Большой', fileName: 'large.xlsx', createBlob }} onClose={() => {}} />)
  await screen.findByTitle('Лист документа: Большой')
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
  await waitFor(() => expect(page).toHaveBeenLastCalledWith(0, 1, 0, 'Большой'))
  fireEvent.click(screen.getByRole('button', { name: 'Скачать Excel' }))
  expect(download).toHaveBeenCalledWith(blob, 'large.xlsx')
  expect(createBlob).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce()
})
