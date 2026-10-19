import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useReportOutputActions } from '@/lib/use-report-output-actions'
import type { ActiveReport } from '@/lib/home-state'
import { FIELD_BY_KEY, VISIBLE_FIELDS, type WeldInput } from '@/lib/weld-fields'
import { DEFAULT_JOURNAL_APPEARANCE, writeJournalGridStorage } from './welding-journal-grid-state'

function params(activeReport: ActiveReport = 'weldingJournal') {
  return { activeReport, activeTitle: 'Отчёт', reportExportFieldsRef: { current: () => VISIBLE_FIELDS }, loadLnkRows: vi.fn(async () => []),
    loadPstoRows: vi.fn(async () => []), loadWeldingJournalRows: vi.fn<() => Promise<WeldInput[]>>(async () => []),
    setIsLnkShowMenuOpen: vi.fn(), setIsPstoShowMenuOpen: vi.fn(), setIsWeldingJournalShowMenuOpen: vi.fn(), setMessage: vi.fn() }
}
afterEach(() => vi.restoreAllMocks())

it('exports LNK live field order with independent method/stage values without changing source facts', async () => {
  const p = params('lnk')
  const source = { id: 1, joint: 'S1', hasVik: 'да', hasRk: 'да', vikRequest: 'VIK', rkResult: 'годен',
    preHeatTreatmentControls: [{ id: 11, weldJointId: 1, method: 'РК', requestName: 'PRE', result: 'вырез', conclusionDate: '2026-09-02' }] }
  const fields = ['preRkResult', 'joint', 'rkResult', 'vikResult', 'preRkConclusionDate'].map(key => FIELD_BY_KEY.get(key as never)!)
  const readFields = vi.fn(report => report === 'lnk' ? fields : null)
  const { result } = renderHook(() => useReportOutputActions({ ...p, reportExportFieldsRef: { current: readFields }, loadLnkRows: async () => [source as never] }))
  await act(async () => { await result.current.openLnkCurrentReport() })
  expect(readFields).toHaveBeenCalledExactlyOnceWith('lnk')
  expect(result.current.reportPreviewProps?.report?.tables?.[0]).toMatchObject({ columns: fields.map(field => field.label),
    rows: [['вырез', 'S1', 'годен', 'нет потребности', '02.09.2026']] })
  expect(source).not.toHaveProperty('vikResult')
  expect(source.rkResult).toBe('годен')
})

it.each([null, [], 'psto'] as const)('refuses LNK export with unready, empty or another report columns: %s', async mode => {
  const p = params('lnk')
  const { result } = renderHook(() => useReportOutputActions({ ...p, reportExportFieldsRef: { current: report => mode === 'psto' ? report === 'heatTreatment' ? VISIBLE_FIELDS : null : mode === null ? null : [...mode] } }))
  await act(async () => { await result.current.openLnkCurrentReport() })
  expect(p.loadLnkRows).not.toHaveBeenCalled()
  expect(result.current.reportPreviewProps).toBeNull()
  expect(p.setMessage).toHaveBeenCalledWith(expect.any(String))
})

it('exports PSTO visible fields in screen order with current repeat values, without changing the source', async () => {
  const p = params('heatTreatment')
  const source = { id: 1, joint: 'S1', pstoRequired: 'да', pstoRequest: 'OLD', pstoResult: 'проведено', tvmtResult: 'не годен',
    pstoRepeatCycles: [{ id: 21, weldJointId: 1, sequence: 2, pstoRequest: 'NEW', pstoRequestDate: '2026-10-18', pstoResult: 'проведено', tvmtResult: 'годен' }] }
  const fields = ['tvmtResult', 'joint', 'pstoRequest', 'pstoRequestDate'].map(key => FIELD_BY_KEY.get(key as never)!)
  const readFields = vi.fn(report => report === 'heatTreatment' ? fields : null)
  const { result } = renderHook(() => useReportOutputActions({ ...p, reportExportFieldsRef: { current: readFields }, loadPstoRows: async () => [source as never] }))
  await act(async () => { await result.current.openPstoCurrentReport() })
  expect(readFields).toHaveBeenCalledExactlyOnceWith('heatTreatment')
  expect(result.current.reportPreviewProps?.report?.tables?.[0]).toMatchObject({ columns: fields.map(field => field.label), rows: [['годен', 'S1', 'NEW', '18.10.2026']] })
  expect(source.tvmtResult).toBe('не годен')
  expect(source.pstoRequest).toBe('OLD')
})

it.each([null, [], 'journal'] as const)('refuses PSTO export with unready, empty or another report columns: %s', async mode => {
  const p = params('heatTreatment')
  const { result } = renderHook(() => useReportOutputActions({ ...p, reportExportFieldsRef: { current: report => mode === 'journal' ? report === 'weldingJournal' ? VISIBLE_FIELDS : null : mode === null ? null : [...mode] } }))
  await act(async () => { await result.current.openPstoCurrentReport() })
  expect(p.loadPstoRows).not.toHaveBeenCalled()
  expect(result.current.reportPreviewProps).toBeNull()
  expect(p.setMessage).toHaveBeenCalledWith(expect.any(String))
})

