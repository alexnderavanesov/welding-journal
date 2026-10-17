import type { Range, WorkBook, WorkSheet } from 'xlsx'
import type { DocumentTemplatePreviewCellStyle } from './document-template-model'
import { getPreviewCellStyle, getPreviewWorkbookXmlStyles } from './document-template-preview'
import { loadXlsx, readCfbText, getWorksheetPath, type CfbContainer } from './document-template-xlsx'
import { REPORT_PRINT_ROW_LIMIT } from './report-print-policy'

export const DOCUMENT_PREVIEW_PAGE_ROWS = 100
export const DOCUMENT_PREVIEW_PAGE_COLUMNS = 40
const PRINT_CELL_LIMIT = 111_000

export type HistoryDocumentWorkbook = Awaited<ReturnType<typeof readHistoryDocumentWorkbook>>

/** Parse once per explicit opening. Paging and printing never fetch records again. */
export async function readHistoryDocumentWorkbook(fileData: ArrayBuffer) {
  const XLSX = await loadXlsx()
  const workbook: WorkBook = XLSX.read(fileData, { type: 'array', cellStyles: true, cellNF: true })
  let container: CfbContainer | undefined
  try { container = XLSX.CFB.read(new Uint8Array(fileData), { type: 'array' }) as CfbContainer } catch { /* Legacy .xls has no OOXML styles. */ }
  const sheets = workbook.SheetNames.flatMap((name, index) => {
    if (workbook.Workbook?.Sheets?.[index]?.Hidden) return []
    const worksheet = workbook.Sheets[name]
    const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null
    const xml = container ? readCfbText(container, getWorksheetPath(container, index)) ?? '' : ''
    return [{
      name, worksheet, range,
      rowCount: range ? range.e.r - range.s.r + 1 : 0,
      columnCount: range ? range.e.c - range.s.c + 1 : 0,
      styles: getPreviewWorkbookXmlStyles(fileData, index, container, true),
      hasDrawings: /<(?:\w+:)?(?:drawing|legacyDrawing|picture)\b/.test(xml),
      landscape: /<pageSetup\b[^>]*orientation="landscape"/.test(xml),
    }]
  })
  if (!sheets.length) throw new Error('В документе нет видимых листов для просмотра.')
  const rowCount = sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0)
  const cellCount = sheets.reduce((sum, sheet) => sum + sheet.rowCount * sheet.columnCount, 0)
  const printRestriction = rowCount > REPORT_PRINT_ROW_LIMIT
    ? `В документе ${rowCount} строк Excel. Печать в приложении доступна до ${REPORT_PRINT_ROW_LIMIT} строк. Скачайте полный Excel для печати.`
    : cellCount > PRINT_CELL_LIMIT
      ? 'Документ слишком широк для печати в приложении. Скачайте полный Excel для печати.'
      : ''

  function table(sheet: typeof sheets[number], range: Range | null) {
    if (!range) return '<p>Лист пустой.</p>'
    // Intersect merges with this page, never enumerate off-screen merged cells.
    const origins = new Map<string, { merge: Range; row: number; column: number }>()
    const covered = new Set<string>()
    for (const merge of sheet.worksheet['!merges'] ?? []) {
      const clipped = { s: { r: Math.max(merge.s.r, range.s.r), c: Math.max(merge.s.c, range.s.c) }, e: { r: Math.min(merge.e.r, range.e.r), c: Math.min(merge.e.c, range.e.c) } }
      if (clipped.s.r > clipped.e.r || clipped.s.c > clipped.e.c) continue
      origins.set(`${clipped.s.r}:${clipped.s.c}`, { merge: clipped, row: merge.s.r, column: merge.s.c })
      for (let r = clipped.s.r; r <= clipped.e.r; r++) for (let c = clipped.s.c; c <= clipped.e.c; c++) {
        if (r !== clipped.s.r || c !== clipped.s.c) covered.add(`${r}:${c}`)
      }
    }
    let columns = '', rows = '', width = 0
    for (let c = range.s.c; c <= range.e.c; c++) {
      const px = columnWidth(sheet.worksheet, c)
      width += px
      columns += `<col style="width:${px}px${px === 0 ? ';visibility:collapse' : ''}">`
    }
    for (let r = range.s.r; r <= range.e.r; r++) {
      const rowInfo = sheet.worksheet['!rows']?.[r]
      let cells = ''
      for (let c = range.s.c; c <= range.e.c; c++) {
        const key = `${r}:${c}`
        if (covered.has(key)) continue
        const origin = origins.get(key)
        const sourceRow = origin?.row ?? r, sourceColumn = origin?.column ?? c
        const cell = sheet.worksheet[XLSX.utils.encode_cell({ r: sourceRow, c: sourceColumn })]
        const style = { ...getPreviewCellStyle(cell?.s), ...(sheet.styles.get(`${sourceRow + 1}:${sourceColumn + 1}`) ?? sheet.styles.get('default')) }
        const text = cell ? XLSX.utils.format_cell(cell) : ''
        const merge = origin?.merge
        const spans = merge ? ` rowspan="${merge.e.r - merge.s.r + 1}" colspan="${merge.e.c - merge.s.c + 1}"` : ''
        cells += `<td${spans} style="${escapeHtml(cellCss({ ...style, textAlign: style.textAlign ?? (cell?.t === 'n' ? 'right' : cell?.t === 'b' ? 'center' : 'left') }))}">${escapeHtml(text)}</td>`
      }
      const height = rowInfo?.hpt !== undefined ? rowInfo.hpt * 96 / 72 : rowInfo?.hpx ?? 20
      rows += `<tr style="height:${height}px${rowInfo?.hidden ? ';display:none' : ''}">${cells}</tr>`
    }
    return `<table style="width:${width}px"><colgroup>${columns}</colgroup><tbody>${rows}</tbody></table>`
  }
  function page(sheetIndex: number, rowPage: number, columnPage: number, title: string, zoom = 100) {
    const sheet = sheets[sheetIndex]
    const source = sheet.range
    const range = source ? {
      s: { r: source.s.r + rowPage * DOCUMENT_PREVIEW_PAGE_ROWS, c: source.s.c + columnPage * DOCUMENT_PREVIEW_PAGE_COLUMNS },
      e: { r: Math.min(source.e.r, source.s.r + (rowPage + 1) * DOCUMENT_PREVIEW_PAGE_ROWS - 1), c: Math.min(source.e.c, source.s.c + (columnPage + 1) * DOCUMENT_PREVIEW_PAGE_COLUMNS - 1) },
    } : null
    return shell(title, `<div data-document-preview-page style="zoom:${zoom / 100}">${table(sheet, range)}</div>`, true)
  }
  function print(title: string) {
    if (printRestriction) throw new Error(printRestriction)
    return shell(title, sheets.map((sheet, index) => {
      const width = sheet.range ? Array.from({ length: sheet.columnCount }, (_, c) => columnWidth(sheet.worksheet, c + sheet.range!.s.c)).reduce((a, b) => a + b, 0) : 1
      const landscape = sheet.landscape || width > 720
      const zoom = Math.min(1, (landscape ? 1046 : 718) / Math.max(width, 1))
      return `<section class="sheet" style="page:sheet${index}"><style>@page sheet${index}{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:10mm}</style><div style="zoom:${zoom}">${table(sheet, sheet.range)}</div></section>`
    }).join(''))
  }
  return { sheets, printRestriction, page, print }
}

