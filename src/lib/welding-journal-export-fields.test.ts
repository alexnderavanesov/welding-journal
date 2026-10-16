import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { getWeldingJournalExportFields } from './welding-journal-export-fields'
import type { WeldInput } from './weld-fields'
import { buildWeldingJournalCurrentReport } from './report-show-builders'
import { buildExportXlsxBytes } from './weld-export-xlsx-xml'

it('outputs the visible journal fields in screen order, including pinning, without groups or action columns', () => {
  const fields = getWeldingJournalExportFields([
    'ag-Grid-SelectionColumn', 'joint', 'line', 'ag-Grid-AutoColumn', 'materialGroup',
    'subtitleCode', 'projectTitle', '__actions', 'jointNextAction', 'finalStatus',
  ])
  expect(fields.map(field => field.key)).toEqual(['joint', 'line', 'materialGroup', 'subtitleCode', 'projectTitle', 'finalStatus'])

  const rows = [{ joint: 'F002', line: 'LINE', materialGroup: 'М01', subtitleCode: 'SUB', projectTitle: 'PROJECT', finalStatus: 'ожидает сварку' }] as WeldInput[]
  const preview = buildWeldingJournalCurrentReport(rows, fields).report.tables![0]
  const workbook = XLSX.read(buildExportXlsxBytes(rows, { fields }), { type: 'array' })
  const output = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' })
  expect(output).toEqual([preview.columns, ...preview.rows])
  expect(preview.rows).toHaveLength(1)
})

it('does not add fields to an empty view containing only service columns', () => {
  expect(getWeldingJournalExportFields(['__actions', 'jointNextAction', 'ag-Grid-SelectionColumn'])).toEqual([])
})
