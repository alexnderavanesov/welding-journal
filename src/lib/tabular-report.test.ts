import { afterEach, expect, it, vi } from 'vitest'
import { buildTabularReport } from './tabular-report'
import { FIELD_BY_KEY, type WeldInput } from './weld-fields'
import { recordsToVisibleExportMatrix } from './weld-export-utils'
const mocks = vi.hoisted(() => ({ xlsx: vi.fn(() => new Uint8Array([1, 2, 3])) }))
vi.mock('@/lib/weld-export-xlsx-xml', () => ({ buildExportXlsxBytes: mocks.xlsx }))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('generates Excel only on demand from the exact preview rows and fields', async () => {
  vi.useFakeTimers()
  const fields = [FIELD_BY_KEY.get('joint')!]
  const rows = [{ joint: '<F1>' }] as WeldInput[]
  const create = vi.fn(() => 'blob:test'), revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const content = buildTabularReport({ rows, fields, sheetName: 'Журнал', title: 'Журнал', filename: 'journal.xlsx', emptyMessage: 'Пусто' })
  expect(mocks.xlsx).not.toHaveBeenCalled()
  expect(content.report.tables?.[0].rows).toEqual([['<F1>']])
  await content.onDownloadExcel!()
  expect(mocks.xlsx).toHaveBeenCalledExactlyOnceWith(rows, { fields, sheetName: 'Журнал' })
  expect(click).toHaveBeenCalledOnce()
  expect(document.querySelector('a[download]')).toBeNull()
  vi.runAllTimers()
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:test')
})

it('uses the agreed Russian values, calendar dates, Moscow timestamps and DNO in every output', () => {
  const fields = (['hasVik', 'vikResult', 'vikDefectDescription', 'vikConclusionDate', 'lnkUpdatedAt', 'wdi'] as const).map(key => FIELD_BY_KEY.get(key)!)
  const rows = [{ hasVik: true, vikResult: 'годен', vikDefectDescription: null, vikConclusionDate: '2026-10-02',
    lnkUpdatedAt: '2026-10-03T05:46:08.000Z', wdi: 1.25 }] as unknown as WeldInput[]
  const content = buildTabularReport({ rows, fields, sheetName: 'Журнал', title: 'Журнал', filename: 'journal.xlsx', emptyMessage: '' })
  const expected = [['да', 'годен', 'ДНО', '02.10.2026', '03.10.26 08:46:08', 1.25]]
  expect(content.report.tables![0].rows).toEqual(expected)
  expect(recordsToVisibleExportMatrix(rows, fields).slice(1)).toEqual(expected)
  expect(rows[0].vikDefectDescription).toBeNull()
})

it('preserves rejected and cancelled historical descriptions, invalid legacy dates and empty values', () => {
  const fields = (['hasRk', 'rkResult', 'lnkDefectDescription', 'rkConclusionDate'] as const).map(key => FIELD_BY_KEY.get(key)!)
  const rows = [
    { hasRk: 'да', rkResult: 'ремонт', lnkDefectDescription: 'Трещина <1>\nВторая строка', rkConclusionDate: 'ошибочная дата' },
    { hasRk: 'отменен', rkResult: 'годен', lnkDefectDescription: 'Сохранённое описание', rkConclusionDate: '2026-10-02' },
    {},
  ] as WeldInput[]
  const content = buildTabularReport({ rows, fields, sheetName: 'НК', title: 'НК', filename: 'nk.xlsx', emptyMessage: '' })
  expect(content.report.tables![0].rows).toEqual([
    ['да', 'ремонт', 'Трещина <1>\nВторая строка', 'ошибочная дата'],
    ['отменен', 'годен', 'Сохранённое описание', '02.10.2026'],
    ['', '', '', ''],
  ])
})
