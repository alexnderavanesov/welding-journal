import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'

import { createWeldingJournalBlobFromTemplate, extractTemplateFields, type StoredDocumentTemplate } from '@/lib/document-template-storage'
import type { WeldInput } from '@/lib/weld-fields'

describe('document template storage', () => {
  it('ignores template markers that are not current system field names', () => {
    expect(extractTemplateFields('{{Неизвестное поле}} {{Способ сварки}} {{Стык/"н/п"}}')).toEqual(['Способ сварки', 'Стык'])
  })

  it('keeps ordinary empty template fields empty', async () => {
    const template = createXlsxTemplate([['{{ID материала 1}}', '{{Стык}}']])
    const blob = createWeldingJournalBlobFromTemplate(template, [
      { joint: '', materialId1: '' },
      { joint: 'S2', materialId1: 'MAT-2' },
    ] as WeldInput[])

    const workbook = XLSX.read(await readBlobAsArrayBuffer(blob), { type: 'array' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]

    expect(worksheet.A1?.v).toBe('')
    expect(worksheet.B1?.v).toBe('')
    expect(worksheet.A2?.v).toBe('MAT-2')
    expect(worksheet.B2?.v).toBe('S2')
  })

  it('uses custom marker fallback when a template field is empty', async () => {
    const template = createXlsxTemplate([
      ['{{Стык/«н/п»}}', '{{ID материала 1/"нет материала"}}', '{{Линия/"не используется"}}'],
    ])
    const blob = createWeldingJournalBlobFromTemplate(template, [
      { joint: '', materialId1: '', line: 'LIN-1' },
    ] as WeldInput[])

    const workbook = XLSX.read(await readBlobAsArrayBuffer(blob), { type: 'array' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]

    expect(worksheet.A1?.v).toBe('н/п')
    expect(worksheet.B1?.v).toBe('нет материала')
    expect(worksheet.C1?.v).toBe('LIN-1')
  })

  it('uses welder names for exact official stamp template fields', async () => {
    const template = createXlsxTemplate([
      ['{{Корень_1ФИО сварщика}}', '{{Заполнение_1ФИО сварщика}}', '{{Облицовка_2ФИО сварщика}}', '{{Корень_2 ФИО сварщика}}'],
    ])
    const blob = createWeldingJournalBlobFromTemplate(
      template,
      [
        {
          stamp1K: 'A1',
          stamp1KFact: 'FACT-A1',
          stamp1Z: 'B1',
          stamp1ZFact: 'FACT-B1',
          stamp2O: 'C1',
          stamp2OFact: 'FACT-C1',
          stamp2K: '',
          stamp2KFact: 'FACT-D1',
        },
      ] as WeldInput[],
      {
        welderStamps: [
          welderStamp({ naksStamp: 'A1', welderName: 'Иванов И.И.' }),
          welderStamp({ naksStamp: 'B1', welderName: 'Петров П.П.' }),
          welderStamp({ naksStamp: 'C1', welderName: 'Сидоров С.С.' }),
          welderStamp({ naksStamp: 'FACT-A1', welderName: 'Фактический А' }),
          welderStamp({ naksStamp: 'FACT-B1', welderName: 'Фактический Б' }),
          welderStamp({ naksStamp: 'FACT-C1', welderName: 'Фактический В' }),
          welderStamp({ naksStamp: 'FACT-D1', welderName: 'Фактический Г' }),
        ],
      },
    )

    const workbook = XLSX.read(await readBlobAsArrayBuffer(blob), { type: 'array' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]

    expect(worksheet.A1?.v).toBe('Иванов И.И.')
    expect(worksheet.B1?.v).toBe('Петров П.П.')
    expect(worksheet.C1?.v).toBe('Сидоров С.С.')
    expect(worksheet.D1?.v).toBe('')
  })

  it('prefers exact NAKS stamp owner over another welder internal stamp alias', async () => {
    const template = createXlsxTemplate([['{{Заполнение_1ФИО сварщика}}']])
    const blob = createWeldingJournalBlobFromTemplate(
      template,
      [{ stamp1Z: 'ARCH', stamp1ZFact: 'ABC1' }] as WeldInput[],
      {
        welderStamps: [
          welderStamp({ naksStamp: 'ABC1', internalStamp: 'ARCH', welderName: 'Петров Владислав' }),
          welderStamp({ naksStamp: 'ARCH', internalStamp: '', welderName: 'Иванов Иван' }),
        ],
      },
    )

    const workbook = XLSX.read(await readBlobAsArrayBuffer(blob), { type: 'array' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]

    expect(worksheet.A1?.v).toBe('Иванов Иван')
  })

  it('keeps template sheet name, borders, wrap text and generated rows on automatic height', async () => {
    const template = createXlsxTemplate([['{{Линия}}']], {
      sheetName: 'Журнал шаблон',
      style: {
        border: {
          top: { style: 'thin', color: { rgb: 'FF000000' } },
          bottom: { style: 'thin', color: { rgb: 'FF000000' } },
        },
        alignment: {
          horizontal: 'center',
          vertical: 'top',
          wrapText: true,
        },
      },
      rowInfo: { hpt: 42 },
    })
    const blob = createWeldingJournalBlobFromTemplate(template, [{ line: 'LIN-1\nLIN-2' }] as WeldInput[])

    const generatedData = await readBlobAsArrayBuffer(blob)
    const workbook = XLSX.read(generatedData, { type: 'array', cellStyles: true })
    const sheetXml = readXlsxFileText(generatedData, 'xl/worksheets/sheet1.xml')
    const stylesXml = readXlsxFileText(generatedData, 'xl/styles.xml')

    expect(workbook.SheetNames[0]).toBe('Журнал шаблон')
    expect(sheetXml).toContain('<c r="A1" s="3"')
    expect(sheetXml).not.toMatch(/<row\b[^>]*\bht=/)
    expect(sheetXml).not.toMatch(/<row\b[^>]*\bcustomHeight=/)
    expect(stylesXml).toContain('<top style="thin">')
    expect(stylesXml).toMatch(/wrapText="(?:1|true)"/)
  })

  it('keeps template borders on empty generated cells', async () => {
    const template = createXlsxTemplate([['{{Линия}}', '', '']], {
      style: {
        border: {
          top: { style: 'thin', color: { rgb: 'FF000000' } },
          bottom: { style: 'thin', color: { rgb: 'FF000000' } },
          left: { style: 'thin', color: { rgb: 'FF000000' } },
          right: { style: 'thin', color: { rgb: 'FF000000' } },
        },
      },
      styledCells: ['A1', 'B1', 'C1'],
    })
    const blob = createWeldingJournalBlobFromTemplate(template, [{ line: 'LIN-1' }, { line: 'LIN-2' }] as WeldInput[])

    const generatedData = await readBlobAsArrayBuffer(blob)
    const sheetXml = readXlsxFileText(generatedData, 'xl/worksheets/sheet1.xml')

    expect(sheetXml).toMatch(/<c r="B1" s="\d+"/)
    expect(sheetXml).toMatch(/<c r="C1" s="\d+"/)
    expect(sheetXml).toMatch(/<c r="B2" s="\d+"/)
    expect(sheetXml).toMatch(/<c r="C2" s="\d+"/)
  })
})

function readBlobAsArrayBuffer(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
}

function welderStamp(overrides: Partial<import('@/lib/welder-stamp-types').WelderStampRecord>) {
  return {
    id: 1,
    naksStamp: '',
    welderName: '',
    internalStamp: '',
    weldType: '',
    materialGroups: '',
    diameterFrom: '',
    diameterTo: '',
    thicknessFrom: '',
    thicknessTo: '',
    validFrom: '',
    validTo: '',
    naksPermits: [],
    dlsPermits: [],
    archived: false,
    ...overrides,
  }
}

function readXlsxFileText(fileData: ArrayBuffer, path: string) {
  const cfb = XLSX.CFB.read(new Uint8Array(fileData), { type: 'array' })
  const index = cfb.FullPaths.findIndex((fullPath) => fullPath.replace(/^Root Entry\//, '') === path)
  if (index < 0) return ''
  return new TextDecoder().decode(cfb.FileIndex[index].content)
}

function createXlsxTemplate(
  rows: unknown[][],
  options: {
    sheetName?: string
    style?: Record<string, unknown>
    rowInfo?: Record<string, unknown>
    styledCells?: string[]
  } = {},
): StoredDocumentTemplate {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  if (options.style && worksheet.A1) worksheet.A1.s = options.style
  for (const address of options.styledCells ?? []) {
    worksheet[address] = {
      ...(worksheet[address] ?? { t: 's', v: '' }),
      s: options.style,
    }
  }
  if (options.rowInfo) worksheet['!rows'] = [options.rowInfo]
  XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName ?? 'Шаблон')
  const fileData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  return {
    id: 'weldingJournal',
    fileName: 'template.xlsx',
    fileType: 'xlsx',
    fileSize: fileData.byteLength,
    uploadedAt: '10.07.2026',
    fields: ['ID материала 1'],
    markerCount: 1,
    locations: [],
    warnings: [],
    fileData,
  }
}
