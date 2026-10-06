import type * as XLSXTypes from 'xlsx'

type XlsxModule = typeof import('xlsx')

export let XLSX = null as unknown as XlsxModule

let xlsxModule: XlsxModule | null = null

let xlsxModulePromise: Promise<XlsxModule> | null = null

export async function loadXlsx() {
  if (xlsxModule) return xlsxModule
  xlsxModulePromise ??= import('xlsx').then((module) => {
    XLSX = module
    xlsxModule = module
    return module
  })
  return xlsxModulePromise
}

export function extractXmlCollection(xml: string, collectionName: string, itemName: string) {
  const collection = xml.match(new RegExp(`<${collectionName}\\b[^>]*>([\\s\\S]*?)<\\/${collectionName}>`))?.[1] ?? ''
  const items: string[] = []
  let cursor = 0

  while (cursor < collection.length) {
    const start = collection.indexOf(`<${itemName}`, cursor)
    if (start < 0) break
    const startTagEnd = collection.indexOf('>', start)
    if (startTagEnd < 0) break
    const startTag = collection.slice(start, startTagEnd + 1)
    if (/\/>\s*$/.test(startTag)) {
      items.push(startTag)
      cursor = startTagEnd + 1
      continue
    }

    const closingTag = `</${itemName}>`
    const end = collection.indexOf(closingTag, startTagEnd + 1)
    if (end < 0) break
    items.push(collection.slice(start, end + closingTag.length))
    cursor = end + closingTag.length
  }

  return items
}

export function expandWorksheetRef(worksheet: XLSXTypes.WorkSheet, maxRow: number, maxColumn: number) {
  const currentRange = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }
  currentRange.e.r = Math.max(currentRange.e.r, maxRow)
  currentRange.e.c = Math.max(currentRange.e.c, maxColumn)
  worksheet['!ref'] = XLSX.utils.encode_range(currentRange)
}

export function shiftWorksheetRows(worksheet: XLSXTypes.WorkSheet, startRow: number, offset: number) {
  if (offset <= 0 || !worksheet['!ref']) return

  const range = XLSX.utils.decode_range(worksheet['!ref'])
  for (let row = range.e.r; row >= startRow; row -= 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const sourceAddress = XLSX.utils.encode_cell({ r: row, c: column })
      const targetAddress = XLSX.utils.encode_cell({ r: row + offset, c: column })
      if (worksheet[sourceAddress]) {
        worksheet[targetAddress] = worksheet[sourceAddress]
        delete worksheet[sourceAddress]
      } else {
        delete worksheet[targetAddress]
      }
    }
  }

  if (worksheet['!rows']) {
    for (let row = worksheet['!rows'].length - 1; row >= startRow; row -= 1) {
      worksheet['!rows'][row + offset] = worksheet['!rows'][row]
      delete worksheet['!rows'][row]
    }
  }

  if (worksheet['!merges']) {
    worksheet['!merges'] = worksheet['!merges'].map((merge) => {
      const nextMerge = {
        s: { ...merge.s },
        e: { ...merge.e },
      }
      if (nextMerge.s.r >= startRow) nextMerge.s.r += offset
      if (nextMerge.e.r >= startRow) nextMerge.e.r += offset
      return nextMerge
    })
  }

  range.e.r += offset
  worksheet['!ref'] = XLSX.utils.encode_range(range)
}

export function copyWorksheetRow(worksheet: XLSXTypes.WorkSheet, sourceRow: number, targetRow: number, startColumn: number, endColumn: number) {
  for (let column = startColumn; column <= endColumn; column += 1) {
    const sourceAddress = XLSX.utils.encode_cell({ r: sourceRow, c: column })
    const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: column })
    const sourceCell = worksheet[sourceAddress]
    if (sourceCell) {
      worksheet[targetAddress] = cloneTemplateRowCell(sourceCell)
    } else {
      delete worksheet[targetAddress]
    }
  }

  if (worksheet['!rows']?.[sourceRow]) {
    worksheet['!rows'][targetRow] = { ...worksheet['!rows'][sourceRow] }
  }
}

export function copyWorksheetRowMerges(worksheet: XLSXTypes.WorkSheet, sourceRow: number, targetRow: number) {
  if (sourceRow === targetRow || !worksheet['!merges']) return

  const sourceMerges = worksheet['!merges'].filter((merge) => merge.s.r === sourceRow && merge.e.r === sourceRow)
  if (!sourceMerges.length) return

  const existingKeys = new Set(worksheet['!merges'].map((merge) => `${merge.s.r}:${merge.s.c}:${merge.e.r}:${merge.e.c}`))
  for (const merge of sourceMerges) {
    const nextMerge = {
      s: { r: targetRow, c: merge.s.c },
      e: { r: targetRow, c: merge.e.c },
    }
    const key = `${nextMerge.s.r}:${nextMerge.s.c}:${nextMerge.e.r}:${nextMerge.e.c}`
    if (!existingKeys.has(key)) worksheet['!merges'].push(nextMerge)
  }
}

export type WorksheetRowBlockSnapshot = {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  cells: Map<string, XLSXTypes.CellObject>
  rows: Map<number, XLSXTypes.RowInfo>
  merges: XLSXTypes.Range[]
}

export function assertRepeatBlockMergesAreContained(
  worksheet: XLSXTypes.WorkSheet,
  startRow: number,
  endRow: number,
) {
  const crossingMerge = (worksheet['!merges'] ?? []).find((merge) => {
    const intersectsBlock = merge.e.r >= startRow && merge.s.r <= endRow
    const containedInBlock = merge.s.r >= startRow && merge.e.r <= endRow
    return intersectsBlock && !containedInBlock
  })
  if (!crossingMerge) return
  throw new Error(
    `Объединение ${XLSX.utils.encode_range(crossingMerge)} пересекает границу повторяемого блока. Включите объединение целиком в блок строк.`,
  )
}

