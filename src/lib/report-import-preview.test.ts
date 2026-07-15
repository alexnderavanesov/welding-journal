import * as XLSX from 'xlsx'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_OTHER_SETTINGS, saveOtherSettings } from './other-settings'
import { MASS_FILL_ROW_ID_HEADER } from './report-import-template'
import {
  buildReportMassFillPreview,
  buildReportReplaceDataPreview,
} from './report-import-preview'
import type { WeldRow } from './dispatcher-types'

describe('existing rows report import preview', () => {
  afterEach(() => {
    saveOtherSettings(DEFAULT_OTHER_SETTINGS)
  })

  it('keeps unofficial status out of mass fill update payloads', async () => {
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Статус', 'Состав 1'], [[7, 'F1', '', '09Г2С']])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', status: 'н/п', material1: null, finalStatus: 'ожидает сварку' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С' }])
  })

  it('keeps system fields out of replace data update payloads', async () => {
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Статус', 'Состав 1'], [[7, 'F1', 'официальный', '12Х18Н10Т']])
    const preview = await buildReportReplaceDataPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', status: 'н/п', material1: '09Г2С', finalStatus: 'ожидает сварку' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '12Х18Н10Т' }])
  })

  it('keeps derived system WDI updates when WDI inputs changed', async () => {
    saveOtherSettings({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    })
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'D1'], [[7, 'F1', 50.8]])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1', status: 'н/п', d1: null, wdi: null, finalStatus: 'ожидает сварку' } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, d1: 50.8, wdi: 2 }])
  })

  it('shows changed existing rows with columns from the uploaded template', async () => {
    const file = buildWorkbookFile(
      [MASS_FILL_ROW_ID_HEADER, 'Линия', 'Стык', 'Состав 1', 'Ответственный'],
      [[7, 'LIN-1', 'F1', '09Г2С', 'Иванов']],
    )
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, line: 'LIN-1', joint: 'F1', material1: null, responsible: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.fields.map((field) => field.label)).toEqual(['Линия', 'Стык', 'Состав 1', 'Ответственный'])
    expect(preview.records).toHaveLength(1)
    expect(preview.records[0]).toMatchObject({ id: 7, material1: '09Г2С', responsible: 'Иванов' })
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С', responsible: 'Иванов' }])
  })

  it('does not validate locked existing joint names with system indexes', async () => {
    const file = buildWorkbookFile([MASS_FILL_ROW_ID_HEADER, 'Стык', 'Состав 1'], [[7, 'F1R1', '09Г2С']])
    const preview = await buildReportMassFillPreview({
      activeReport: 'weldingJournal',
      file,
      rows: [{ id: 7, joint: 'F1R1', material1: null } as WeldRow],
      weldFormStampSelectOptions: {},
      welderStamps: [],
      welderStampSuspensions: [],
    })

    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toEqual([{ id: 7, material1: '09Г2С' }])
  })
})

function buildWorkbookFile(headers: string[], rows: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Импорт')
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return {
    name: 'import.xlsx',
    arrayBuffer: async () => buffer,
    text: async () => '',
  } as File
}
