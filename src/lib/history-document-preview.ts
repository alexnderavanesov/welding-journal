import type { Range, WorkBook, WorkSheet } from 'xlsx'
import type { DocumentTemplatePreviewCellStyle } from './document-template-model'
import { getPreviewCellStyle, getPreviewWorkbookXmlStyles } from './document-template-preview'
import { readSheetImages } from './document-sheet-images'
import { loadXlsx, readCfbText, getWorksheetPath, parseXmlAttributes, type CfbContainer } from './document-template-xlsx'

export const DOCUMENT_PREVIEW_PAGE_ROWS = 100
export const DOCUMENT_PREVIEW_PAGE_COLUMNS = 111

export type HistoryDocumentWorkbook = Awaited<ReturnType<typeof readHistoryDocumentWorkbook>>

/** Parse once per explicit opening. Paging never fetches records again. */
export async function readHistoryDocumentWorkbook(fileData: ArrayBuffer) {
  const XLSX = await loadXlsx()
  const workbook: WorkBook = XLSX.read(fileData, { type: 'array', cellStyles: true, cellNF: true })
  let container: CfbContainer | undefined
  try { container = XLSX.CFB.read(new Uint8Array(fileData), { type: 'array' }) as CfbContainer } catch { /* Legacy .xls has no OOXML styles. */ }
  const sheets = workbook.SheetNames.flatMap((name, index) => {
    if (workbook.Workbook?.Sheets?.[index]?.Hidden) return []
    const worksheet = workbook.Sheets[name]
    const styles = getPreviewWorkbookXmlStyles(fileData, index, container, true)
    let range: Range | null = null
    // Ignore empty formatting tails, but preserve blank bordered/form cells.
    for (const address of Object.keys(worksheet)) {
      if (address.startsWith('!')) continue
      const cell = worksheet[address], point = XLSX.utils.decode_cell(address)
      const style = styles.get(`${point.r + 1}:${point.c + 1}`) ?? styles.get('default')
      if (worksheet['!cols']?.[point.c]?.hidden || worksheet['!rows']?.[point.r]?.hidden) continue
      if (cell.f || cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '' ||
        style?.borderTop || style?.borderRight || style?.borderBottom || style?.borderLeft ||
        style?.backgroundColor && !/^#(?:fff|ffffff)$/i.test(style.backgroundColor)) {
        range = extend(range, { s: point, e: point })
      }
    }
    for (const merge of worksheet['!merges'] ?? []) {
      if (range && merge.s.r <= range.e.r && merge.e.r >= range.s.r && merge.s.c <= range.e.c && merge.e.c >= range.s.c) range = extend(range, merge)
    }
    const xml = container ? readCfbText(container, getWorksheetPath(container, index)) ?? '' : ''
    const format = parseXmlAttributes(xml.match(/<sheetFormatPr\b[^>]*>/)?.[0] ?? '')
    const defaultColumn = Number(format.get('defaultColWidth') || 0)
    const defaultRowHeight = Number(format.get('defaultRowHeight') || 15) * 96 / 72
    const pictures = readSheetImages(container, container ? getWorksheetPath(container, index) : '', xml)
    for (const image of pictures.images.filter(image => !image.placement)) {
      const start = { r: image.from.row, c: image.from.column }, end = image.to ? { r: image.to.row, c: image.to.column } : start
      range = extend(range, { s: start, e: end })
    }
    if (defaultColumn && range) {
      worksheet['!cols'] ??= []
      for (let c = range.s.c; c <= range.e.c; c++) worksheet['!cols']![c] ??= { width: defaultColumn }
    }
    return [{
      name, worksheet, range, defaultRowHeight, ...pictures,
      rowCount: range ? range.e.r - range.s.r + 1 : 0,
      columnCount: range ? range.e.c - range.s.c + 1 : 0,
      styles,
    }]
  })
  if (!sheets.length) throw new Error('В документе нет видимых листов для просмотра.')
  function table(sheet: typeof sheets[number], range: Range | null) {
    if (!range) return '<p>Лист пустой.</p>'
    // Intersect merges with this page, never enumerate off-screen merged cells.
    const origins = new Map<string, { merge: Range; source: Range; row: number; column: number }>()
    const covered = new Set<string>()
    for (const merge of sheet.worksheet['!merges'] ?? []) {
      const clipped = { s: { r: Math.max(merge.s.r, range.s.r), c: Math.max(merge.s.c, range.s.c) }, e: { r: Math.min(merge.e.r, range.e.r), c: Math.min(merge.e.c, range.e.c) } }
      if (clipped.s.r > clipped.e.r || clipped.s.c > clipped.e.c) continue
      origins.set(`${clipped.s.r}:${clipped.s.c}`, { merge: clipped, source: merge, row: merge.s.r, column: merge.s.c })
      for (let r = clipped.s.r; r <= clipped.e.r; r++) for (let c = clipped.s.c; c <= clipped.e.c; c++) {
        if (r !== clipped.s.r || c !== clipped.s.c) covered.add(`${r}:${c}`)
      }
    }
    let columns = '', rows = '', width = 0
    for (let c = range.s.c; c <= range.e.c; c++) {
      const px = columnWidth(sheet.worksheet, c)
      width += px
      columns += `<col data-excel-column="${c}" style="width:${px}px${px === 0 ? ';visibility:collapse' : ''}">`
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
        if (origin) {
          const { s, e } = origin.source
          const at = (r: number, c: number) => sheet.styles.get(`${r + 1}:${c + 1}`)
          // Excel can store the outline on the far cells of an empty merge.
          style.borderTop = at(s.r, s.c)?.borderTop ?? at(s.r, e.c)?.borderTop ?? style.borderTop
          style.borderBottom = at(e.r, s.c)?.borderBottom ?? at(e.r, e.c)?.borderBottom ?? style.borderBottom
          style.borderLeft = at(s.r, s.c)?.borderLeft ?? at(e.r, s.c)?.borderLeft ?? style.borderLeft
          style.borderRight = at(s.r, e.c)?.borderRight ?? at(e.r, e.c)?.borderRight ?? style.borderRight
        }
        const hidden = Array.from({ length: (origin?.merge.e.c ?? c) - c + 1 }, (_, i) => c + i).every(col => columnWidth(sheet.worksheet, col) === 0)
        const text = !hidden && cell ? XLSX.utils.format_cell(cell) : ''
        const merge = origin?.merge
        const spans = merge ? ` rowspan="${merge.e.r - merge.s.r + 1}" colspan="${merge.e.c - merge.s.c + 1}"` : ''
        const textAlign = style.textAlign ?? (cell?.t === 'n' ? 'right' : cell?.t === 'b' ? 'center' : 'left')
        let overflowWidth = columnWidth(sheet.worksheet, c)
        // Excel's unwrapped labels and "Center Across Selection" can use
        // adjacent blank cells without merging or changing the workbook.
        if (!merge && text && cell?.t === 's' && (style.centerAcrossSelection || style.whiteSpace !== 'pre-line' && textAlign === 'left')) {
          for (let next = c + 1; next <= range.e.c; next++) {
            const nextCell = sheet.worksheet[XLSX.utils.encode_cell({ r, c: next })]
            const nextStyle = sheet.styles.get(`${r + 1}:${next + 1}`) ?? sheet.styles.get('default')
            if (nextCell?.f || nextCell?.v !== undefined && nextCell.v !== null && nextCell.v !== ''
              || covered.has(`${r}:${next}`) || origins.has(`${r}:${next}`)
              || style.centerAcrossSelection && !nextStyle?.centerAcrossSelection) break
            overflowWidth += columnWidth(sheet.worksheet, next)
          }
        }
        const overflow = overflowWidth > columnWidth(sheet.worksheet, c)
        const content = overflow ? `<span class="excel-overflow" style="width:${Math.max(0, overflowWidth - 6)}px">${escapeHtml(text)}</span>` : escapeHtml(text)
        cells += `<td data-cell-address="${XLSX.utils.encode_cell({ r: sourceRow, c: sourceColumn })}"${spans} style="${hidden ? 'padding:0;border:0' : escapeHtml(cellCss({ ...style, textAlign }))}${overflow ? ';overflow:visible;position:relative' : ''}">${content}</td>`
      }
      const height = rowHeight(sheet, r)
      rows += `<tr data-excel-row="${r}" style="height:${height}px${rowInfo?.hidden ? ';display:none' : ''}">${cells}</tr>`
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
    const content = table(sheet, range)
    let pictureRight = 0, pictureBottom = 0
    const pictures = range ? sheet.images.filter(image => !image.placement).map(image => {
      const offset = (index: number, start: number, size: (i: number) => number) => {
        let value = 0
        for (let i = Math.min(index, start); i < Math.max(index, start); i++) value += size(i)
        return index < start ? -value : value
      }
      if (image.from.column > range.e.c || image.from.row > range.e.r ||
        image.from.column < 0 || image.from.row < 0) return ''
      const left = offset(image.from.column, range.s.c, c => columnWidth(sheet.worksheet, c)) + image.from.x
      const top = offset(image.from.row, range.s.r, r => rowHeight(sheet, r)) + image.from.y
      const width = image.to ? offset(image.to.column, image.from.column, c => columnWidth(sheet.worksheet, c)) + image.to.x - image.from.x : image.width
      const height = image.to ? offset(image.to.row, image.from.row, r => rowHeight(sheet, r)) + image.to.y - image.from.y : image.height
      if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || left + width <= 0 || top + height <= 0) return ''
      pictureRight = Math.max(pictureRight, left + width); pictureBottom = Math.max(pictureBottom, top + height)
      const [l, t, r, b] = image.crop, w = Math.max(.01, 1 - l - r), h = Math.max(.01, 1 - t - b)
      return `<div data-excel-picture style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;overflow:hidden;transform:rotate(${image.rotation}deg) scale(${image.flipX ? -1 : 1},${image.flipY ? -1 : 1});pointer-events:none"><img alt="${escapeHtml(image.alt)}" src="${image.src}" style="position:absolute;max-width:none;width:${100 / w}%;height:${100 / h}%;left:${-l * 100 / w}%;top:${-t * 100 / h}%"></div>`
    }).join('') : ''
    const band = (placement: 'header' | 'footer') => rowPage || columnPage ? '' : sheet.images.filter(image => image.placement === placement).map(image =>
      `<div style="text-align:${image.align};height:${image.height}px"><img alt="${escapeHtml(image.alt)}" src="${image.src}" style="width:${image.width}px;height:${image.height}px;max-width:100%;object-fit:contain"></div>`).join('')
    return shell(title, `<div data-document-preview-page style="zoom:${zoom / 100}">${band('header')}<div style="position:relative;min-width:${pictureRight}px;min-height:${pictureBottom}px">${content}${pictures}</div>${band('footer')}</div>` )
  }
  return { sheets, page }
}