export function getWorksheetCellRowRange(worksheet: XLSXTypes.WorkSheet, address: string) {
  const cell = XLSX.utils.decode_cell(address)
  const containingMerge = (worksheet['!merges'] ?? []).find(
    (merge) =>
      cell.r >= merge.s.r &&
      cell.r <= merge.e.r &&
      cell.c >= merge.s.c &&
      cell.c <= merge.e.c,
  )
  return {
    start: containingMerge?.s.r ?? cell.r,
    end: containingMerge?.e.r ?? cell.r,
  }
}

export function snapshotWorksheetRowBlock(
  worksheet: XLSXTypes.WorkSheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
): WorksheetRowBlockSnapshot {
  const cells = new Map<string, XLSXTypes.CellObject>()
  const rows = new Map<number, XLSXTypes.RowInfo>()
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      const cell = worksheet[address]
      if (cell) cells.set(`${row - startRow}:${column}`, cloneTemplateRowCell(cell))
    }
    const rowInfo = worksheet['!rows']?.[row]
    if (rowInfo) rows.set(row - startRow, { ...rowInfo })
  }

  return {
    startRow,
    endRow,
    startColumn,
    endColumn,
    cells,
    rows,
    merges: (worksheet['!merges'] ?? [])
      .filter((merge) => merge.s.r >= startRow && merge.e.r <= endRow)
      .map((merge) => ({
        s: { r: merge.s.r - startRow, c: merge.s.c },
        e: { r: merge.e.r - startRow, c: merge.e.c },
      })),
  }
}

export function restoreWorksheetRowBlock(
  worksheet: XLSXTypes.WorkSheet,
  snapshot: WorksheetRowBlockSnapshot,
  targetStartRow: number,
) {
  const blockHeight = snapshot.endRow - snapshot.startRow + 1
  for (let rowOffset = 0; rowOffset < blockHeight; rowOffset += 1) {
    const targetRow = targetStartRow + rowOffset
    for (let column = snapshot.startColumn; column <= snapshot.endColumn; column += 1) {
      const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: column })
      const sourceCell = snapshot.cells.get(`${rowOffset}:${column}`)
      if (sourceCell) worksheet[targetAddress] = cloneTemplateRowCell(sourceCell)
      else delete worksheet[targetAddress]
    }
    const sourceRowInfo = snapshot.rows.get(rowOffset)
    if (sourceRowInfo) {
      worksheet['!rows'] ??= []
      worksheet['!rows'][targetRow] = { ...sourceRowInfo }
    } else if (worksheet['!rows']) {
      delete worksheet['!rows'][targetRow]
    }
  }

  worksheet['!merges'] ??= []
  const targetEndRow = targetStartRow + blockHeight - 1
  worksheet['!merges'] = worksheet['!merges'].filter(
    (merge) => merge.e.r < targetStartRow || merge.s.r > targetEndRow,
  )
  worksheet['!merges'].push(
    ...snapshot.merges.map((merge) => ({
      s: { r: targetStartRow + merge.s.r, c: merge.s.c },
      e: { r: targetStartRow + merge.e.r, c: merge.e.c },
    })),
  )
}

