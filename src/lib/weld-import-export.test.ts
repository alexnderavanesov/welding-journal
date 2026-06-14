import { describe, expect, it } from 'vitest'
import { FIELD_BY_KEY, FULL_EXCEL_HEADERS, LEGACY_EXCEL_HEADERS } from './weld-fields'
import {
  appendImportedWelds,
  emptyToNull,
  excelSerialDateToIso,
  parseBoolean,
  parseWorksheetRows,
  recordsToExportMatrix,
  recordsToVisibleExportMatrix,
} from './weld-import-export'

const label = (key: string) => {
  const field = FIELD_BY_KEY.get(key as never)
  if (!field) throw new Error(`Missing test field: ${key}`)
  return field.label
}

describe('weld import/export', () => {
  it('recognizes the full header set', () => {
    const result = parseWorksheetRows([FULL_EXCEL_HEADERS])
    expect(result.records).toHaveLength(0)
    expect(result.missingHeaders).toHaveLength(0)
  })

  it('recognizes the legacy header set without spool id', () => {
    const result = parseWorksheetRows([LEGACY_EXCEL_HEADERS])
    expect(result.records).toHaveLength(0)
    expect(result.missingHeaders).toEqual([label('spoolId')])
  })

  it('converts placeholder dashes to null', () => {
    expect(emptyToNull('-')).toBeNull()
    expect(emptyToNull('   ')).toBeNull()
  })

  it('converts Excel serial dates to ISO dates', () => {
    expect(excelSerialDateToIso(45736)).toBe('2025-03-20')
  })

  it('allows only the unofficial joint status or an empty value', () => {
    const status = label('status')
    const result = parseWorksheetRows([
      FULL_EXCEL_HEADERS,
      [...FULL_EXCEL_HEADERS.map((header) => (header === label('joint') ? 'S13' : header === status ? 'неофициальный' : null))],
      [...FULL_EXCEL_HEADERS.map((header) => (header === label('joint') ? 'S14' : header === status ? 'официальный' : null))],
    ])

    expect(result.records[0].status).toBe('неофициальный')
    expect(result.records[1].status).toBeNull()
  })

  it('converts exported yes/no values to booleans', () => {
    const [headers, row] = recordsToExportMatrix([{ hasVik: true }])
    const yesValue = row[headers.indexOf(label('hasVik'))]

    expect(parseBoolean(yesValue)).toBe(true)
    expect(parseBoolean('-')).toBeNull()
  })

  it('skips service rows without a real joint, line, or isometry', () => {
    const rows = [
      LEGACY_EXCEL_HEADERS,
      LEGACY_EXCEL_HEADERS.map(() => '-'),
      buildLegacyRow({
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

    expect(headers).not.toContain(label('jointZone'))
    expect(headers).not.toContain(label('jointNominal'))
    expect(headers).not.toContain(label('indexCode'))
    expect(headers).not.toContain(label('rwJoint'))
    expect(headers).not.toContain(label('spoolNumber'))
    expect(headers).not.toContain(label('materialId1'))
    expect(headers).not.toContain(label('materialId2'))
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

  it('appends imported rows without changing existing register rows', () => {
    const existing = [{ id: 7, joint: 'S13', line: 'old-line', responsible: 'old-responsible' }]
    const rows = appendImportedWelds(existing, [{ joint: 'S13', line: 'new-line', responsible: 'new-responsible' }])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 8, joint: 'S13', line: 'new-line', responsible: 'new-responsible' })
    expect(rows[1]).toBe(existing[0])
    expect(rows[1]).toMatchObject({ id: 7, joint: 'S13', line: 'old-line', responsible: 'old-responsible' })
  })
})

function buildLegacyRow(values: Record<string, unknown>) {
  return LEGACY_EXCEL_HEADERS.map((header) => values[header] ?? null)
}
