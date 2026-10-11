import { afterEach, expect, it, vi } from 'vitest'
import { prepareFullReportPrint } from './print-full-report'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
it('rejects oversized reports before generating HTML or creating any iframe', () => {
  const done = vi.fn(), error = vi.fn(), create = vi.spyOn(document, 'createElement')
  const dispose = prepareFullReportPrint({ title: 'Large', tables: [{ title: '', columns: ['A'], rows: Array.from({ length: 1001 }, () => ['A']) }] }, done, error)
  expect(error).toHaveBeenCalledWith(expect.stringContaining('1001 строк'))
  expect(create).not.toHaveBeenCalled()
  expect(done).not.toHaveBeenCalled()
  dispose()
})
it('prints every row and releases the document after print/cancel', () => {
  const done = vi.fn(), error = vi.fn()
  prepareFullReportPrint({ title: 'Full', tables: [{ title: '', columns: ['Joint'], rows: [['S1'], ['S2']] }] }, done, error)
  const frame = document.querySelector('iframe')!
  expect(frame.srcdoc).toContain('>S2<')
  const target = frame.contentWindow!
  vi.spyOn(target, 'focus').mockImplementation(() => {})
  const print = vi.spyOn(target, 'print').mockImplementation(() => target.dispatchEvent(new Event('afterprint')))
  frame.dispatchEvent(new Event('load'))
  expect(print).toHaveBeenCalledTimes(1)
  expect(done).toHaveBeenCalledTimes(1)
  expect(error).not.toHaveBeenCalled()
  expect(frame.isConnected).toBe(false)
  expect(frame.hasAttribute('srcdoc')).toBe(false)
})
it('disposes failed and cancelled preparations; late load cannot print', () => {
  const done = vi.fn(), error = vi.fn()
  const dispose = prepareFullReportPrint({ title: 'Full' }, done, error)
  const frame = document.querySelector('iframe')!, target = frame.contentWindow!
  const print = vi.spyOn(target, 'print').mockImplementation(() => {})
  dispose()
  dispose()
  expect(frame.hasAttribute('srcdoc')).toBe(false)
  frame.dispatchEvent(new Event('load'))
  expect(print).not.toHaveBeenCalled()
  expect(done).not.toHaveBeenCalled()
  prepareFullReportPrint({ title: 'Full' }, done, error)
  const next = document.querySelector('iframe')!
  vi.spyOn(next.contentWindow!, 'focus').mockImplementation(() => {})
  vi.spyOn(next.contentWindow!, 'print').mockImplementation(() => { throw new Error('denied') })
  next.dispatchEvent(new Event('load'))
  expect(error).toHaveBeenCalledTimes(1)
  expect(next.isConnected).toBe(false)
})
