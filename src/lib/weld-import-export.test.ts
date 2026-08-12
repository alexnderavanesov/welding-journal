import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { FIELD_BY_KEY, FULL_EXCEL_HEADERS } from './weld-fields'
import { hasReservedJointSystemPart, parseJointName, validateManualJointName } from './joint-name'
import {
  appendImportedWelds,
  recordsToExportMatrix,
  normalizeWeldInput,
} from './weld-record-transforms'
import { buildExportWorkbook } from './weld-export-builders'
import { buildExportXlsxBytes } from './weld-export-xlsx-xml'
import { recordsToVisibleExportMatrix } from './weld-export-utils'
import { emptyToNull, excelSerialDateToIso, parseBoolean, parseDate, parseImportCell } from './weld-import-parsers'
import { parseWorkbook } from './weld-import-readers'
import { parseWorksheetRows } from './weld-import-rows'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'

const label = (key: string) => {
  const field = FIELD_BY_KEY.get(key as never)
  if (!field) throw new Error(`Missing test field: ${key}`)
  return field.label
}

describe('weld import/export', () => {
  it('validates manual joint names without system suffixes', () => {
    expect(validateManualJointName('S13')).toBeNull()
    expect(validateManualJointName('F5A')).toBeNull()
    expect(validateManualJointName('S44B')).toBeNull()
    expect(validateManualJointName('S44R')).toContain('системной части')
    expect(validateManualJointName('F1AY1')).toContain('зарезервированы')
    expect(validateManualJointName('S44BW2R1')).toContain('зарезервированы')
    expect(validateManualJointName('13')).toContain('начинаться')
    expect(hasReservedJointSystemPart('S13R1')).toBe(true)
    expect(hasReservedJointSystemPart('S13A')).toBe(false)
  })

  it('allows one Latin designer index only when the project setting is enabled', () => {
    const settingsWithLeadingLetterIndex = {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS,
      allowLeadingLetterIndex: true,
    }

    expect(validateManualJointName('FB01')).toContain('отключен')
    expect(validateManualJointName('SB43', settingsWithLeadingLetterIndex)).toBeNull()
    expect(validateManualJointName('FБ01', settingsWithLeadingLetterIndex)).toContain('начинаться')
    expect(validateManualJointName('FBC01', settingsWithLeadingLetterIndex)).toContain('начинаться')

    const emptyNameError = validateManualJointName('', settingsWithLeadingLetterIndex)
    expect(emptyNameError).toContain('допускается одна латинская буква')
    expect(emptyNameError).toContain('S13')
    expect(emptyNameError).toContain('FB05')
    expect(emptyNameError).not.toContain('и порядкового номера')
  })

  it('parses system joint chains with R W Y suffixes and manual infixes', () => {
    expect(parseJointName('F1AY1')).toMatchObject({
      base: 'F1A',
      segments: [{ suffix: 'Y', index: 1 }],
    })
    expect(parseJointName('S44BW2R1')).toMatchObject({
      base: 'S44B',
      segments: [
        { suffix: 'W', index: 2 },
        { suffix: 'R', index: 1 },
      ],
    })
    expect(parseJointName('S13R2W1')).toMatchObject({
      base: 'S13',
      segments: [
        { suffix: 'R', index: 2 },
        { suffix: 'W', index: 1 },
      ],
    })
  })

  it('recognizes the full header set', () => {
    const result = parseWorksheetRows([FULL_EXCEL_HEADERS])
    expect(result.records).toHaveLength(0)
    expect(result.missingHeaders).toHaveLength(0)
  })

  it('rejects older files without per-control request columns', () => {
    const oldHeaders = FULL_EXCEL_HEADERS.filter((header) => !header.startsWith('Заявка '))

    expect(() => parseWorksheetRows([oldHeaders])).toThrow('Не найдены обязательные колонки')
  })

  it('converts placeholder dashes to null', () => {
    expect(emptyToNull('-')).toBeNull()
    expect(emptyToNull('   ')).toBeNull()
  })

  it('converts Excel serial dates to ISO dates', () => {
    expect(excelSerialDateToIso(45736)).toBe('2025-03-20')
  })

  it('reads exported Russian date values back as ISO dates', () => {
    expect(parseDate('20.03.2025')).toBe('2025-03-20')
    expect(parseDate('20.03.25')).toBe('2025-03-20')
  })

  it('allows an empty welding date', () => {
    const normalized = normalizeWeldInput({ joint: 'S13', weldDate: '' })

    expect(normalized.weldDate).toBeNull()
    expect(normalized.hasVik).toBeUndefined()
  })

  it('automatically enables VIK when the welding date is filled', () => {
    const normalized = normalizeWeldInput({ joint: 'S13', weldDate: '2025-03-20' })

    expect(normalized.weldDate).toBe('2025-03-20')
    expect(normalized.hasVik).toBe(true)
  })

  it('preserves RK exposure rows when normalizing a weld for storage', () => {
    const normalized = normalizeWeldInput({
      joint: 'S13',
      lnkDefectDescription: ' 1: дно \r\n 2: дно ',
    })

    expect(normalized.lnkDefectDescription).toBe('1: дно\n2: дно')
  })

  it('keeps WDI as a numeric Excel value during export and import', () => {
    const [headers, row] = recordsToVisibleExportMatrix([{ joint: 'S13', wdi: '1,25' }])
    const wdiValue = row[headers.indexOf(label('wdi'))]

    expect(wdiValue).toBe(1.25)
  })

  it('keeps imported joint status official until the dedicated status flow changes it', () => {
    const status = label('status')
    const result = parseWorksheetRows([
      FULL_EXCEL_HEADERS,
      [...FULL_EXCEL_HEADERS.map((header) => (header === label('joint') ? 'S13' : header === status ? 'неофициальный' : null))],
      [...FULL_EXCEL_HEADERS.map((header) => (header === label('joint') ? 'S14' : header === status ? 'официальный' : null))],
    ])

    expect(result.records[0].status).toBeNull()
    expect(result.records[1].status).toBeNull()
  })

  it('converts exported yes/no values to booleans', () => {
    const [headers, row] = recordsToExportMatrix([{ hasVik: true }])
    const yesValue = row[headers.indexOf(label('hasVik'))]

    expect(parseBoolean(yesValue)).toBe(true)
    expect(parseBoolean('-')).toBeNull()
  })

  it('rejects unknown booleans, numbers and dates during import', () => {
    expect(() => parseImportCell(FIELD_BY_KEY.get('hasVik')!, 'возможно')).toThrow('не распознано')
    expect(() => parseImportCell(FIELD_BY_KEY.get('d1')!, 'пятьдесят')).toThrow('не распознано')
    expect(() => parseImportCell(FIELD_BY_KEY.get('weldDate')!, '31.02.2026')).toThrow('не распознано')
  })

  it('keeps cancelled marks as a non-active control flag', () => {
    expect(parseBoolean('отменен')).toBe('отменен')

    const [headers, row] = recordsToExportMatrix([{ hasVik: 'отменен' }])
    expect(row[headers.indexOf(label('hasVik'))]).toBe('отменен')
  })

  it('keeps additional marks as an active special control flag', () => {
    expect(parseBoolean('дополнительный')).toBe('дополнительный')

    const [headers, row] = recordsToExportMatrix([{ hasVik: 'дополнительный' }])
    expect(row[headers.indexOf(label('hasVik'))]).toBe('дополнительный')
  })

  it('keeps RK, UZK and the line percentage in their exact import columns', () => {
    const result = parseWorksheetRows([
      FULL_EXCEL_HEADERS,
      buildFullHeaderRow({
        [label('joint')]: 'F18',
        [label('weldControlPercent')]: 25,
        [label('hasRk')]: 'да',
        [label('hasUzk')]: '',
      }),
      buildFullHeaderRow({
        [label('joint')]: 'F19',
        [label('weldControlPercent')]: 10,
        [label('hasRk')]: '',
        [label('hasUzk')]: 'да',
      }),
    ])

    expect(result.records).toMatchObject([
      { joint: 'F18', weldControlPercent: 25, hasRk: true, hasUzk: null },
      { joint: 'F19', weldControlPercent: 10, hasRk: null, hasUzk: true },
    ])
  })

  it('cleans old RK/UZK replacement marks to additional control', () => {
    expect(parseBoolean('замена РК/УЗК')).toBe('дополнительный')

    const [headers, row] = recordsToExportMatrix([{ hasPvk: 'замена РК/УЗК' }])
    expect(row[headers.indexOf(label('hasPvk'))]).toBe('дополнительный')
  })

  it('allows only the conducted value for the PSTO result field without affecting final control status', () => {
    const result = parseWorksheetRows([
      FULL_EXCEL_HEADERS,
      FULL_EXCEL_HEADERS.map((header) =>
        header === label('joint')
          ? 'S13'
          : header === label('pstoRequired')
            ? 'да'
            : header === label('pstoResult') || header === label('vikResult')
              ? 'проведено'
              : null,
      ),
    ])

    expect(result.records[0].pstoResult).toBe('проведено')
    expect(result.records[0].vikResult).toBeNull()
    expect(result.records[0].finalStatus).toBe('ожидает сварку')
  })

  it('skips service rows without a real joint, line, or isometry', () => {
    const rows = [
      FULL_EXCEL_HEADERS,
      FULL_EXCEL_HEADERS.map(() => '-'),
      buildFullHeaderRow({
        [label('weldDate')]: 45736,
        [label('line')]: '330-FL-02-004',
        [label('joint')]: 'S13',
        [label('hasVik')]: recordsToExportMatrix([{ hasVik: true }])[1][FULL_EXCEL_HEADERS.indexOf(label('hasVik'))],
      }),
    ]

    const result = parseWorksheetRows(rows)
    expect(result.records).toHaveLength(1)
    expect(result.skippedRows).toBe(1)
    expect(result.records[0].weldDate).toBe('2025-03-20')
    expect(result.records[0].hasVik).toBe(true)
  })

  it('exports rows in the full canonical Excel order', () => {
    const [headers, row] = recordsToExportMatrix([{ joint: 'S13', hasVik: true }])
    expect(headers).toEqual(FULL_EXCEL_HEADERS)
    expect(row[FULL_EXCEL_HEADERS.indexOf(label('joint'))]).toBe('S13')
    expect(parseBoolean(row[FULL_EXCEL_HEADERS.indexOf(label('hasVik'))])).toBe(true)
  })

  it('does not import or export removed material id columns', () => {
    const materialId1 = label('materialId1')
    const materialId2 = label('materialId2')
    const [headers] = recordsToExportMatrix([{ joint: 'S13', materialId1: 'old-1', materialId2: 'old-2' }])

    expect(headers).not.toContain(materialId1)
    expect(headers).not.toContain(materialId2)

    const result = parseWorksheetRows([
      [...FULL_EXCEL_HEADERS, materialId1, materialId2],
      [...FULL_EXCEL_HEADERS.map((header) => (header === label('joint') ? 'S13' : null)), 'old-1', 'old-2'],
    ])

    expect(result.records).toHaveLength(1)
    expect(result.records[0].materialId1).toBeUndefined()
    expect(result.records[0].materialId2).toBeUndefined()
  })

  it('exports visible rows without columns hidden from the register', () => {
    const [headers] = recordsToVisibleExportMatrix([{ joint: 'S13' }])

    expect(headers).not.toContain(label('materialId1'))
    expect(headers).not.toContain(label('materialId2'))
    expect(FULL_EXCEL_HEADERS).not.toContain(label('createdAt'))
    expect(headers).toContain(label('createdAt'))
    expect(headers).toContain(label('joint'))
  })

  it('imports the visible export shape produced by the app', () => {
    const matrix = recordsToVisibleExportMatrix([{ joint: 'S13', line: '330-FL-02-004', hasVik: true }])
    const result = parseWorksheetRows(matrix)

    expect(result.records).toHaveLength(1)
    expect(result.records[0].joint).toBe('S13')
    expect(result.records[0].line).toBe('330-FL-02-004')
    expect(result.records[0].hasVik).toBe(true)
  })

  it('round-trips an exported workbook through the import parser', async () => {
    const workbook = buildExportWorkbook([
      {
        joint: 'S13',
        line: '330-FL-02-004',
        isometry: 'ISO-1',
        weldDate: '2025-03-20',
        hasVik: true,
        vikResult: 'годен',
        wdi: 1.25,
      },
    ])
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const result = await parseWorkbook(buffer)

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      joint: 'S13',
      line: '330-FL-02-004',
      isometry: 'ISO-1',
      weldDate: '2025-03-20',
      hasVik: true,
      vikResult: 'годен',
      finalStatus: 'годен',
      wdi: 1.25,
    })
  })

  it('keeps control percent, RK, and UZK in their exact columns during workbook round-trip', async () => {
    const workbook = buildExportWorkbook([
      {
        joint: 'F18',
        weldControlPercent: 25,
        hasRk: true,
        hasUzk: null,
      },
      {
        joint: 'F19',
        weldControlPercent: 10,
        hasRk: null,
        hasUzk: true,
      },
    ])
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const result = await parseWorkbook(buffer)

    expect(result.records).toHaveLength(2)
    expect(result.records[0]).toMatchObject({
      joint: 'F18',
      weldControlPercent: 25,
      hasRk: true,
      hasUzk: null,
    })
    expect(result.records[1]).toMatchObject({
      joint: 'F19',
      weldControlPercent: 10,
      hasRk: null,
      hasUzk: true,
    })
  })

  it('exports selected fields with report sheet name, formatted dates, and read-only styling', () => {
    const workbook = buildExportWorkbook([{ joint: 'S13', weldDate: '2025-03-20', finalStatus: 'годен' }], {
      fields: [FIELD_BY_KEY.get('joint')!, FIELD_BY_KEY.get('weldDate')!, FIELD_BY_KEY.get('finalStatus')!],
      readOnlyFieldKeys: new Set(['finalStatus']),
      sheetName: 'Термообработка',
    })
    const worksheet = workbook.Sheets['Термообработка']

    expect(workbook.SheetNames).toEqual(['Термообработка'])
    expect(worksheet.A1.v).toBe(label('joint'))
    expect(worksheet.B2.v).toBe('20.03.2025')
    expect(worksheet.C2.s.fill.fgColor.rgb).toBe('D1D5DB')
  })

  it('exports styled xlsx bytes that can be imported again', () => {
    const bytes = buildExportXlsxBytes([{ joint: 'S13', weldDate: '2025-03-20', wdi: 1.25, finalStatus: 'годен' }], {
      fields: [FIELD_BY_KEY.get('joint')!, FIELD_BY_KEY.get('weldDate')!, FIELD_BY_KEY.get('wdi')!, FIELD_BY_KEY.get('finalStatus')!],
      readOnlyFieldKeys: new Set(['finalStatus']),
      sheetName: 'Сварочный журнал',
    })
    const workbook = XLSX.read(bytes, { type: 'array' })
    const worksheet = workbook.Sheets['Сварочный журнал']
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: null })
    const payload = new TextDecoder().decode(bytes)

    expect(payload).toContain('fgColor rgb="FFD1D5DB"')
    expect(rows[1][1]).toBe('20.03.2025')
    expect(rows[1][2]).toBe(1.25)
    expect(parseDate(rows[1][1])).toBe('2025-03-20')
  })

  it('exports result badges as plain Excel values and imports them back', () => {
    const fields = [
      FIELD_BY_KEY.get('joint')!,
      FIELD_BY_KEY.get('vikResult')!,
      FIELD_BY_KEY.get('rkResult')!,
      FIELD_BY_KEY.get('pstoResult')!,
      FIELD_BY_KEY.get('finalStatus')!,
    ]
    const bytes = buildExportXlsxBytes(
      [{ joint: 'S13', vikResult: 'ожидает НК', rkResult: 'ремонт', pstoResult: 'проведено', finalStatus: 'не годен' }],
      { fields, sheetName: 'ЛНК' },
    )
    const workbook = XLSX.read(bytes, { type: 'array' })
    const worksheet = workbook.Sheets['ЛНК']
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: null })
    const payload = new TextDecoder().decode(bytes)
    expect(payload).not.toContain('<drawing')
    expect(payload).not.toContain('/media/')
    expect(rows[1]).toEqual(['S13', 'ожидает НК', 'ремонт', 'проведено', 'не годен'])
  })

  it('appends imported rows without changing existing register rows', () => {
    const existing = [{ id: 7, joint: 'S13', line: 'old-line', responsible: 'old-responsible' }]
    const rows = appendImportedWelds(existing, [{ joint: 'S13', line: 'new-line', responsible: 'new-responsible' }])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 8, joint: 'S13', line: 'new-line', responsible: 'new-responsible' })
    expect(rows[1]).toBe(existing[0])
    expect(rows[1]).toMatchObject({ id: 7, joint: 'S13', line: 'old-line', responsible: 'old-responsible' })
  })

  it('appends records imported from an exported workbook instead of replacing the register', async () => {
    const existing = [
      { id: 3, joint: 'OLD-1', line: 'old-line-1' },
      { id: 4, joint: 'OLD-2', line: 'old-line-2' },
    ]
    const workbook = buildExportWorkbook([{ joint: 'NEW-1', line: 'new-line-1' }])
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const imported = await parseWorkbook(buffer)
    const rows = appendImportedWelds(existing, imported.records)

    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ id: 5, joint: 'NEW-1', line: 'new-line-1' })
    expect(rows.slice(1)).toEqual(existing)
  })
})

function buildFullHeaderRow(values: Record<string, unknown>) {
  return FULL_EXCEL_HEADERS.map((header) => values[header] ?? null)
}
