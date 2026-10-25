import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readSheetImages } from './document-sheet-images'
import type { CfbContainer } from './document-template-xlsx'
import { readHistoryDocumentWorkbook } from './history-document-preview'

const drawing = `<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><twoCellAnchor><from><col>0</col><row>0</row><colOff>9525</colOff><rowOff>19050</rowOff></from><to><col>2</col><row>2</row><colOff>0</colOff><rowOff>0</rowOff></to><pic><nvPicPr><cNvPr descr="Logo &amp; name"/></nvPicPr><blipFill><a:blip r:embed="rId1"/><a:srcRect l="10000"/></blipFill><spPr><a:xfrm rot="5400000" flipH="1"><a:ext cx="952500" cy="476250"/></a:xfrm></spPr></pic></twoCellAnchor></wsDr>`
function fixture(target = '../media/logo.png', mode = '', source = drawing) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[], [], [], ['Visible']]), 'Sheet')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Hidden']]), 'Hidden')
  book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] }
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' })
  const path = 'xl/worksheets/sheet1.xml'
  const entry = zip.FileIndex[zip.FullPaths.findIndex((p: string) => p.endsWith('/' + path))]
  const xml = new TextDecoder().decode(entry.content as Uint8Array).replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>')
    .replace('<sheetData>', '<sheetFormatPr defaultColWidth="10" defaultRowHeight="18"/><sheetData>')
  entry.content = new TextEncoder().encode(xml); entry.size = entry.content.length
  const add = (p: string, value: string) => XLSX.CFB.utils.cfb_add(zip, p, new TextEncoder().encode(value))
  add('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>')
  add('xl/drawings/drawing1.xml', source)
  add('xl/drawings/_rels/drawing1.xml.rels', `<Relationships><Relationship Id="rId1" Target="${target}" ${mode}/></Relationships>`)
  XLSX.CFB.utils.cfb_add(zip, 'xl/media/logo.png', new Uint8Array([137, 80, 78, 71]))
  return { zip, path, xml }
}
it('preserves embedded image bytes, Excel anchors, crop and rotation', () => {
  const { zip, path, xml } = fixture()
  const result = readSheetImages(zip as CfbContainer, path, xml)
  expect(result.unsupported).toBe(false)
  expect(result.images).toEqual([expect.objectContaining({ src: 'data:image/png;base64,iVBORw==', alt: 'Logo & name',
    from: { column: 0, row: 0, x: 1, y: 2 }, to: { column: 2, row: 2, x: 0, y: 0 },
    rotation: 90, flipX: true, crop: [.1, 0, 0, 0] })])
})
it('keeps the physical size for a two-cell anchor configured to move without resizing', () => {
  const { zip, path, xml } = fixture('../media/logo.png', '', drawing.replace('<twoCellAnchor>', '<twoCellAnchor editAs="oneCell">'))
  expect(readSheetImages(zip as CfbContainer, path, xml).images[0]).toMatchObject({ width: 100, height: 50, to: undefined })
})
it('never fetches external images and flags unsupported or malformed objects', () => {
  for (const [target, mode, source] of [
    ['https://example.com/logo.png', 'TargetMode="External"', drawing],
    ['../../../outside.png', '', drawing], ['../media/logo.svg', '', drawing],
    ['../media/logo.png', '', drawing.replace('<pic>', '<graphicFrame>').replace('</pic>', '</graphicFrame>')],
    ['../media/logo.png', '', '<!DOCTYPE wsDr [<!ENTITY x "test">]><wsDr/>'],
    ['../media/logo.png', '', drawing.replace('<col>0</col>', '<col>-1</col>')],
  ]) {
    const { zip, path, xml } = fixture(target, mode, source)
    expect(readSheetImages(zip as CfbContainer, path, xml)).toEqual({ images: [], unsupported: true })
  }
})
it('includes a logo above the used cells, default dimensions and only visible sheets', async () => {
  const { zip } = fixture()
  const preview = await readHistoryDocumentWorkbook(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }) as ArrayBuffer)
  expect(preview.sheets.map(s => s.name)).toEqual(['Sheet'])
  const document = new DOMParser().parseFromString(preview.page(0, 0, 0, 'Logo'), 'text/html')
  expect(document.querySelector('[data-excel-row="0"]')).not.toBeNull()
  const image = document.querySelector<HTMLElement>('[data-excel-picture]')!
  expect(image.style.left).toBe('1px'); expect(image.style.top).toBe('2px')
  expect(image.style.width).toBe('139px'); expect(image.style.height).toBe('46px')
  expect(document.querySelector('img')?.getAttribute('alt')).toBe('Logo & name')
  expect(document.body.textContent).toContain('Visible'); expect(document.body.textContent).not.toContain('Hidden')
})
it('preserves an embedded header logo without executing VML or opening its links', () => {
  const { zip, path, xml } = fixture()
  const drawingEntry = zip.FileIndex[zip.FullPaths.findIndex((p: string) => p.endsWith('/xl/drawings/drawing1.xml'))]
  drawingEntry.content = new TextEncoder().encode('<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><v:shape id="CHFIRST" style="width:75pt;height:30pt"><v:imagedata o:relid="rId1" o:title="Логотип"/></v:shape></xml>')
  drawingEntry.size = drawingEntry.content.length
  const result = readSheetImages(zip as CfbContainer, path, xml.replace('<drawing ', '<legacyDrawingHF '))
  expect(result.unsupported).toBe(false)
  expect(result.images).toEqual([expect.objectContaining({ placement: 'header', align: 'center', width: 100, height: 40, alt: 'Логотип' })])
})
