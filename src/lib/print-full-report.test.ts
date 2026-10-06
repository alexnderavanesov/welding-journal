import { afterEach, expect, it, vi } from 'vitest'
import { prepareFullReportPrint } from './print-full-report'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
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
})
it('disposes failed and cancelled preparations; late load cannot print', () => {
  const done = vi.fn(), error = vi.fn()
  const dispose = prepareFullReportPrint({ title: 'Full' }, done, error)
  const frame = document.querySelector('iframe')!, target = frame.contentWindow!
  const print = vi.spyOn(target, 'print').mockImplementation(() => {})
  dispose()
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