it('captures live journal columns even when persisting their order fails, before awaiting rows', async () => {
  const stored = { appearance: DEFAULT_JOURNAL_APPEARANCE, views: {}, columns: [{ colId: 'joint' }, { colId: 'line' }] }
  writeJournalGridStorage(stored)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
  // Grid layout remains in memory after best-effort persistence fails.
  writeJournalGridStorage({ ...stored, columns: [{ colId: 'line' }, { colId: 'joint' }] })
  const p = params()
  let visible = [FIELD_BY_KEY.get('line')!, FIELD_BY_KEY.get('joint')!]
  let resolve!: (rows: WeldInput[]) => void
  p.loadWeldingJournalRows.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const { result } = renderHook(() => useReportOutputActions({ ...p, reportExportFieldsRef: { current: () => visible } }))
  let opening!: Promise<void>
  act(() => { opening = result.current.openWeldingJournalCurrentReport() })
  visible = [FIELD_BY_KEY.get('projectTitle')!]
  await act(async () => { resolve([{ line: 'LIVE', joint: 'F001', projectTitle: 'HIDDEN' } as WeldInput]); await opening })
  expect(result.current.reportPreviewProps?.report?.tables?.[0].columns).toEqual(['Линия', 'Стык'])
  expect(result.current.reportPreviewProps?.report?.tables?.[0].rows).toEqual([['LIVE', 'F001']])
})

it.each([null, () => null, () => []])('does not load a current journal report without ready visible fields (%s)', async source => {
  const p = params()
  const { result } = renderHook(() => useReportOutputActions({ ...p, reportExportFieldsRef: { current: source } }))
  await act(async () => { await result.current.openWeldingJournalCurrentReport() })
  expect(p.loadWeldingJournalRows).not.toHaveBeenCalled()
  expect(result.current.reportPreviewProps).toBeNull()
  expect(p.setMessage).toHaveBeenCalledWith(source?.() ? expect.stringContaining('нет столбцов') : expect.stringContaining('Дождитесь'))
})

it.each([
  ['openLnkCurrentReport', 'loadLnkRows', 'current'],
  ['openLnkWaitingNkReport', 'loadLnkRows', 'waitingNk'],
  ['openLnkToRequestReport', 'loadLnkRows', 'waitingRequest'],
  ['openLnkConclusionsReport', 'loadLnkRows', 'conclusions'],
  ['openPstoCurrentReport', 'loadPstoRows', 'current'],
  ['openPstoWaitingRequestReport', 'loadPstoRows', 'waitingRequest'],
  ['openPstoResultsReport', 'loadPstoRows', 'results'],
  ['openWeldingJournalCurrentReport', 'loadWeldingJournalRows', 'current'],
  ['openWeldingJournalSystemReport', 'loadWeldingJournalRows', 'system'],
  ['openWeldingJournalWaitingWeldReport', 'loadWeldingJournalRows', 'waitingWeld'],
  ['openWeldingJournalWaitingRequestReport', 'loadWeldingJournalRows', 'waitingRequest'],
  ['openWeldingJournalWaitingControlReport', 'loadWeldingJournalRows', 'waitingControl'],
  ['openWeldingJournalWaitingRepairReport', 'loadWeldingJournalRows', 'waitingRepair'],
  ['openWeldingJournalCancelledAcceptedReport', 'loadWeldingJournalRows', 'cancelledAccepted'],
] as const)('%s opens an empty preview without popups and loads only the chosen slice', async (action, loader, kind) => {
  const popup = vi.spyOn(window, 'open').mockReturnValue(null)
  const p = params(), { result, rerender } = renderHook(() => useReportOutputActions(p))
  expect(result.current.reportPreviewProps).toBeNull()
  expect(p[loader]).not.toHaveBeenCalled()
  await act(async () => { await result.current[action]() })
  expect(p[loader]).toHaveBeenCalledExactlyOnceWith(kind)
  expect(result.current.reportPreviewProps?.report?.emptyMessage).toBeTruthy()
  expect(result.current.reportPreviewProps?.onDownloadExcel).toBeUndefined()
  expect(result.current.reportPreviewProps?.error).toBe('')
  rerender()
  window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online'))
  expect(p[loader]).toHaveBeenCalledTimes(1)
  expect(popup).not.toHaveBeenCalled()
})

