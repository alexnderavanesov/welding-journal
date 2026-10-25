import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readHistoryDocumentWorkbook } from './history-document-preview'
import { templatePreviewWorkbook, templateSizingWorkbook } from '../test/fixtures/template-preview-workbook'

function file(sheet: XLSX.WorkSheet, additional?: XLSX.WorkSheet) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Основной')
  if (additional) XLSX.utils.book_append_sheet(book, additional, 'Подписи')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('history workbook preview', () => {
  it('trims empty tails, ignores hidden wrapped text and preserves merge outlines', async () => {
    const preview = await readHistoryDocumentWorkbook(await templateSizingWorkbook())
    expect(preview.sheets[0].range).toEqual({ s: { r: 0, c: 0 }, e: { r: 2, c: 3 } })
    const doc = new DOMParser().parseFromString(preview.page(0, 0, 0, 'Sizing'), 'text/html')
    expect(doc.body.textContent).not.toContain('Скрытый длинный')
    const merged = doc.querySelector<HTMLElement>('[data-cell-address="A1"]')!
    expect(merged.style.borderBottom).toBe('1px solid rgb(0, 0, 0)')
    expect(merged.style.borderRight).toBe('1px solid rgb(0, 0, 0)')
  })
  it('uses workbook theme colours and tint for borders instead of a generic screen grid', async () => {
    const zip = XLSX.CFB.read(new Uint8Array(await templateSizingWorkbook()), { type: 'array' })
    const entry = zip.FileIndex[zip.FullPaths.findIndex((path: string) => path.endsWith('/xl/styles.xml'))]
    entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content as Uint8Array).replaceAll('indexed="64"', 'theme="4" tint="0.89999084444715716"'))
    entry.size = entry.content.length
    const themeEntry = zip.FileIndex[zip.FullPaths.findIndex((path: string) => path.endsWith('/xl/theme/theme1.xml'))]
    themeEntry.content = new TextEncoder().encode(new TextDecoder().decode(themeEntry.content as Uint8Array).replace(/<a:accent1>[\s\S]*?<\/a:accent1>/, '<a:accent1><a:srgbClr val="0E2841"/></a:accent1>'))
    themeEntry.size = themeEntry.content.length
    const preview = await readHistoryDocumentWorkbook(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }) as ArrayBuffer)
    expect(preview.page(0, 0, 0, 'Theme')).toContain('border-bottom:1px solid #dceaf7')
  })
  it('renders Excel overflow and center-across without expanding columns, crossing occupied cells or losing wrap rules', async () => {
    const workbook = await readHistoryDocumentWorkbook(await templatePreviewWorkbook())
    for (const html of [workbook.page(0, 0, 0, 'Акт')]) {
      const document = new DOMParser().parseFromString(html, 'text/html')
      const cell = (address: string) => document.querySelector<HTMLElement>(`[data-cell-address="${address}"]`)!
      expect(cell('A1').style.textAlign).toBe('center')
      expect(cell('A1').querySelector<HTMLElement>('.excel-overflow')?.style.width).toBe('394px')
      expect(cell('A2').querySelector<HTMLElement>('.excel-overflow')?.style.width).toBe('714px')
      expect(cell('J2').textContent).toBe('Годен')
      expect(cell('A3').style.whiteSpace).toBe('pre-wrap')
      expect(cell('A3').querySelector('.excel-overflow')).toBeNull()
      expect(cell('A4').querySelector('.excel-overflow')).toBeNull()
      expect(document.querySelector('table')?.style.width).toBe('800px')
    }
  })
  it('centres the screen page without changing Excel column widths or the workbook', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['One', 'Two']])
    sheet['!cols'] = [{ wpx: 190 }, { wpx: 230 }]
    const workbook = await readHistoryDocumentWorkbook(file(sheet))
    const html = workbook.page(0, 0, 0, 'Document', 75)
    expect(html).toContain('data-document-preview-page style="zoom:0.75"')
    expect(html).toContain('width:max-content;margin:0 auto')
    expect(html).toContain('html{scrollbar-gutter:stable}')
    expect(html).toContain('<table style="width:420px">')
    expect(html).not.toContain('<script')
  })

  it('preserves merges, formatted values, sizes and OOXML cell styling; escapes content', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['<script>alert(1)</script>', ''], [123.5, 'Последний']])
    sheet.A2.z = '0.00'
    sheet['!merges'] = [XLSX.utils.decode_range('A1:B1')]
    sheet['!cols'] = [{ wpx: 190 }, { wpx: 230 }]
    sheet['!rows'] = [{ hpt: 36 }]
    const zip = XLSX.CFB.read(new Uint8Array(file(sheet)), { type: 'array' })
    const entry = zip.FileIndex[zip.FullPaths.findIndex((path: string) => path.endsWith('/xl/worksheets/sheet1.xml'))]
    const xml = new TextDecoder().decode(new Uint8Array(entry.content as Uint8Array)).replace('r="A1"', 'r="A1" s="1"')
    const replace = (suffix: string, text: string) => {
      const target = zip.FileIndex[zip.FullPaths.findIndex((path: string) => path.endsWith(suffix))]
      target.content = new TextEncoder().encode(text); target.size = target.content.length
    }
    replace('/xl/worksheets/sheet1.xml', xml.replace(/(<c r="A2"[^>]*?)s="\d+"/, '$1s="2"'))
    replace('/xl/styles.xml', `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Times New Roman"/><color rgb="FF223344"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFCCEEFF"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FF000000"/></bottom></border></borders><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="1" borderId="1"><alignment horizontal="center" wrapText="1"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`)
    const preview = await readHistoryDocumentWorkbook(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }) as ArrayBuffer)
    const html = preview.page(0, 0, 0, 'Имя <img>')
    expect(html).toContain('colspan="2"')
    expect(html).toContain('height:48px')
    expect(html).toContain('width:190px')
    expect(html).toContain('font-size:14pt')
    expect(html).toContain('font-weight:700')
    expect(html).toContain('background-color:#CCEEFF')
    expect(html).toContain('border-bottom:1px solid #000000')
    expect(html).toContain('text-align:center')
    expect(html).toContain('>123.50<')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<img>')
    expect(html).not.toContain('<script>')
  })

  it('bounds a 10000 × 111 preview and reaches its last cell', async () => {
    const sheet = { '!ref': 'A1:DG10000', A1: { t: 's', v: 'First' }, DG10000: { t: 's', v: 'Last' } } satisfies XLSX.WorkSheet
    const preview = await readHistoryDocumentWorkbook(file(sheet))
    const first = preview.page(0, 0, 0, 'Large')
    expect(first.match(/<td/g)).toHaveLength(11100)
    expect(first).not.toContain('>Last<')
    expect(preview.page(0, 99, 0, 'Large')).toContain('>Last<')
  })

  it('keeps merged text on a page boundary and supports all sheets including empty ones', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Merged']])
    sheet['!ref'] = 'A1:A201'; sheet['!merges'] = [XLSX.utils.decode_range('A1:A201')]
    const preview = await readHistoryDocumentWorkbook(file(sheet, XLSX.utils.aoa_to_sheet([])))
    const last = preview.page(0, 2, 0, 'Merge')
    expect(last.match(/<td/g)).toHaveLength(1)
    expect(last).toContain('>Merged<')
    expect(last).toContain('rowspan="1"')
    expect(preview.page(1, 0, 0, 'Empty')).toContain('Лист пустой')
    expect(preview.sheets).toHaveLength(2)
  })
})
