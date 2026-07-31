import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'

import {
  createWeldingJournalDocumentPreview,
  createWeldingJournalBlobFromTemplate,
  extractTemplateFields,
  getWeldingJournalTemplateOptions,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import type { WeldInput } from '@/lib/weld-fields'

describe('document template storage', () => {
  it('adds disabled new welding journal rules to previously saved template options', () => {
    expect(getWeldingJournalTemplateOptions({ officialOnly: true, goodOnly: false })).toEqual({
      officialOnly: true,
      goodOnly: false,
      actualOnly: false,
    })
  })

  it('ignores template markers that are not current system field names', () => {
    expect(extractTemplateFields('{{Неизвестное поле}} {{Способ сварки}} {{Стык/"н/п"}}')).toEqual(['Способ сварки', 'Стык'])
  })

  it('keeps ordinary empty template fields empty', async () => {
    const template = createXlsxTemplate([['{{ID материала 1}}', '{{Стык}}']])
    const blob = await createWeldingJournalBlobFromTemplate(template, [
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
    const blob = await createWeldingJournalBlobFromTemplate(template, [
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
    const blob = await createWeldingJournalBlobFromTemplate(
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
    const blob = await createWeldingJournalBlobFromTemplate(
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

  it('keeps template sheet name, borders, wrap text and fits generated row height', async () => {
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
    const blob = await createWeldingJournalBlobFromTemplate(template, [{ line: 'LIN-1\nLIN-2' }] as WeldInput[])

    const generatedData = await readBlobAsArrayBuffer(blob)
    const workbook = XLSX.read(generatedData, { type: 'array', cellStyles: true })
    const sheetXml = readXlsxFileText(generatedData, 'xl/worksheets/sheet1.xml')
    const stylesXml = readXlsxFileText(generatedData, 'xl/styles.xml')

    expect(workbook.SheetNames[0]).toBe('Журнал шаблон')
    expect(sheetXml).toContain('<c r="A1" s="3"')
    expect(sheetXml).toMatch(/<row\b[^>]*\bht="33"/)
    expect(sheetXml).toMatch(/<row\b[^>]*\bcustomHeight="1"/)
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
    const blob = await createWeldingJournalBlobFromTemplate(template, [{ line: 'LIN-1' }, { line: 'LIN-2' }] as WeldInput[])

    const generatedData = await readBlobAsArrayBuffer(blob)
    const sheetXml = readXlsxFileText(generatedData, 'xl/worksheets/sheet1.xml')

    expect(sheetXml).toMatch(/<c r="B1" s="\d+"/)
    expect(sheetXml).toMatch(/<c r="C1" s="\d+"/)
    expect(sheetXml).toMatch(/<c r="B2" s="\d+"/)
    expect(sheetXml).toMatch(/<c r="C2" s="\d+"/)
  })

  it('fills a constructor row and summary cells without manual markers', async () => {
    const template = createXlsxTemplate([
      ['Количество', 'Проекты', 'WDI всего'],
      ['', '', '', ''],
    ])
    template.constructorConfig = {
      version: 1,
      sheetName: 'Шаблон',
      repeatRow: 2,
      bindings: [
        { cell: 'A1', mode: 'count' },
        { cell: 'B1', mode: 'uniqueList', field: 'projectTitle', separator: 'newline' },
        { cell: 'C1', mode: 'sum', field: 'wdi' },
        { cell: 'A2', mode: 'row', field: '__index' },
        { cell: 'B2', mode: 'row', field: 'line' },
        { cell: 'C2', mode: 'row', field: 'joint' },
        { cell: 'D2', mode: 'row', field: 'materialId1', emptyMode: 'np' },
      ],
    }

    const blob = await createWeldingJournalBlobFromTemplate(template, [
      { projectTitle: 'Проект 1', line: 'LIN-1', joint: 'S1', materialId1: '', wdi: 1.25 },
      { projectTitle: 'Проект 1', line: 'LIN-2', joint: 'S2', materialId1: 'MAT-2', wdi: 2.5 },
      { projectTitle: 'Проект 2', line: 'LIN-3', joint: 'S3', materialId1: null, wdi: 0.25 },
    ])

    const workbook = XLSX.read(await readBlobAsArrayBuffer(blob), { type: 'array' })
    const worksheet = workbook.Sheets.Шаблон

    expect(worksheet.A1?.v).toBe(3)
    expect(worksheet.B1?.v).toBe('Проект 1\nПроект 2')
    expect(worksheet.C1?.v).toBe(4)
    expect(worksheet.A2?.v).toBe(1)
    expect(worksheet.B3?.v).toBe('LIN-2')
    expect(worksheet.C4?.v).toBe('S3')
    expect(worksheet.D2?.v).toBe('н/п')
    expect(worksheet.D3?.v).toBe('MAT-2')
    expect(worksheet.D4?.v).toBe('н/п')
  })

  it('combines several fields, text and unique welder values in one row cell', async () => {
    const template = createXlsxTemplate([
      ['Стык', 'Сварщики'],
      ['', ''],
    ])
    template.constructorConfig = {
      version: 1,
      sheetName: 'Шаблон',
      repeatRow: 2,
      bindings: [
        {
          cell: 'A2',
          mode: 'row',
          parts: [
            { field: 'joint', prefix: 'ст. ' },
            { field: 'connectionType', prefix: ', ' },
          ],
        },
        {
          cell: 'B2',
          mode: 'row',
          uniqueParts: true,
          parts: [
            { field: '__welderName:stamp1K', lineBreakAfter: true },
            { field: 'stamp1K', prefix: '(', suffix: ')', lineBreakAfter: true },
            { field: '__welderName:stamp1Z', lineBreakAfter: true },
            { field: 'stamp1Z', prefix: '(', suffix: ')', lineBreakAfter: true },
            { field: '__welderName:stamp2K', lineBreakAfter: true },
            { field: 'stamp2K', prefix: '(', suffix: ')' },
          ],
        },
      ],
    }

    const blob = await createWeldingJournalBlobFromTemplate(
      template,
      [{
        joint: 'S1',
        connectionType: 'C17',
        stamp1K: 'ABC1',
        stamp1Z: 'ABC1',
        stamp2K: 'ABC3',
      }],
      {
        welderStamps: [
          welderStamp({ id: 1, naksStamp: 'ABC1', welderName: 'Петров Владислав' }),
          welderStamp({ id: 2, naksStamp: 'ABC3', welderName: 'Иванов Иван' }),
        ],
      },
    )

    const workbook = XLSX.read(await readBlobAsArrayBuffer(blob), { type: 'array' })
    const worksheet = workbook.Sheets.Шаблон

    expect(worksheet.A2?.v).toBe('ст. S1, C17')
    expect(worksheet.B2?.v).toBe('Петров Владислав\n(ABC1)\nИванов Иван\n(ABC3)')
  })

  it('wraps multiline constructor values, fits row height and copies example-row borders', async () => {
    const template = createXlsxTemplate([
      ['№', 'Стык', 'Сварщики', 'Способ'],
      ['', '', '', ''],
    ], {
      style: {
        border: {
          top: { style: 'thin', color: { rgb: 'FF000000' } },
          bottom: { style: 'thin', color: { rgb: 'FF000000' } },
          left: { style: 'thin', color: { rgb: 'FF000000' } },
          right: { style: 'thin', color: { rgb: 'FF000000' } },
        },
      },
      styledCells: ['A2', 'B2', 'C2', 'D2'],
      columns: [{ wch: 6 }, { wch: 14 }, { wch: 24 }, { wch: 12 }],
    })
    template.constructorConfig = {
      version: 1,
      sheetName: 'Шаблон',
      repeatRow: 2,
      bindings: [
        { cell: 'A2', mode: 'row', field: '__index' },
        { cell: 'B2', mode: 'row', field: 'joint' },
        {
          cell: 'C2',
          mode: 'row',
          parts: [
            { field: 'stamp1K', lineBreakAfter: true },
            { field: 'stamp2K' },
          ],
        },
        { cell: 'D2', mode: 'row', field: 'weldingMethod' },
      ],
    }

    const blob = await createWeldingJournalBlobFromTemplate(template, [
      { joint: 'S1', stamp1K: 'ABC1', stamp2K: 'ABC3', weldingMethod: 'РАД+РД' },
      { joint: 'S2', stamp1K: 'ABC1', stamp2K: 'ABC3', weldingMethod: 'РАД+РД' },
    ])
    const generatedData = await readBlobAsArrayBuffer(blob)
    const workbook = XLSX.read(generatedData, { type: 'array', cellStyles: true })
    const worksheet = workbook.Sheets.Шаблон
    const sheetXml = readXlsxFileText(generatedData, 'xl/worksheets/sheet1.xml')
    const stylesXml = readXlsxFileText(generatedData, 'xl/styles.xml')

    expect(worksheet.C2?.v).toBe('ABC1\nABC3')
    expect(sheetXml).toContain('<c r="C2" s="4"')
    expect(stylesXml).toMatch(/<xf\b[^>]*borderId="2"[^>]*applyAlignment="1"><alignment wrapText="1"\/><\/xf>/)
    expect(sheetXml).toMatch(/<row r="2"[^>]*\bht="33"[^>]*\bcustomHeight="1"/)
    expect(sheetXml).toMatch(/<row r="3"[^>]*\bht="33"[^>]*\bcustomHeight="1"/)
    for (const address of ['A2', 'B2', 'C2', 'D2', 'A3', 'B3', 'C3', 'D3']) {
      expect(sheetXml).toMatch(new RegExp(`<c r="${address}" s="\\d+"`))
    }
  })

  it('keeps merged cells and row formatting when a constructor row is repeated', async () => {
    const template = createXlsxTemplate([
      ['Шапка', ''],
      ['', ''],
    ], {
      style: {
        border: {
          top: { style: 'thin', color: { rgb: 'FF000000' } },
          bottom: { style: 'thin', color: { rgb: 'FF000000' } },
          left: { style: 'thin', color: { rgb: 'FF000000' } },
          right: { style: 'thin', color: { rgb: 'FF000000' } },
        },
        alignment: { wrapText: true },
      },
      styledCells: ['A2', 'B2'],
      merges: ['A2:B2'],
    })
    template.constructorConfig = {
      version: 1,
      sheetName: 'Шаблон',
      repeatRow: 2,
      bindings: [{ cell: 'A2', mode: 'row', field: 'line' }],
    }

    const blob = await createWeldingJournalBlobFromTemplate(template, [{ line: 'LIN-1' }, { line: 'LIN-2' }])
    const generatedData = await readBlobAsArrayBuffer(blob)
    const workbook = XLSX.read(generatedData, { type: 'array', cellStyles: true })
    const worksheet = workbook.Sheets.Шаблон
    const merges = (worksheet['!merges'] ?? []).map((merge) => XLSX.utils.encode_range(merge))

    expect(worksheet.A2?.v).toBe('LIN-1')
    expect(worksheet.A3?.v).toBe('LIN-2')
    expect(merges).toContain('A2:B2')
    expect(merges).toContain('A3:B3')
    expect(readXlsxFileText(generatedData, 'xl/styles.xml')).toMatch(/wrapText="(?:1|true)"/)
  })

  it('builds a lightweight preview from the generated document layout', async () => {
    const template = createXlsxTemplate([
      ['Сварочный журнал', ''],
      ['', ''],
    ], {
      style: {
        fill: { patternType: 'solid', fgColor: { rgb: 'FFDDEBF7' } },
        font: { bold: true, color: { rgb: 'FF17365D' }, sz: 12 },
        border: {
          top: { style: 'thin', color: { rgb: 'FF000000' } },
          bottom: { style: 'thin', color: { rgb: 'FF000000' } },
          left: { style: 'thin', color: { rgb: 'FF000000' } },
          right: { style: 'thin', color: { rgb: 'FF000000' } },
        },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      },
      styledCells: ['A2', 'B2'],
      merges: ['A1:B1', 'A2:B2'],
      columns: [{ wch: 24 }, { wch: 12 }],
    })
    template.constructorConfig = {
      version: 1,
      sheetName: 'Шаблон',
      repeatRow: 2,
      bindings: [{ cell: 'A2', mode: 'row', field: 'line' }],
    }

    const preview = await createWeldingJournalDocumentPreview(
      template,
      [{ line: 'LIN-1' }, { line: 'LIN-2' }],
    )

    const firstGeneratedCell = preview.cells.find((cell) => cell.address === 'A2')
    const secondGeneratedCell = preview.cells.find((cell) => cell.address === 'A3')
    expect(preview.sheetName).toBe('Шаблон')
    expect(firstGeneratedCell).toMatchObject({
      value: 'LIN-1',
      columnSpan: 2,
      style: {
        backgroundColor: '#DDEBF7',
        color: '#17365D',
        fontWeight: 700,
        textAlign: 'center',
        verticalAlign: 'middle',
        whiteSpace: 'pre-line',
      },
    })
    expect(firstGeneratedCell?.style.borderBottom).toBe('1px solid #000000')
    expect(secondGeneratedCell).toMatchObject({ value: 'LIN-2', columnSpan: 2 })
    expect(preview.columnWidths[0]).toBeGreaterThan(preview.columnWidths[1])
  })

  it('keeps template drawing and image parts in a generated constructor workbook', async () => {
    const template = addFakeTemplateDrawing(createXlsxTemplate([
      ['Логотип'],
      [''],
    ]))
    template.constructorConfig = {
      version: 1,
      sheetName: 'Шаблон',
      repeatRow: 2,
      bindings: [{ cell: 'A2', mode: 'row', field: 'joint' }],
    }

    const blob = await createWeldingJournalBlobFromTemplate(template, [{ joint: 'S1' }])
    const generatedData = await readBlobAsArrayBuffer(blob)
    const cfb = XLSX.CFB.read(new Uint8Array(generatedData), { type: 'array' })
    const paths = cfb.FullPaths.map((path: string) => path.replace(/^Root Entry\//, ''))

    expect(paths).toContain('xl/media/image1.png')
    expect(paths).toContain('xl/drawings/drawing1.xml')
    expect(paths).toContain('xl/worksheets/_rels/sheet1.xml.rels')
    expect(readXlsxFileText(generatedData, 'xl/worksheets/sheet1.xml')).toContain('<drawing r:id="rId1"/>')
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
    merges?: string[]
    columns?: Array<Record<string, unknown>>
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
  if (options.columns) worksheet['!cols'] = options.columns
  if (options.merges) worksheet['!merges'] = options.merges.map((range) => XLSX.utils.decode_range(range))
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

function addFakeTemplateDrawing(template: StoredDocumentTemplate) {
  const cfb = XLSX.CFB.read(new Uint8Array(template.fileData), { type: 'array' })
  const sheetPath = 'xl/worksheets/sheet1.xml'
  const sheetXml = readCfbText(cfb, sheetPath).replace(/<\/worksheet>$/, '<drawing r:id="rId1"/></worksheet>')
  writeCfbText(cfb, sheetPath, sheetXml)
  XLSX.CFB.utils.cfb_add(
    cfb,
    'xl/worksheets/_rels/sheet1.xml.rels',
    new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    ),
  )
  XLSX.CFB.utils.cfb_add(
    cfb,
    'xl/drawings/drawing1.xml',
    new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
    ),
  )
  XLSX.CFB.utils.cfb_add(cfb, 'xl/media/image1.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  const fileData = XLSX.CFB.write(cfb, { type: 'array', fileType: 'zip' }) as ArrayBuffer
  return { ...template, fileData, fileSize: fileData.byteLength }
}

function readCfbText(cfb: ReturnType<typeof XLSX.CFB.read>, path: string) {
  const index = cfb.FullPaths.findIndex((fullPath: string) => fullPath.replace(/^Root Entry\//, '') === path)
  return index < 0 ? '' : new TextDecoder().decode(cfb.FileIndex[index].content)
}

function writeCfbText(cfb: ReturnType<typeof XLSX.CFB.read>, path: string, value: string) {
  const index = cfb.FullPaths.findIndex((fullPath: string) => fullPath.replace(/^Root Entry\//, '') === path)
  if (index < 0) return
  cfb.FileIndex[index].content = new TextEncoder().encode(value)
  cfb.FileIndex[index].size = cfb.FileIndex[index].content.length
}