it('keeps all 501 rows and date formatting, without generating Excel on open', async () => {
  const p = params()
  p.loadWeldingJournalRows.mockResolvedValue(Array.from({ length: 501 }, (_, i) => ({ joint: 'F' + (i + 1), weldDate: '2026-09-29' }) as WeldInput))
  const { result } = renderHook(() => useReportOutputActions(p))
  await act(async () => { await result.current.openWeldingJournalCurrentReport() })
  const report = result.current.reportPreviewProps?.report
  expect(report?.tables?.[0].rows).toHaveLength(501)
  expect(report?.tables?.[0].rows[500]).toContain('F501')
  expect(report?.tables?.[0].rows[0]).toContain('29.09.2026')
  expect(result.current.reportPreviewProps?.onDownloadExcel).toBeTypeOf('function')
})

it('opens loading immediately, coalesces duplicate clicks and ignores closed responses', async () => {
  const p = params()
  let resolve!: (rows: WeldInput[]) => void
  p.loadWeldingJournalRows.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const { result } = renderHook(() => useReportOutputActions(p))
  act(() => { void result.current.openWeldingJournalCurrentReport(); void result.current.openWeldingJournalCurrentReport() })
  expect(result.current.reportPreviewProps?.busy).toBe(true)
  expect(p.loadWeldingJournalRows).toHaveBeenCalledTimes(1)
  act(() => result.current.reportPreviewProps?.onClose())
  await act(async () => { await result.current.openWeldingJournalWaitingWeldReport() })
  const title = result.current.reportPreviewProps?.report?.title
  await act(async () => resolve([{ joint: 'OLD' } as WeldInput]))
  expect(result.current.reportPreviewProps?.report?.title).toBe(title)
  expect(p.loadWeldingJournalRows).toHaveBeenCalledTimes(2)
})

it('retries only explicitly, keeps the chosen slice and resets when leaving the report', async () => {
  const p = params()
  p.loadWeldingJournalRows.mockRejectedValueOnce(new Error('Нет соединения'))
  const { result, rerender } = renderHook(({ context }) => useReportOutputActions({ ...p, activeReport: context }), { initialProps: { context: 'weldingJournal' as ActiveReport } })
  await act(async () => { await result.current.openWeldingJournalWaitingRepairReport() })
  expect(result.current.reportPreviewProps?.error).toBe('Нет соединения')
  await act(async () => result.current.reportPreviewProps?.onRetry())
  expect(p.loadWeldingJournalRows).toHaveBeenNthCalledWith(2, 'waitingRepair')
  expect(result.current.reportPreviewProps?.error).toBe('')
  rerender({ context: 'lnk' })
  expect(result.current.reportPreviewProps).toBeNull()
})

it.each([
  ['openLnkCurrentReport', 'loadLnkRows'],
  ['openPstoCurrentReport', 'loadPstoRows'],
  ['openWeldingJournalCurrentReport', 'loadWeldingJournalRows'],
] as const)('%s cannot export the old visible rows while the current filter is pending', async (action, loader) => {
  const p = params()
  const { result } = renderHook(() => useReportOutputActions({ ...p, currentRowsReady: false, outputContext: 'new-filter' }))
  await act(async () => { await result.current[action]() })
  expect(p[loader]).not.toHaveBeenCalled()
  expect(result.current.reportPreviewProps).toBeNull()
  expect(p.setMessage).toHaveBeenCalledWith('Дождитесь загрузки строк текущей выборки.')
})

it.each(['resolve', 'reject'] as const)('ignores an old export %s after filter A → B → A without replacing the new snapshot', async (outcome) => {
  const p = params()
  let resolve!: (rows: WeldInput[]) => void, reject!: (reason: Error) => void
  p.loadWeldingJournalRows.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail }))
  p.loadWeldingJournalRows.mockResolvedValueOnce([{ joint: 'NEW-A' } as WeldInput])
  const { result, rerender } = renderHook(({ context }) => useReportOutputActions({ ...p, outputContext: context }), {
    initialProps: { context: 'filter-A' },
  })
  let oldOpening!: Promise<void>
  act(() => { oldOpening = result.current.openWeldingJournalCurrentReport() })
  expect(result.current.reportPreviewProps?.busy).toBe(true)
  rerender({ context: 'filter-B' })
  expect(result.current.reportPreviewProps).toBeNull()
  rerender({ context: 'filter-A' })
  await act(async () => { await result.current.openWeldingJournalCurrentReport() })
  const snapshot = result.current.reportPreviewProps?.report
  const download = result.current.reportPreviewProps?.onDownloadExcel
  expect(snapshot?.tables?.[0].rows[0]).toContain('NEW-A')
  await act(async () => {
    if (outcome === 'resolve') resolve([{ joint: 'OLD-A' } as WeldInput])
    else reject(new Error('Old filter export failed'))
    await oldOpening
  })
  expect(result.current.reportPreviewProps?.report).toBe(snapshot)
  expect(result.current.reportPreviewProps?.onDownloadExcel).toBe(download)
  expect(result.current.reportPreviewProps?.error).toBe('')
  expect(p.loadWeldingJournalRows).toHaveBeenCalledTimes(2)
  rerender({ context: 'filter-C' })
  expect(result.current.reportPreviewProps).toBeNull()
})