function extend(range: Range | null, add: Range): Range {
  return range ? { s: { r: Math.min(range.s.r, add.s.r), c: Math.min(range.s.c, add.s.c) }, e: { r: Math.max(range.e.r, add.e.r), c: Math.max(range.e.c, add.e.c) } } : add
}

function rowHeight(sheet: { worksheet: WorkSheet; defaultRowHeight: number }, row: number) {
  const info = sheet.worksheet['!rows']?.[row]
  return info?.hidden ? 0 : info?.hpt !== undefined ? info.hpt * 96 / 72 : info?.hpx ?? sheet.defaultRowHeight
}

function columnWidth(sheet: WorkSheet, column: number) {
  const info = sheet['!cols']?.[column]
  return info?.hidden ? 0 : info?.wpx ?? (info?.wch ? info.wch * 7 + 5 : info?.width ? info.width * 7 : 64)
}

function cellCss(style: DocumentTemplatePreviewCellStyle) {
  const properties: Record<string, string | number | undefined> = {
    'background-color': style.backgroundColor, color: style.color,
    'font-family': style.fontFamily ? `'${style.fontFamily.replace(/[^\p{L}\p{N} ,_-]/gu, '')}',${/narrow/i.test(style.fontFamily) ? "'Arial Narrow'," : ''}${/times|cambria|georgia/i.test(style.fontFamily) ? 'serif' : 'Arial,sans-serif'}` : undefined,
    'font-size': style.fontSize ? `${style.fontSize}pt` : undefined,
    'font-weight': style.fontWeight, 'font-style': style.fontStyle,
    'text-decoration': style.textDecoration, 'text-align': style.textAlign,
    // Sheet view fits text to the available cells; the original Excel keeps its print rules.
    'vertical-align': style.verticalAlign, 'white-space': 'pre-wrap',
    'border-top': style.borderTop, 'border-right': style.borderRight,
    'border-bottom': style.borderBottom, 'border-left': style.borderLeft,
  }
  return Object.entries(properties).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}:${value}`).join(';')
}

function shell(title: string, content: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}html{scrollbar-gutter:stable}body{margin:0;padding:16px;background:#f1f5f9;color:#000;font:11pt Arial,sans-serif}table{table-layout:fixed;border-collapse:collapse;background:white}td{padding:1px 3px;overflow:hidden;vertical-align:bottom;overflow-wrap:break-word}.excel-overflow{display:block;position:relative;z-index:1;overflow:hidden}
    [data-document-preview-page]{position:relative;overflow:hidden;width:max-content;margin:0 auto;background:white;box-shadow:0 1px 5px #0f172a1a}[data-document-preview-page]>p{min-width:240px;margin:0;padding:16px}
    </style></head><body>${content}</body></html>`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