function columnWidth(sheet: WorkSheet, column: number) {
  const info = sheet['!cols']?.[column]
  return info?.hidden ? 0 : info?.wpx ?? (info?.wch ? info.wch * 7 + 5 : info?.width ? info.width * 7 : 64)
}

function cellCss(style: DocumentTemplatePreviewCellStyle) {
  const properties: Record<string, string | number | undefined> = {
    'background-color': style.backgroundColor, color: style.color,
    'font-family': style.fontFamily ? `'${style.fontFamily.replace(/[^\p{L}\p{N} ,_-]/gu, '')}'` : undefined,
    'font-size': style.fontSize ? `${style.fontSize}pt` : undefined,
    'font-weight': style.fontWeight, 'font-style': style.fontStyle,
    'text-decoration': style.textDecoration, 'text-align': style.textAlign,
    'vertical-align': style.verticalAlign, 'white-space': style.whiteSpace === 'pre-line' ? 'pre-wrap' : 'pre',
    'border-top': style.borderTop, 'border-right': style.borderRight,
    'border-bottom': style.borderBottom, 'border-left': style.borderLeft,
  }
  return Object.entries(properties).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}:${value}`).join(';')
}

function shell(title: string, content: string, preview = false) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{margin:0;padding:20px;background:#f1f5f9;color:#000;font:11pt Arial,sans-serif}table{table-layout:fixed;border-collapse:collapse;background:white}td{padding:1px 3px;overflow:hidden;vertical-align:bottom;overflow-wrap:break-word}tr{break-inside:avoid}.sheet{break-after:page}.sheet:last-child{break-after:auto}@media print{body{padding:0;background:white}td{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    ${preview ? '@media screen{html{scrollbar-gutter:stable}body{padding:16px}[data-document-preview-page]{width:max-content;margin:0 auto;background:white;box-shadow:0 1px 5px #0f172a1a}[data-document-preview-page]>p{min-width:240px;margin:0;padding:16px}}' : ''}
    </style></head><body>${content}</body></html>`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
