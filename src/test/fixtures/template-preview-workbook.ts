/** VIK-like template layout: unmerged labels, center-across and an occupied neighbour. */
export async function templatePreviewWorkbook() {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['1. В соответствии с нарядом-заказом (заявкой)', '', '', '', '', '330-ТКМ5-7424', '', '', '', ''],
    ['Стык № F10 — 159×10 мм / 159×10 мм. Способ сварки РАД; Клеймо сварщика: E8ES', '', '', '', '', '', '', '', '', 'Годен'],
    ['Перенос текста внутри одной ячейки', '', '', '', '', '', '', '', '', ''],
    ['Подпись', '', '', '', '', '', '', '', '', ''],
  ])
  sheet['!cols'] = Array.from({ length: 10 }, () => ({ wpx: 80 }))
  sheet['!rows'] = [{ hpt: 32 }, { hpt: 24 }, { hpt: 64 }, { hpt: 24 }]
  sheet['!merges'] = [XLSX.utils.decode_range('F1:J1'), XLSX.utils.decode_range('B4:C4')]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Акт ВИК')
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' })
  const replace = (suffix: string, transform: (xml: string) => string) => {
    const entry = zip.FileIndex[zip.FullPaths.findIndex((path: string) => path.endsWith(suffix))]
    entry.content = new TextEncoder().encode(transform(new TextDecoder().decode(entry.content as Uint8Array)))
    entry.size = entry.content.length
  }
  replace('/xl/worksheets/sheet1.xml', xml => xml.replace(/<c r="([A-E]1|A3)"/g, (match, address) => `${match} s="${address === 'A3' ? 2 : 1}"`))
  replace('/xl/styles.xml', () => `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="12"/><name val="Times New Roman"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="0" fillId="0" borderId="0"><alignment horizontal="centerContinuous" wrapText="1"/></xf><xf fontId="0" fillId="0" borderId="0"><alignment wrapText="1"/></xf></cellXfs></styleSheet>`)
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }) as ArrayBuffer
}

/** Hidden wrapped cells must not stretch rows; outlines belong to merge edges. */
export async function templateSizingWorkbook() {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([['Объединение', '', 'Скрытый длинный заголовок '.repeat(20), 'Дата'],
    ['', '', '', ''], ['Длинное описание с переносом на несколько строк', '', '', '03.09.2026']])
  sheet['!ref'] = 'A1:Z20'
  sheet['!cols'] = [{ wpx: 100 }, { wpx: 100 }, { hidden: true, wpx: 60 }, { wpx: 100 }]
  sheet['!rows'] = [{ hpt: 18 }, { hpt: 18 }, { hpt: 18 }]
  sheet['!merges'] = [XLSX.utils.decode_range('A1:B2'), XLSX.utils.decode_range('C1:C2')]
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Sizing')
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' })
  const replace = (suffix: string, transform: (xml: string) => string) => {
    const entry = zip.FileIndex[zip.FullPaths.findIndex((path: string) => path.endsWith(suffix))]
    entry.content = new TextEncoder().encode(transform(new TextDecoder().decode(entry.content as Uint8Array))); entry.size = entry.content.length
  }
  replace('/xl/worksheets/sheet1.xml', xml => xml.replace(/<c r="(A1|B2|C1|A3)"/g, (match, address) => `${match} s="${address === 'B2' ? 2 : 1}"`))
  replace('/xl/styles.xml', () => '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="12"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="2"><border/><border><right style="thin"><color indexed="64"/></right><bottom style="thin"><color indexed="64"/></bottom></border></borders><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="0" fillId="0" borderId="0"><alignment wrapText="1"/></xf><xf fontId="0" fillId="0" borderId="1"/></cellXfs></styleSheet>')
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }) as ArrayBuffer
}

/** A separate signature sheet must retain its own formatting and logo after filling the first sheet. */
export async function withSignatureSheetArtwork(data: ArrayBuffer) {
  const XLSX = await import('xlsx')
  const zip = XLSX.CFB.read(new Uint8Array(data), { type: 'array' })
  const replace = (path: string, transform: (xml: string) => string) => {
    const entry = zip.FileIndex[zip.FullPaths.findIndex((name: string) => name.endsWith('/' + path))]
    entry.content = new TextEncoder().encode(transform(new TextDecoder().decode(entry.content as Uint8Array)))
    entry.size = entry.content.length
  }
  const add = (path: string, xml: string) => XLSX.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml))
  replace('xl/styles.xml', () => '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><sz val="14"/><b/><color rgb="FF008000"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="2"><border/><border><bottom style="medium"><color rgb="FF000000"/></bottom></border></borders><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="0" borderId="1"/></cellXfs></styleSheet>')
  replace('xl/worksheets/sheet2.xml', xml => xml.replace('<c r="A1"', '<c s="1" r="A1"').replace('</worksheet>', '<drawing r:id="logo"/></worksheet>'))
  add('xl/worksheets/_rels/sheet2.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="logo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/signature.xml"/></Relationships>')
  add('xl/drawings/signature.xml', '<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><oneCellAnchor><from><col>0</col><row>2</row></from><ext cx="609600" cy="609600"/><pic><nvPicPr><cNvPr id="1" name="Logo" descr="Логотип подписей"/><cNvPicPr/></nvPicPr><blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></blipFill><spPr><a:prstGeom prst="rect"/></spPr></pic><clientData/></oneCellAnchor></wsDr>')
  add('xl/drawings/_rels/signature.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/signature.png"/></Relationships>')
  XLSX.CFB.utils.cfb_add(zip, 'xl/media/signature.png', Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII='), ch => ch.charCodeAt(0)))
  replace('[Content_Types].xml', xml => xml.replace('</Types>', '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/signature.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'))
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }) as ArrayBuffer
}
