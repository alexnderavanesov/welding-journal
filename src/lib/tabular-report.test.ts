import { expect, it } from 'vitest'
import { buildTabularReport } from './tabular-report'
import { FIELD_BY_KEY, type WeldInput } from './weld-fields'
import { recordsToVisibleExportMatrix } from './weld-export-utils'
it('provides the complete data and fields without starting a browser download', () => {
  const fields = [FIELD_BY_KEY.get('joint')!]
  const rows = [{ joint: '<F1>' }] as WeldInput[]
  const content = buildTabularReport({ rows, fields, sheetName: 'Журнал', title: 'Журнал', filename: 'journal.xlsx', emptyMessage: 'Пусто' })
  expect(content.report.tables?.[0].rows).toEqual([['<F1>']])
  expect(content.exportData).toEqual({ rows, fields, sheetName: 'Журнал', filename: 'journal.xlsx' })
  expect(content.exportData.rows).toBe(rows)
  expect(content.report.tables?.[0].printIdentity).toEqual({ columns: ['Линия', 'Стык'], indexes: [-1, 0], rows: [['', '<F1>']] })
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


it('formats the preview only when requested, once, while raw export access stays cheap', () => {
  let reads = 0
  const rows = [{ get joint() { reads++; return 'F1' } }]
  const content = buildTabularReport({ rows, fields: [FIELD_BY_KEY.get('joint')!], sheetName: 'Журнал', title: 'Журнал', filename: 'journal.xlsx', emptyMessage: '' })
  expect(content.exportData.rows).toBe(rows)
  expect(reads).toBe(0)
  const report = content.report
  expect(report.tables[0].rows).toEqual([['F1']])
  const formatted = reads
  expect(formatted).toBeGreaterThan(0)
  expect(content.report).toBe(report)
  expect(reads).toBe(formatted)
})
