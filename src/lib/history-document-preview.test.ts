import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readHistoryDocumentWorkbook } from './history-document-preview'

function file(sheet: XLSX.WorkSheet, additional?: XLSX.WorkSheet) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Основной')
  if (additional) XLSX.utils.book_append_sheet(book, additional, 'Подписи')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('history workbook preview', () => {
  it('centres the screen page without changing Excel column widths or the print shell', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['One', 'Two']])
    sheet['!cols'] = [{ wpx: 190 }, { wpx: 230 }]
    const workbook = await readHistoryDocumentWorkbook(file(sheet))
    const fullPrint = workbook.print('Document')
    const html = workbook.page(0, 0, 0, 'Document', 75)
    expect(html).toContain('data-document-preview-page style="zoom:0.75"')
    expect(html).toContain('width:max-content;margin:0 auto')
    expect(html).toContain('@media screen{html{scrollbar-gutter:stable}')
    expect(html).toContain('<table style="width:420px">')
    expect(html).not.toContain('<script')
    expect(fullPrint).not.toContain('data-document-preview-page')
    expect(fullPrint).not.toContain('@media screen')
    expect(workbook.print('Document')).toBe(fullPrint)
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

  it('bounds a 10000 × 111 preview and reaches its last cell without allowing partial printing', async () => {
    const sheet = { '!ref': 'A1:DG10000', A1: { t: 's', v: 'First' }, DG10000: { t: 's', v: 'Last' } } satisfies XLSX.WorkSheet
    const preview = await readHistoryDocumentWorkbook(file(sheet))
    const first = preview.page(0, 0, 0, 'Large')
    expect(first.match(/<td/g)).toHaveLength(4000)
    expect(first).not.toContain('>Last<')
    expect(preview.page(0, 99, 2, 'Large')).toContain('>Last<')
    expect(preview.printRestriction).toContain('10000 строк Excel')
    expect(() => preview.print('Large')).toThrow('10000 строк Excel')
  })

  it('prints the entire allowed 1000 × 111 sheet, not just the current page', async () => {
    const preview = await readHistoryDocumentWorkbook(file({ '!ref': 'A1:DG1000', DG1000: { t: 's', v: 'End' } }))
    expect(preview.printRestriction).toBe('')
    expect(preview.print('Allowed').match(/<td/g)).toHaveLength(111000)
    expect(preview.print('Allowed')).toContain('>End<')
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
    expect(preview.print('All').match(/class="sheet"/g)).toHaveLength(2)
  })
})