export function enableAutoRowHeight(worksheet: XLSXTypes.WorkSheet, row: number) {
  const rowInfo = worksheet['!rows']?.[row]
  if (!rowInfo) return

  delete rowInfo.hpt
  delete rowInfo.hpx
  delete (rowInfo as Record<string, unknown>).customHeight
  if (Object.keys(rowInfo).length === 0 && worksheet['!rows']) delete worksheet['!rows'][row]
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cloneCellStyle(style: unknown) {
  if (!isObjectRecord(style)) return {}
  return JSON.parse(JSON.stringify(style)) as Record<string, unknown>
}

export function cloneTemplateRowCell(sourceCell: XLSXTypes.CellObject) {
  const clonedCell = {
    ...sourceCell,
    s: cloneCellStyle(sourceCell.s),
  }

  if (hasCellStyle(sourceCell.s) && !hasCellContent(sourceCell)) {
    return {
      ...clonedCell,
      t: 's',
      v: '',
      w: undefined,
    } satisfies XLSXTypes.CellObject
  }

  return clonedCell
}

function hasCellStyle(style: unknown) {
  return isObjectRecord(style) && Object.keys(style).length > 0
}

function hasCellContent(cell: XLSXTypes.CellObject) {
  return cell.v !== undefined && cell.v !== null && String(cell.v) !== ''
}

type WorkbookXmlPreservationContext = {
  markerRow: number
  markerRowCount?: number
  recordCount: number
  sheetIndex: number
}

export function preserveTemplateWorkbookXml(
  templateData: ArrayBuffer,
  generatedData: ArrayBuffer,
  context: WorkbookXmlPreservationContext,
) {
  try {
    const templateCfb = XLSX.CFB.read(new Uint8Array(templateData), { type: 'array' })
    const generatedCfb = XLSX.CFB.read(new Uint8Array(generatedData), { type: 'array' })
    copyCfbFile(templateCfb, generatedCfb, 'xl/styles.xml')
    copyCfbFile(templateCfb, generatedCfb, 'xl/theme/theme1.xml')
    copyCfbDirectory(templateCfb, generatedCfb, 'xl/media/')
    copyCfbDirectory(templateCfb, generatedCfb, 'xl/drawings/')
    copyCfbDirectory(templateCfb, generatedCfb, 'xl/printerSettings/')
    mergePreservedPartContentTypes(templateCfb, generatedCfb, [
      'xl/media/',
      'xl/drawings/',
      'xl/printerSettings/',
    ])

    const templateSheetPath = getWorksheetPath(templateCfb, context.sheetIndex)
    const generatedSheetPath = getWorksheetPath(generatedCfb, context.sheetIndex)
    copyCfbFile(templateCfb, generatedCfb, getWorksheetRelationshipsPath(templateSheetPath))
    const templateSheetXml = readCfbText(templateCfb, templateSheetPath)
    const generatedSheetXml = readCfbText(generatedCfb, generatedSheetPath)
    if (templateSheetXml && generatedSheetXml) {
      const templateStylesXml = readCfbText(templateCfb, 'xl/styles.xml')
      const styleByCell = extractCellStyleMap(templateSheetXml)
      fillMissingMergedCellStyles(templateSheetXml, templateStylesXml, styleByCell)
      const styledSheetXml = applyTemplateCellStyles(generatedSheetXml, styleByCell, context)
      const wrappedWorkbook = ensureGeneratedMultilineCellWrapping(
        styledSheetXml,
        templateStylesXml,
        context,
      )
      const patchedSheetXml = preserveWorksheetPresentationElements(
        templateSheetXml,
        applyGeneratedRowAutoHeights(
          wrappedWorkbook.sheetXml,
          wrappedWorkbook.stylesXml,
          context,
        ),
      )
      if (wrappedWorkbook.stylesXml) writeCfbText(generatedCfb, 'xl/styles.xml', wrappedWorkbook.stylesXml)
      writeCfbText(generatedCfb, generatedSheetPath, patchedSheetXml)
      sanitizeGeneratedWorkbookDefinedNames(generatedCfb, patchedSheetXml, context.sheetIndex)
    }

    return XLSX.CFB.write(generatedCfb, { type: 'array', fileType: 'zip' }) as ArrayBuffer
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(
      `Не удалось сохранить исходное оформление Excel-шаблона${detail}. Документ не сформирован, чтобы не выдать файл с потерянными границами, объединениями или изображениями.`,
    )
  }
}

export type CfbContainer = {
  FullPaths: string[]
  FileIndex: Array<{ content: Uint8Array; size: number }>
}

function copyCfbFile(sourceCfb: CfbContainer, targetCfb: CfbContainer, path: string) {
  const sourceIndex = findCfbFileIndex(sourceCfb, path)
  const targetIndex = findCfbFileIndex(targetCfb, path)
  if (sourceIndex < 0) return
  const content = new Uint8Array(sourceCfb.FileIndex[sourceIndex].content)
  if (targetIndex < 0) {
    XLSX.CFB.utils.cfb_add(targetCfb as never, path.replace(/^\/+/, ''), content)
    return
  }
  targetCfb.FileIndex[targetIndex].content = content
  targetCfb.FileIndex[targetIndex].size = content.length
}

function copyCfbDirectory(sourceCfb: CfbContainer, targetCfb: CfbContainer, directory: string) {
  const normalizedDirectory = directory.replace(/^\/+/, '')
  for (const fullPath of sourceCfb.FullPaths) {
    const normalizedPath = fullPath.replace(/^Root Entry\//, '')
    if (normalizedPath.startsWith(normalizedDirectory) && !normalizedPath.endsWith('/')) {
      copyCfbFile(sourceCfb, targetCfb, normalizedPath)
    }
  }
}

function mergePreservedPartContentTypes(
  sourceCfb: CfbContainer,
  targetCfb: CfbContainer,
  preservedDirectories: string[],
) {
  const sourceXml = readCfbText(sourceCfb, '[Content_Types].xml')
  const targetXml = readCfbText(targetCfb, '[Content_Types].xml')
  if (!sourceXml || !targetXml) return

  const targetPaths = new Set(
    targetCfb.FullPaths.map((path) => path.replace(/^Root Entry\//, '').replace(/^\/+/, '')),
  )
  const preservedPaths = Array.from(targetPaths).filter((path) =>
    preservedDirectories.some((directory) => path.startsWith(directory)),
  )
  if (!preservedPaths.length) return

  const requiredExtensions = new Set(
    preservedPaths
      .map((path) => path.split('.').pop()?.toLowerCase())
      .filter((extension): extension is string => Boolean(extension)),
  )
  const additions: string[] = []
  const existingDefaults = new Map(
    (targetXml.match(/<Default\b[^>]*\/?>/g) ?? [])
      .map((tag) => {
        const attrs = parseXmlAttributes(tag)
        return [
          attrs.get('Extension')?.toLowerCase(),
          attrs.get('ContentType'),
        ] as const
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
  )
  const existingOverrides = new Set(
    (targetXml.match(/<Override\b[^>]*\/?>/g) ?? [])
      .map((tag) => parseXmlAttributes(tag).get('PartName')?.replace(/^\/+/, ''))
      .filter((path): path is string => Boolean(path)),
  )

  for (const tag of sourceXml.match(/<Default\b[^>]*\/?>/g) ?? []) {
    const attrs = parseXmlAttributes(tag)
    const extension = attrs.get('Extension')?.toLowerCase()
    const contentType = attrs.get('ContentType')
    if (!extension || !contentType || !requiredExtensions.has(extension)) continue
    const existingContentType = existingDefaults.get(extension)
    if (!existingContentType) {
      additions.push(tag)
      existingDefaults.set(extension, contentType)
      continue
    }
    if (existingContentType === contentType) continue

    for (const partName of preservedPaths.filter(
      (path) => path.split('.').pop()?.toLowerCase() === extension,
    )) {
      if (existingOverrides.has(partName)) continue
      additions.push(
        `<Override PartName="/${escapeXmlAttribute(partName)}" ContentType="${escapeXmlAttribute(contentType)}"/>`,
      )
      existingOverrides.add(partName)
    }
  }

  for (const tag of sourceXml.match(/<Override\b[^>]*\/?>/g) ?? []) {
    const partName = parseXmlAttributes(tag).get('PartName')?.replace(/^\/+/, '')
    if (
      !partName ||
      !targetPaths.has(partName) ||
      !preservedDirectories.some((directory) => partName.startsWith(directory)) ||
      existingOverrides.has(partName)
    ) {
      continue
    }
    additions.push(tag)
    existingOverrides.add(partName)
  }

  if (additions.length) {
    writeCfbText(
      targetCfb,
      '[Content_Types].xml',
      targetXml.replace(/<\/Types>$/, `${additions.join('')}</Types>`),
    )
  }
}

export function readCfbText(cfb: CfbContainer, path: string) {
  const index = findCfbFileIndex(cfb, path)
  if (index < 0) return ''
  return new TextDecoder().decode(cfb.FileIndex[index].content)
}

function writeCfbText(cfb: CfbContainer, path: string, value: string) {
  const index = findCfbFileIndex(cfb, path)
  if (index < 0) return
  cfb.FileIndex[index].content = new TextEncoder().encode(value)
  cfb.FileIndex[index].size = cfb.FileIndex[index].content.length
}

function findCfbFileIndex(cfb: CfbContainer, path: string) {
  const normalizedPath = path.replace(/^\/+/, '')
  return cfb.FullPaths.findIndex((fullPath) => fullPath.replace(/^Root Entry\//, '') === normalizedPath)
}

export function getWorksheetPath(cfb: CfbContainer, sheetIndex: number) {
  const worksheetPaths = cfb.FullPaths
    .map((fullPath) => fullPath.replace(/^Root Entry\//, ''))
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
  return worksheetPaths[Math.max(0, sheetIndex)] ?? worksheetPaths[0] ?? 'xl/worksheets/sheet1.xml'
}

function getWorksheetRelationshipsPath(worksheetPath: string) {
  const fileName = worksheetPath.split('/').pop() ?? 'sheet1.xml'
  return `xl/worksheets/_rels/${fileName}.rels`
}

const preservedGeneratedWorkbookNames = new Set([
  '_xlnm.Print_Area',
  '_xlnm.Print_Titles',
])

function sanitizeGeneratedWorkbookDefinedNames(
  generatedCfb: CfbContainer,
  generatedSheetXml: string,
  sheetIndex: number,
) {
  const workbookPath = 'xl/workbook.xml'
  const workbookXml = readCfbText(generatedCfb, workbookPath)
  const definedNamesMatch = workbookXml.match(/<definedNames\b[^>]*>[\s\S]*?<\/definedNames>/)
  if (!workbookXml || !definedNamesMatch) return

  const sheetTags = workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? []
  const sheetName = decodeXmlText(parseXmlAttributes(sheetTags[sheetIndex] ?? '').get('name') ?? '')
  const worksheetDimension = parseWorksheetDimension(generatedSheetXml)
  const keptNames = (definedNamesMatch[0].match(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/g) ?? [])
    .map((definedNameXml) =>
      sanitizeGeneratedWorkbookDefinedName(
        definedNameXml,
        sheetIndex,
        sheetName,
        worksheetDimension,
      ),
    )
    .filter((definedNameXml): definedNameXml is string => Boolean(definedNameXml))

  writeCfbText(
    generatedCfb,
    workbookPath,
    workbookXml.replace(definedNamesMatch[0], keptNames.length
      ? `<definedNames>${keptNames.join('')}</definedNames>`
      : ''),
  )
}

function sanitizeGeneratedWorkbookDefinedName(
  definedNameXml: string,
  generatedSheetIndex: number,
  generatedSheetName: string,
  worksheetDimension: string,
) {
  const openingTag = definedNameXml.match(/^<definedName\b[^>]*>/)?.[0] ?? ''
  const attrs = parseXmlAttributes(openingTag)
  const name = decodeXmlText(attrs.get('name') ?? '')
  const localSheetId = Number(attrs.get('localSheetId'))
  const formula = definedNameXml
    .replace(/^<definedName\b[^>]*>/, '')
    .replace(/<\/definedName>$/, '')

  if (
    !preservedGeneratedWorkbookNames.has(name) ||
    !Number.isInteger(localSheetId) ||
    /#REF!|\[\d+\]/i.test(formula)
  ) {
    return null
  }

  if (
    name !== '_xlnm.Print_Area' ||
    localSheetId !== generatedSheetIndex ||
    !generatedSheetName ||
    !worksheetDimension
  ) {
    return definedNameXml
  }

  const updatedFormula = updatePrintAreaFormula(
    decodeXmlText(formula),
    generatedSheetName,
    worksheetDimension,
  )
  return `${openingTag}${escapeXmlText(updatedFormula)}</definedName>`
}

function parseWorksheetDimension(sheetXml: string) {
  const dimensionTag = sheetXml.match(/<dimension\b[^>]*\/?>/)?.[0] ?? ''
  return parseXmlAttributes(dimensionTag).get('ref') ?? ''
}

function updatePrintAreaFormula(
  formula: string,
  sheetName: string,
  worksheetDimension: string,
) {
  const dimensionRange = worksheetDimension.match(/^([A-Z]+\d+):([A-Z]+\d+)$/i)
  const existingRange = formula.match(/!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i)
  if (!dimensionRange || !existingRange) return formula

  const dimensionEnd = decodeCellReference(dimensionRange[2])
  if (!dimensionEnd) return formula

  const startColumn = existingRange[1].toUpperCase()
  const startRow = Number(existingRange[2])
  const endColumn = existingRange[3].toUpperCase()
  const endRow = Math.max(Number(existingRange[4]), dimensionEnd.row)
  const quotedSheetName = `'${sheetName.replace(/'/g, "''")}'`
  return `${quotedSheetName}!$${startColumn}$${startRow}:$${endColumn}$${endRow}`
}

const worksheetPresentationElementOrder = [
  'printOptions',
  'pageMargins',
  'pageSetup',
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'customProperties',
  'cellWatches',
  'ignoredErrors',
  'smartTags',
  'drawing',
  'legacyDrawing',
  'legacyDrawingHF',
  'picture',
  'oleObjects',
  'controls',
  'webPublishItems',
  'tableParts',
  'extLst',
] as const

function preserveWorksheetPresentationElements(
  templateSheetXml: string,
  generatedSheetXml: string,
) {
  const templateElements = [
    ...extractWorksheetElements(templateSheetXml, [
      'printOptions',
      'pageMargins',
      'pageSetup',
      'headerFooter',
      'drawing',
      'legacyDrawing',
      'legacyDrawingHF',
    ]),
  ]
  if (!templateElements.length) return generatedSheetXml

  return templateElements.reduce((sheetXml, element) => {
    const existingPattern = createWorksheetElementPattern(element.name)
    if (existingPattern.test(sheetXml)) {
      return sheetXml.replace(existingPattern, element.xml)
    }
    return insertWorksheetElementInSchemaOrder(sheetXml, element.name, element.xml)
  }, generatedSheetXml)
}

function extractWorksheetElements(sheetXml: string, names: string[]) {
  return names.flatMap((name) => {
    const match = sheetXml.match(createWorksheetElementPattern(name))
    return match ? [{ name, xml: match[0] }] : []
  })
}

function createWorksheetElementPattern(name: string) {
  return new RegExp(`<(?:${name})\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/(?:${name})>)`)
}

function insertWorksheetElementInSchemaOrder(
  sheetXml: string,
  elementName: string,
  elementXml: string,
) {
  const elementIndex = worksheetPresentationElementOrder.indexOf(
    elementName as (typeof worksheetPresentationElementOrder)[number],
  )
  const laterElements =
    elementIndex >= 0 ? worksheetPresentationElementOrder.slice(elementIndex + 1) : []
  const insertionPattern = laterElements.length
    ? new RegExp(`<(?:${laterElements.join('|')})\\b`)
    : /<\/worksheet>$/
  const match = insertionPattern.exec(sheetXml)
  const insertionIndex = match?.index ?? sheetXml.lastIndexOf('</worksheet>')
  if (insertionIndex < 0) return sheetXml
  return `${sheetXml.slice(0, insertionIndex)}${elementXml}${sheetXml.slice(insertionIndex)}`
}

export function extractCellStyleMap(sheetXml: string) {
  const styleByCell = new Map<string, string>()
  for (const tag of sheetXml.match(/<c\b[^>]*>/g) ?? []) {
    const attrs = parseXmlAttributes(tag)
    const cellRef = attrs.get('r')
    const styleId = attrs.get('s')
    if (!cellRef || styleId === undefined) continue
    const decoded = decodeCellReference(cellRef)
    if (!decoded) continue
    styleByCell.set(`${decoded.row}:${decoded.column}`, styleId)
  }
  return styleByCell
}

function fillMissingMergedCellStyles(
  sheetXml: string,
  stylesXml: string,
  styleByCell: Map<string, string>,
) {
  const cellFormats = extractXmlCollection(stylesXml, 'cellXfs', 'xf')
  const borders = extractXmlCollection(stylesXml, 'borders', 'border')
  for (const tag of sheetXml.match(/<mergeCell\b[^>]*\/?>/g) ?? []) {
    const range = parseXmlAttributes(tag).get('ref')
    const [startRef, endRef] = range?.split(':') ?? []
    const start = startRef ? decodeCellReference(startRef) : null
    const end = endRef ? decodeCellReference(endRef) : null
    if (!start || !end) continue
    const anchorStyle = styleByCell.get(`${start.row}:${start.column}`)
    if (anchorStyle === undefined || !cellStyleHasVisibleBorder(anchorStyle, cellFormats, borders)) continue

    for (let row = start.row; row <= end.row; row += 1) {
      for (let column = start.column; column <= end.column; column += 1) {
        const key = `${row}:${column}`
        const currentStyle = styleByCell.get(key)
        if (
          currentStyle === undefined ||
          !cellStyleHasVisibleBorder(currentStyle, cellFormats, borders)
        ) {
          styleByCell.set(key, anchorStyle)
        }
      }
    }
  }
}

function cellStyleHasVisibleBorder(styleId: string, cellFormats: string[], borders: string[]) {
  const cellFormat = cellFormats[Number(styleId)] ?? ''
  const openingTag = cellFormat.match(/^<xf\b[^>]*\/?>/)?.[0]
  const borderId = Number(openingTag ? parseXmlAttributes(openingTag).get('borderId') ?? 0 : 0)
  const borderXml = Number.isFinite(borderId) ? borders[borderId] ?? '' : ''
  return /<(?:left|right|top|bottom)\b[^>]*\bstyle="[^"]+"/.test(borderXml)
}

function applyTemplateCellStyles(
  sheetXml: string,
  styleByCell: Map<string, string>,
  { markerRow, markerRowCount = 1, recordCount, sheetIndex }: WorkbookXmlPreservationContext,
) {
  const outputRecordCount = Math.max(recordCount, 1)
  const extraRows = Math.max(outputRecordCount - 1, 0) * markerRowCount
  const generatedStartRow = markerRow + 1
  const generatedEndRow = generatedStartRow + outputRecordCount * markerRowCount - 1

  const styledSheetXml = sheetXml.replace(/<c\b[^>]*>/g, (tag) => {
    const attrs = parseXmlAttributes(tag)
    const cellRef = attrs.get('r')
    if (!cellRef) return tag

    const decoded = decodeCellReference(cellRef)
    if (!decoded) return tag

    const sourceRow =
      decoded.row < generatedStartRow
        ? decoded.row
        : decoded.row <= generatedEndRow
          ? generatedStartRow + ((decoded.row - generatedStartRow) % markerRowCount)
          : decoded.row - extraRows
    const styleId = styleByCell.get(`${sourceRow}:${decoded.column}`)
    return styleId === undefined ? removeXmlAttribute(tag, 's') : setXmlAttribute(tag, 's', styleId)
  })

  return ensureTemplateStyledEmptyCells(styledSheetXml, styleByCell, {
    markerRow,
    markerRowCount,
    recordCount,
    sheetIndex,
  })
}

function ensureTemplateStyledEmptyCells(
  sheetXml: string,
  styleByCell: Map<string, string>,
  { markerRow, markerRowCount = 1, recordCount }: WorkbookXmlPreservationContext,
) {
  const outputRecordCount = Math.max(recordCount, 1)
  const extraRows = Math.max(outputRecordCount - 1, 0) * markerRowCount
  const generatedStartRow = markerRow + 1
  const generatedSourceEndRow = generatedStartRow + markerRowCount - 1
  const stylesByOutputRow = new Map<number, Map<number, string>>()

  for (const [key, styleId] of styleByCell.entries()) {
    const [sourceRow, column] = key.split(':').map(Number)
    if (!Number.isFinite(sourceRow) || !Number.isFinite(column)) continue
    const outputRows =
      sourceRow >= generatedStartRow && sourceRow <= generatedSourceEndRow
        ? Array.from(
            { length: outputRecordCount },
            (_, index) => sourceRow + index * markerRowCount,
          )
        : [sourceRow > generatedSourceEndRow ? sourceRow + extraRows : sourceRow]
    for (const outputRow of outputRows) {
      const rowStyles = stylesByOutputRow.get(outputRow) ?? new Map<number, string>()
      rowStyles.set(column, styleId)
      stylesByOutputRow.set(outputRow, rowStyles)
    }
  }

  if (!stylesByOutputRow.size) return sheetXml

  return sheetXml.replace(
    /(<sheetData\b[^>]*>)([\s\S]*?)(<\/sheetData>)/,
    (_sheetData, openingTag: string, innerXml: string, closingTag: string) => {
      const rows = new Map<number, string>()
      for (const rowXml of innerXml.match(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g) ?? []) {
        const rowOpeningTag = rowXml.match(/^<row\b[^>]*\/?>/)?.[0]
        const rowNumber = Number(rowOpeningTag ? parseXmlAttributes(rowOpeningTag).get('r') : 0)
        if (!Number.isFinite(rowNumber) || rowNumber <= 0) continue
        const styleByColumn = stylesByOutputRow.get(rowNumber)
        rows.set(
          rowNumber,
          styleByColumn?.size
            ? applyStylesToWorksheetRow(rowXml, rowNumber, styleByColumn)
            : rowXml,
        )
      }

      for (const [rowNumber, styleByColumn] of stylesByOutputRow.entries()) {
        if (rows.has(rowNumber)) continue
        rows.set(
          rowNumber,
          applyStylesToWorksheetRow(`<row r="${rowNumber}"/>`, rowNumber, styleByColumn),
        )
      }

      return `${openingTag}${Array.from(rows.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, rowXml]) => rowXml)
        .join('')}${closingTag}`
    },
  )
}

function applyStylesToWorksheetRow(
  rowXml: string,
  rowNumber: number,
  styleByColumn: Map<number, string>,
) {
  const rowOpeningTag = rowXml.match(/^<row\b[^>]*\/?>/)?.[0] ?? `<row r="${rowNumber}"/>`
  const cells = new Map<number, string>()

  for (const cellXml of rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
    const cellOpeningTag = cellXml.match(/^<c\b[^>]*\/?>/)?.[0]
    const cellRef = cellOpeningTag ? parseXmlAttributes(cellOpeningTag).get('r') : undefined
    const decoded = cellRef ? decodeCellReference(cellRef) : null
    if (!cellOpeningTag || !decoded) continue
    const styleId = styleByColumn.get(decoded.column)
    cells.set(
      decoded.column,
      styleId === undefined
        ? cellXml
        : cellXml.replace(cellOpeningTag, setXmlAttribute(cellOpeningTag, 's', styleId)),
    )
  }

  for (const [column, styleId] of styleByColumn.entries()) {
    if (!cells.has(column)) {
      cells.set(
        column,
        `<c r="${encodeCellReference(rowNumber, column)}" s="${escapeXmlAttribute(styleId)}"/>`,
      )
    }
  }

  const normalizedOpeningTag = rowOpeningTag.replace(/\/>$/, '>')
  const innerXml = /\/>$/.test(rowXml)
    ? ''
    : rowXml
        .replace(/^<row\b[^>]*>/, '')
        .replace(/<\/row>$/, '')
  const nonCellXml = innerXml.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g, '')
  return `${normalizedOpeningTag}${Array.from(cells.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, cellXml]) => cellXml)
    .join('')}${nonCellXml}</row>`
}

function ensureGeneratedMultilineCellWrapping(
  sheetXml: string,
  stylesXml: string,
  { markerRow, markerRowCount = 1, recordCount }: WorkbookXmlPreservationContext,
) {
  const generatedStartRow = markerRow + 1
  const generatedEndRow =
    generatedStartRow + Math.max(recordCount, 1) * markerRowCount - 1
  const cellFormats = extractXmlCollection(stylesXml, 'cellXfs', 'xf')
  if (!cellFormats.length) return { sheetXml, stylesXml }

  const wrappedStyleIds = new Map<number, number>()
  const nextFormats = [...cellFormats]
  const nextSheetXml = sheetXml.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g, (cellXml) => {
    const openingTag = cellXml.match(/^<c\b[^>]*>/)?.[0]
    if (!openingTag) return cellXml
    const attrs = parseXmlAttributes(openingTag)
    const cellRef = attrs.get('r')
    const decoded = cellRef ? decodeCellReference(cellRef) : null
    if (!decoded || decoded.row < generatedStartRow || decoded.row > generatedEndRow) return cellXml
    if (!extractWorksheetCellText(cellXml).includes('\n')) return cellXml

    const sourceStyleId = Number(attrs.get('s') ?? 0)
    if (!Number.isFinite(sourceStyleId) || !nextFormats[sourceStyleId]) return cellXml
    if (cellFormatWrapsText(nextFormats[sourceStyleId])) return cellXml

    let wrappedStyleId = wrappedStyleIds.get(sourceStyleId)
    if (wrappedStyleId === undefined) {
      wrappedStyleId = nextFormats.length
      wrappedStyleIds.set(sourceStyleId, wrappedStyleId)
      nextFormats.push(addWrapTextToCellFormat(nextFormats[sourceStyleId]))
    }
    return cellXml.replace(openingTag, setXmlAttribute(openingTag, 's', String(wrappedStyleId)))
  })

  if (!wrappedStyleIds.size) return { sheetXml: nextSheetXml, stylesXml }
  return {
    sheetXml: nextSheetXml,
    stylesXml: replaceCellFormats(stylesXml, nextFormats),
  }
}

function replaceCellFormats(stylesXml: string, cellFormats: string[]) {
  return stylesXml.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, (collectionXml) => {
    const openingTag = collectionXml.match(/^<cellXfs\b[^>]*>/)?.[0]
    if (!openingTag) return collectionXml
    return `${setXmlAttribute(openingTag, 'count', String(cellFormats.length))}${cellFormats.join('')}</cellXfs>`
  })
}

function addWrapTextToCellFormat(cellFormat: string) {
  const openingTag = cellFormat.match(/^<xf\b[^>]*\/?>/)?.[0]
  if (!openingTag) return cellFormat
  const alignedOpeningTag = setXmlAttribute(openingTag, 'applyAlignment', '1')
  const alignmentTag = cellFormat.match(/<alignment\b[^>]*\/?>/)?.[0]
  if (alignmentTag) {
    return cellFormat
      .replace(openingTag, alignedOpeningTag)
      .replace(alignmentTag, setXmlAttribute(alignmentTag, 'wrapText', '1'))
  }
  if (/\/>$/.test(alignedOpeningTag)) {
    return `${alignedOpeningTag.replace(/\/>$/, '>')}<alignment wrapText="1"/></xf>`
  }
  return cellFormat
    .replace(openingTag, alignedOpeningTag)
    .replace(/<\/xf>$/, '<alignment wrapText="1"/></xf>')
}

function cellFormatWrapsText(cellFormat: string) {
  const alignmentTag = cellFormat.match(/<alignment\b[^>]*\/?>/)?.[0]
  if (!alignmentTag) return false
  const wrapText = parseXmlAttributes(alignmentTag).get('wrapText')
  return wrapText === '1' || wrapText === 'true'
}

function applyGeneratedRowAutoHeights(
  sheetXml: string,
  stylesXml: string,
  { markerRow, markerRowCount = 1, recordCount }: WorkbookXmlPreservationContext,
) {
  const generatedStartRow = markerRow + 1
  const generatedEndRow =
    generatedStartRow + Math.max(recordCount, 1) * markerRowCount - 1
  const columnWidths = extractWorksheetColumnWidths(sheetXml)
  const mergeColumnSpans = extractWorksheetMergeColumnSpans(sheetXml)
  const cellFormats = extractXmlCollection(stylesXml, 'cellXfs', 'xf')
  const fonts = extractXmlCollection(stylesXml, 'fonts', 'font')

  return sheetXml.replace(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g, (rowXml) => {
    const openingTag = rowXml.match(/^<row\b[^>]*>/)?.[0]
    if (!openingTag) return rowXml
    const rowNumber = Number(parseXmlAttributes(openingTag).get('r'))
    if (!Number.isFinite(rowNumber) || rowNumber < generatedStartRow || rowNumber > generatedEndRow) return rowXml

    let requiredHeight = 0
    for (const cellXml of rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const cellOpeningTag = cellXml.match(/^<c\b[^>]*>/)?.[0]
      if (!cellOpeningTag) continue
      const attrs = parseXmlAttributes(cellOpeningTag)
      const cellRef = attrs.get('r')
      const decoded = cellRef ? decodeCellReference(cellRef) : null
      if (!decoded) continue
      const text = extractWorksheetCellText(cellXml)
      if (!text) continue
      const styleId = Number(attrs.get('s') ?? 0)
      const wrapsText = text.includes('\n') || cellFormatWrapsText(cellFormats[styleId] ?? '')
      if (!wrapsText) continue
      const columnSpan = mergeColumnSpans.get(cellRef ?? '') ?? 1
      const availableCharacters = Array.from(
        { length: columnSpan },
        (_, index) => columnWidths.get(decoded.column + index) ?? 12,
      ).reduce((total, width) => total + Math.max(width - 1, 1), 0)
      const lineCount = text.split('\n').reduce(
        (total, line) => total + Math.max(1, Math.ceil(Math.max(line.length, 1) / Math.max(availableCharacters, 1))),
        0,
      )
      const fontSize = getCellFormatFontSize(cellFormats[styleId] ?? '', fonts)
      const lineHeight = Math.max(fontSize * 1.25, 15)
      requiredHeight = Math.max(requiredHeight, lineCount * lineHeight + 3)
    }

    const clearedOpeningTag = removeXmlAttribute(removeXmlAttribute(openingTag, 'ht'), 'customHeight')
    if (requiredHeight <= 18) return rowXml.replace(openingTag, clearedOpeningTag)
    const existingHeight = Number(parseXmlAttributes(openingTag).get('ht') ?? 0)
    const calculatedHeight = Math.min(Math.max(requiredHeight, existingHeight, 18), 409)
    const fittedOpeningTag = setXmlAttribute(
      setXmlAttribute(clearedOpeningTag, 'ht', String(calculatedHeight)),
      'customHeight',
      '1',
    )
    return rowXml.replace(openingTag, fittedOpeningTag)
  })
}

function getCellFormatFontSize(cellFormat: string, fonts: string[]) {
  const openingTag = cellFormat.match(/^<xf\b[^>]*\/?>/)?.[0]
  const fontId = Number(openingTag ? parseXmlAttributes(openingTag).get('fontId') ?? 0 : 0)
  const fontXml = Number.isFinite(fontId) ? fonts[fontId] ?? '' : ''
  const sizeTag = fontXml.match(/<sz\b[^>]*\/?>/)?.[0]
  const size = Number(sizeTag ? parseXmlAttributes(sizeTag).get('val') : 0)
  return Number.isFinite(size) && size > 0 ? size : 11
}

function extractWorksheetColumnWidths(sheetXml: string) {
  const widths = new Map<number, number>()
  for (const tag of sheetXml.match(/<col\b[^>]*\/?>/g) ?? []) {
    const attrs = parseXmlAttributes(tag)
    const start = Number(attrs.get('min'))
    const end = Number(attrs.get('max'))
    const width = Number(attrs.get('width'))
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(width)) continue
    for (let column = start; column <= end; column += 1) widths.set(column, width)
  }
  return widths
}

function extractWorksheetMergeColumnSpans(sheetXml: string) {
  const spans = new Map<string, number>()
  for (const tag of sheetXml.match(/<mergeCell\b[^>]*\/?>/g) ?? []) {
    const range = parseXmlAttributes(tag).get('ref')
    const [startRef, endRef] = range?.split(':') ?? []
    const start = startRef ? decodeCellReference(startRef) : null
    const end = endRef ? decodeCellReference(endRef) : null
    if (!start || !end) continue
    spans.set(startRef, Math.max(end.column - start.column + 1, 1))
  }
  return spans
}

function extractWorksheetCellText(cellXml: string) {
  const value = cellXml.match(/<(?:v|t)\b[^>]*>([\s\S]*?)<\/(?:v|t)>/)?.[1] ?? ''
  return decodeXmlText(value)
}

function decodeXmlText(value: string) {
  return value
    .replace(/&#(?:10|x0*A);?/gi, '\n')
    .replace(/_x000A_/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\r\n?/g, '\n')
}

export function parseXmlAttributes(tag: string) {
  const attrs = new Map<string, string>()
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs.set(match[1], match[2])
  }
  return attrs
}

function setXmlAttribute(tag: string, name: string, value: string) {
  const escapedValue = escapeXmlAttribute(value)
  return new RegExp(`\\s${escapeRegExp(name)}="[^"]*"`).test(tag)
    ? tag.replace(new RegExp(`(\\s${escapeRegExp(name)}=")[^"]*(")`), `$1${escapedValue}$2`)
    : tag.replace(/\/?>$/, (ending) => ` ${name}="${escapedValue}"${ending}`)
}

function removeXmlAttribute(tag: string, name: string) {
  return tag.replace(new RegExp(`\\s${escapeRegExp(name)}="[^"]*"`, 'g'), '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeXmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeXmlText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function decodeCellReference(value: string) {
  const match = value.match(/^([A-Z]+)(\d+)$/i)
  if (!match) return null
  return {
    column: decodeColumnReference(match[1]),
    row: Number(match[2]),
  }
}

function decodeColumnReference(value: string) {
  return value
    .toUpperCase()
    .split('')
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0)
}

export function encodeCellReference(row: number, column: number) {
  return `${encodeColumnReference(column)}${row}`
}

function encodeColumnReference(column: number) {
  let value = ''
  let current = column
  while (current > 0) {
    const remainder = (current - 1) % 26
    value = String.fromCharCode(65 + remainder) + value
    current = Math.floor((current - 1) / 26)
  }
  return value
}
