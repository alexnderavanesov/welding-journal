import { expect, it } from 'vitest'
import { loadXlsx, preserveTemplateWorkbookXml, readCfbText, writeTemplateWorkbook } from './document-template-xlsx'
import { withSignatureSheetArtwork } from '@/test/fixtures/template-preview-workbook'
import { readHistoryDocumentWorkbook } from './history-document-preview'

it.each([false, true])('preserves styles, drawings and values on other sheets, reordered=%s', async reordered => {
  const XLSX = await loadXlsx(), book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Стык'], ['F1']]), 'Бланк')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Подписи — конец документа']]), 'Подписи')
  let template = await withSignatureSheetArtwork(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: true }))
  if (reordered) {
    const zip = XLSX.CFB.read(new Uint8Array(template), { type: 'array' })
    const entry = zip.FileIndex[zip.FullPaths.findIndex((path: string) => path.endsWith('/xl/workbook.xml'))]
    entry.content = new TextEncoder().encode(readCfbText(zip, 'xl/workbook.xml').replace(/<sheets>([\s\S]*?)<\/sheets>/,
      (_, sheets: string) => `<sheets>${sheets.match(/<sheet\b[^>]*\/>/g)!.reverse().join('')}</sheets>`))
    entry.size = entry.content.length
    template = XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }) as ArrayBuffer
  }
  const signatureIndex = reordered ? 0 : 1, filledIndex = reordered ? 1 : 0
  const original = await readHistoryDocumentWorkbook(template)
  expect(original.sheets[signatureIndex].styles.get('1:1')).toMatchObject({ color: '#008000', borderBottom: '2px solid #000000' })
  expect(original.sheets[signatureIndex].images).toHaveLength(1)
  const filled = XLSX.read(template, { type: 'array', cellStyles: true })
  filled.Sheets.Бланк.A2.v = 'F2'
  const result = writeTemplateWorkbook(template, filled, { markerRow: 1, recordCount: 1, sheetIndex: filledIndex })
  const preview = await readHistoryDocumentWorkbook(result)
  expect(preview.sheets[filledIndex].worksheet.A2.v).toBe('F2')
  expect(preview.sheets[signatureIndex].worksheet.A1.v).toBe('Подписи — конец документа')
  expect(preview.sheets[signatureIndex].styles.get('1:1')).toMatchObject({ color: '#008000', fontWeight: 700, borderBottom: '2px solid #000000' })
  expect(preview.sheets[signatureIndex].images).toHaveLength(1)
  expect(preview.sheets[signatureIndex].images[0]).toMatchObject({ alt: 'Логотип подписей', width: 64, height: 64 })
})

it('preserves compact column ranges and their widths, styles and visibility through template filling', async () => {
  const XLSX = await loadXlsx()
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Бланк'], ['Значение']]), 'Акт')
  workbook.Sheets.Акт['!merges'] = [XLSX.utils.decode_range('A2:D2')]
  const otherSheet = XLSX.utils.aoa_to_sheet([['Неизменяемый лист']])
  otherSheet['!cols'] = [{ wch: 25 }, ...Array.from({ length: 15 }, () => ({ wch: 9, hidden: true }))]
  XLSX.utils.book_append_sheet(workbook, otherSheet, 'Справка')
  workbook.Workbook = { Names: [{ Name: '_xlnm.Print_Area', Sheet: 0, Ref: "'Акт'!$A$1:$J$20" }] }
  const base = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const source = XLSX.CFB.read(new Uint8Array(base), { type: 'array' })
  const columns = '<cols><col min="1" max="2" width="20.5" customWidth="1"/><col min="3" max="16384" width="9" style="0" hidden="1"/></cols>'
  const file = source.FileIndex[source.FullPaths.findIndex((path: string) => path.endsWith('/xl/worksheets/sheet1.xml'))]
  file.content = Buffer.from(readCfbText(source, 'xl/worksheets/sheet1.xml')!.replace('<sheetData>', columns + '<sheetData>'))
  file.size = file.content.length
  const template = XLSX.CFB.write(source, { type: 'array', fileType: 'zip' }) as ArrayBuffer
  const expanded = XLSX.read(template, { type: 'array', cellStyles: true })
  expanded.Sheets.Акт.A2.v = 'Заполнено\nТекст на второй строке'
  const originalColumns = expanded.Sheets.Акт['!cols']
  const generated = XLSX.write(expanded, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer
  const result = preserveTemplateWorkbookXml(template, generated, { markerRow: 1, recordCount: 1, sheetIndex: 0 })
  const archive = XLSX.CFB.read(new Uint8Array(result), { type: 'array' })
  const xml = readCfbText(archive, 'xl/worksheets/sheet1.xml')!
  expect(xml.match(/<cols>[\s\S]*?<\/cols>/)?.[0]).toBe(columns)
  expect(xml.indexOf('<cols>')).toBeLessThan(xml.indexOf('<sheetData>'))
  expect(xml).toContain('Заполнено')
  expect(result.byteLength).toBeLessThan(generated.byteLength / 5)
  const optimized = writeTemplateWorkbook(template, expanded, { markerRow: 1, recordCount: 1, sheetIndex: 0 })
  expect(expanded.Sheets.Акт['!cols']).toBe(originalColumns)
  expect(originalColumns).toHaveLength(16384)
  const compactArchive = XLSX.CFB.read(new Uint8Array(optimized), { type: 'array' })
  for (const path of archive.FullPaths.filter((path: string) => /\.(xml|rels)$/.test(path))) {
    const relative = path.slice(path.indexOf('/') + 1)
    expect(readCfbText(compactArchive, relative), relative).toBe(readCfbText(archive, relative))
  }
})

it('retains columns outside the filled area for legacy XLS without restorable worksheet XML', async () => {
  const XLSX = await loadXlsx()
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([['Старый шаблон']])
  sheet['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 8, hidden: true }]
  XLSX.utils.book_append_sheet(book, sheet, 'Лист')
  const template = XLSX.write(book, { type: 'array', bookType: 'xls', cellStyles: true }) as ArrayBuffer
  const loaded = XLSX.read(template, { type: 'array', cellStyles: true })
  expect(loaded.Sheets.Лист['!cols']!.length).toBeGreaterThan(1)
  const context = { markerRow: 1, recordCount: 1, sheetIndex: 0 }
  const original = preserveTemplateWorkbookXml(template, XLSX.write(loaded, { type: 'array', bookType: 'xlsx', cellStyles: true }), context)
  const optimized = writeTemplateWorkbook(template, loaded, context)
  const old = XLSX.CFB.read(new Uint8Array(original), { type: 'array' })
  const next = XLSX.CFB.read(new Uint8Array(optimized), { type: 'array' })
  expect(readCfbText(next, 'xl/worksheets/sheet1.xml')).toBe(readCfbText(old, 'xl/worksheets/sheet1.xml'))
})
