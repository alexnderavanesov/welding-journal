import type * as XLSXTypes from 'xlsx'

import {
  type StoredDocumentTemplate,
  type TemplateUploadInfo,
  type DocumentTemplateReplacementMapping,
  type DocumentTemplateReplacementAnalysis,
  normalizeDocumentTemplateConstructorConfig,
  type DocumentTemplateConstructorConfig,
  type DocumentTemplateReplacementIssue,
} from '@/lib/document-template-model'
import { loadXlsx, decodeCellReference, encodeCellReference } from '@/lib/document-template-xlsx'
import { getTemplateCellText } from '@/lib/document-template-workbook'

export async function analyzeDocumentTemplateReplacement(
  currentTemplate: StoredDocumentTemplate,
  parsedTemplate: TemplateUploadInfo & { fileData: ArrayBuffer },
  mapping: DocumentTemplateReplacementMapping = {},
): Promise<DocumentTemplateReplacementAnalysis> {
  const currentConfig = currentTemplate.constructorConfig
    ? normalizeDocumentTemplateConstructorConfig(currentTemplate.constructorConfig)
    : undefined
  const bindingCount = currentConfig?.bindings.length ?? 0
  const candidateSheetNames = parsedTemplate.sheetNames ?? []

  if (!currentConfig) {
    return {
      status: 'compatible',
      candidateSheetNames,
      rowOffset: 0,
      columnOffset: 0,
      bindingCount: 0,
      retainedBindingCount: 0,
      issues: [],
    }
  }

  if (
    !['xlsx', 'xls'].includes(currentTemplate.fileType)
    || !['xlsx', 'xls'].includes(parsedTemplate.fileType)
  ) {
    return {
      status: 'incompatible',
      sourceSheetName: currentConfig.sheetName,
      candidateSheetNames,
      rowOffset: mapping.rowOffset ?? 0,
      columnOffset: mapping.columnOffset ?? 0,
      bindingCount,
      retainedBindingCount: 0,
      issues: [{
        code: 'sheet-missing',
        message: 'Настройки ячеек можно переносить только между Excel-шаблонами.',
      }],
    }
  }

  const [sourceWorkbook, targetWorkbook] = await Promise.all([
    readDocumentTemplateWorkbookStructure(currentTemplate.fileData),
    readDocumentTemplateWorkbookStructure(parsedTemplate.fileData),
  ])
  const sourceSheet = sourceWorkbook.sheets.get(currentConfig.sheetName)
  if (!sourceSheet) {
    return {
      status: 'incompatible',
      sourceSheetName: currentConfig.sheetName,
      candidateSheetNames: targetWorkbook.sheetNames,
      rowOffset: mapping.rowOffset ?? 0,
      columnOffset: mapping.columnOffset ?? 0,
      bindingCount,
      retainedBindingCount: 0,
      issues: [{
        code: 'sheet-missing',
        message: `Исходный лист «${currentConfig.sheetName}» не найден в сохраненном шаблоне.`,
      }],
    }
  }

  const targetSheetNames = mapping.sheetName
    ? [mapping.sheetName]
    : [
        ...(targetWorkbook.sheets.has(currentConfig.sheetName) ? [currentConfig.sheetName] : []),
        ...targetWorkbook.sheetNames.filter((sheetName) => sheetName !== currentConfig.sheetName),
      ]
  const hasExplicitMapping =
    mapping.sheetName !== undefined
    || mapping.rowOffset !== undefined
    || mapping.columnOffset !== undefined
  const candidates: Array<{
    sheet: DocumentTemplateSheetStructure
    rowOffset: number
    columnOffset: number
    support: number
  }> = []

  for (const targetSheetName of targetSheetNames) {
    const targetSheet = targetWorkbook.sheets.get(targetSheetName)
    if (!targetSheet) continue
    const offsets =
      mapping.rowOffset !== undefined || mapping.columnOffset !== undefined
        ? [{
            rowOffset: mapping.rowOffset ?? 0,
            columnOffset: mapping.columnOffset ?? 0,
            support: Number.MAX_SAFE_INTEGER,
          }]
        : inferDocumentTemplateOffsets(sourceSheet, targetSheet)
    for (const offset of offsets) {
      candidates.push({ sheet: targetSheet, ...offset })
    }
  }

  const evaluated = candidates.map((candidate) => ({
    ...candidate,
    result: validateDocumentTemplateTransfer(
      currentConfig,
      sourceSheet,
      candidate.sheet,
      candidate.rowOffset,
      candidate.columnOffset,
    ),
  }))
  const validCandidates = evaluated
    .filter((candidate) => candidate.result.issues.length === 0)
    .sort((left, right) => {
      const leftSameSheet = left.sheet.name === currentConfig.sheetName ? 1 : 0
      const rightSameSheet = right.sheet.name === currentConfig.sheetName ? 1 : 0
      return (
        rightSameSheet - leftSameSheet
        || right.support - left.support
        || Math.abs(left.rowOffset) + Math.abs(left.columnOffset)
          - Math.abs(right.rowOffset) - Math.abs(right.columnOffset)
      )
    })
  const validCandidate = validCandidates[0]

  if (validCandidate) {
    const equallyReliableCandidates = validCandidates.filter((candidate) => (
      candidate.sheet.name !== validCandidate.sheet.name
      || candidate.rowOffset !== validCandidate.rowOffset
      || candidate.columnOffset !== validCandidate.columnOffset
    ) && getDocumentTemplateCandidateRank(candidate, currentConfig.sheetName)
      === getDocumentTemplateCandidateRank(validCandidate, currentConfig.sheetName))
    if (!hasExplicitMapping && equallyReliableCandidates.length > 0) {
      return {
        status: 'incompatible',
        sourceSheetName: currentConfig.sheetName,
        targetSheetName: validCandidate.sheet.name,
        candidateSheetNames: targetWorkbook.sheetNames,
        rowOffset: validCandidate.rowOffset,
        columnOffset: validCandidate.columnOffset,
        bindingCount,
        retainedBindingCount: validCandidate.result.retainedBindingCount,
        issues: [{
          code: 'structure-ambiguous',
          message: 'Несколько листов или вариантов сдвига одинаково подходят для переноса. Выберите лист и подтвердите сдвиг вручную.',
        }],
      }
    }

    const sourceRowCount = sourceSheet.endRow - sourceSheet.startRow + 1
    const sourceColumnCount = sourceSheet.endColumn - sourceSheet.startColumn + 1
    const targetRowCount = validCandidate.sheet.endRow - validCandidate.sheet.startRow + 1
    const targetColumnCount = validCandidate.sheet.endColumn - validCandidate.sheet.startColumn + 1
    if (
      !hasExplicitMapping
      && validCandidate.support <= 1
      && (sourceRowCount !== targetRowCount || sourceColumnCount !== targetColumnCount)
    ) {
      return {
        status: 'incompatible',
        sourceSheetName: currentConfig.sheetName,
        targetSheetName: validCandidate.sheet.name,
        candidateSheetNames: targetWorkbook.sheetNames,
        rowOffset: validCandidate.rowOffset,
        columnOffset: validCandidate.columnOffset,
        bindingCount,
        retainedBindingCount: validCandidate.result.retainedBindingCount,
        issues: [{
          code: 'structure-ambiguous',
          message: 'Размер рабочей области Excel изменился, а надежные опорные подписи для автоматического сдвига не найдены. Подтвердите лист и сдвиг вручную.',
        }],
      }
    }

    const constructorConfig = shiftDocumentTemplateConstructorConfig(
      currentConfig,
      validCandidate.sheet.name,
      validCandidate.rowOffset,
      validCandidate.columnOffset,
    )
    const adjusted =
      validCandidate.sheet.name !== currentConfig.sheetName
      || validCandidate.rowOffset !== 0
      || validCandidate.columnOffset !== 0
    return {
      status: adjusted ? 'adjusted' : 'compatible',
      sourceSheetName: currentConfig.sheetName,
      targetSheetName: validCandidate.sheet.name,
      candidateSheetNames: targetWorkbook.sheetNames,
      rowOffset: validCandidate.rowOffset,
      columnOffset: validCandidate.columnOffset,
      bindingCount,
      retainedBindingCount: bindingCount,
      constructorConfig,
      issues: [],
    }
  }

  const bestInvalidCandidate = evaluated
    .sort((left, right) => (
      right.result.retainedBindingCount - left.result.retainedBindingCount
      || left.result.issues.length - right.result.issues.length
      || right.support - left.support
    ))[0]
  const fallbackSheetName =
    mapping.sheetName
    ?? (targetWorkbook.sheets.has(currentConfig.sheetName)
      ? currentConfig.sheetName
      : targetWorkbook.sheetNames[0])

  return {
    status: 'incompatible',
    sourceSheetName: currentConfig.sheetName,
    targetSheetName: bestInvalidCandidate?.sheet.name ?? fallbackSheetName,
    candidateSheetNames: targetWorkbook.sheetNames,
    rowOffset: bestInvalidCandidate?.rowOffset ?? mapping.rowOffset ?? 0,
    columnOffset: bestInvalidCandidate?.columnOffset ?? mapping.columnOffset ?? 0,
    bindingCount,
    retainedBindingCount: bestInvalidCandidate?.result.retainedBindingCount ?? 0,
    issues: bestInvalidCandidate?.result.issues ?? [{
      code: 'sheet-missing',
      message: 'В новом шаблоне не найден лист, на который можно перенести настройки конструктора.',
    }],
  }
}

function getDocumentTemplateCandidateRank(
  candidate: {
    sheet: DocumentTemplateSheetStructure
    rowOffset: number
    columnOffset: number
    support: number
  },
  sourceSheetName: string,
) {
  return [
    candidate.sheet.name === sourceSheetName ? 1 : 0,
    candidate.support,
    -(Math.abs(candidate.rowOffset) + Math.abs(candidate.columnOffset)),
  ].join(':')
}

type DocumentTemplateMergeRange = {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

type DocumentTemplateSheetStructure = {
  name: string
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
  merges: DocumentTemplateMergeRange[]
  anchors: Array<{
    row: number
    column: number
    value: string
  }>
}

type DocumentTemplateWorkbookStructure = {
  sheetNames: string[]
  sheets: Map<string, DocumentTemplateSheetStructure>
}

async function readDocumentTemplateWorkbookStructure(
  fileData: ArrayBuffer,
): Promise<DocumentTemplateWorkbookStructure> {
  const XLSX = await loadXlsx()
  const workbook = XLSX.read(fileData, { type: 'array', cellStyles: true })
  const sheets = new Map<string, DocumentTemplateSheetStructure>()

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) continue
    const range = worksheet['!ref']
      ? XLSX.utils.decode_range(worksheet['!ref'])
      : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }
    const merges = (worksheet['!merges'] ?? []).map((merge) => ({
      startRow: merge.s.r + 1,
      endRow: merge.e.r + 1,
      startColumn: merge.s.c + 1,
      endColumn: merge.e.c + 1,
    }))
    const anchors = Object.entries(worksheet).flatMap(([address, cell]) => {
      if (address.startsWith('!')) return []
      const reference = decodeCellReference(address)
      const value = normalizeDocumentTemplateAnchor(getTemplateCellText(cell as XLSXTypes.CellObject))
      return reference && value
        ? [{ row: reference.row, column: reference.column, value }]
        : []
    })
    sheets.set(sheetName, {
      name: sheetName,
      startRow: range.s.r + 1,
      endRow: range.e.r + 1,
      startColumn: range.s.c + 1,
      endColumn: range.e.c + 1,
      merges,
      anchors,
    })
  }

  return {
    sheetNames: [...workbook.SheetNames],
    sheets,
  }
}

function normalizeDocumentTemplateAnchor(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru')
}

function inferDocumentTemplateOffsets(
  sourceSheet: DocumentTemplateSheetStructure,
  targetSheet: DocumentTemplateSheetStructure,
) {
  const supportByOffset = new Map<string, {
    rowOffset: number
    columnOffset: number
    support: number
  }>()
  const addOffset = (rowOffset: number, columnOffset: number, support = 1) => {
    const key = `${rowOffset}:${columnOffset}`
    const current = supportByOffset.get(key)
    supportByOffset.set(key, {
      rowOffset,
      columnOffset,
      support: (current?.support ?? 0) + support,
    })
  }
  addOffset(0, 0, 1)

  const sourceAnchorsByValue = groupDocumentTemplateAnchors(sourceSheet.anchors)
  const targetAnchorsByValue = groupDocumentTemplateAnchors(targetSheet.anchors)
  for (const [value, sourceAnchors] of sourceAnchorsByValue) {
    const targetAnchors = targetAnchorsByValue.get(value)
    if (sourceAnchors.length !== 1 || targetAnchors?.length !== 1) continue
    addOffset(
      targetAnchors[0].row - sourceAnchors[0].row,
      targetAnchors[0].column - sourceAnchors[0].column,
      3,
    )
  }

  const sourceMergesByShape = groupDocumentTemplateMerges(sourceSheet.merges)
  const targetMergesByShape = groupDocumentTemplateMerges(targetSheet.merges)
  for (const [shape, sourceMerges] of sourceMergesByShape) {
    const targetMerges = targetMergesByShape.get(shape)
    if (sourceMerges.length !== 1 || targetMerges?.length !== 1) continue
    addOffset(
      targetMerges[0].startRow - sourceMerges[0].startRow,
      targetMerges[0].startColumn - sourceMerges[0].startColumn,
      2,
    )
  }

  return Array.from(supportByOffset.values())
    .sort((left, right) => (
      right.support - left.support
      || Math.abs(left.rowOffset) + Math.abs(left.columnOffset)
        - Math.abs(right.rowOffset) - Math.abs(right.columnOffset)
    ))
    .slice(0, 30)
}

function groupDocumentTemplateAnchors(
  anchors: DocumentTemplateSheetStructure['anchors'],
) {
  const grouped = new Map<string, DocumentTemplateSheetStructure['anchors']>()
  for (const anchor of anchors) {
    const values = grouped.get(anchor.value) ?? []
    values.push(anchor)
    grouped.set(anchor.value, values)
  }
  return grouped
}

function groupDocumentTemplateMerges(merges: DocumentTemplateMergeRange[]) {
  const grouped = new Map<string, DocumentTemplateMergeRange[]>()
  for (const merge of merges) {
    const shape = `${merge.endRow - merge.startRow + 1}:${merge.endColumn - merge.startColumn + 1}`
    const values = grouped.get(shape) ?? []
    values.push(merge)
    grouped.set(shape, values)
  }
  return grouped
}

function validateDocumentTemplateTransfer(
  config: DocumentTemplateConstructorConfig,
  sourceSheet: DocumentTemplateSheetStructure,
  targetSheet: DocumentTemplateSheetStructure,
  rowOffset: number,
  columnOffset: number,
) {
  const issues: DocumentTemplateReplacementIssue[] = []
  let retainedBindingCount = 0

  for (const binding of config.bindings) {
    const sourceReference = decodeCellReference(binding.cell)
    if (!sourceReference) {
      issues.push({
        code: 'cell-missing',
        message: `Не удалось прочитать адрес назначенной ячейки ${binding.cell}.`,
      })
      continue
    }
    const targetReference = {
      row: sourceReference.row + rowOffset,
      column: sourceReference.column + columnOffset,
    }
    const targetAddress =
      targetReference.row > 0 && targetReference.column > 0
        ? encodeCellReference(targetReference.row, targetReference.column)
        : binding.cell
    if (!isDocumentTemplateCellInsideSheet(targetSheet, targetReference.row, targetReference.column)) {
      issues.push({
        code: 'cell-missing',
        message: `Ячейка ${binding.cell} после переноса должна находиться в ${targetAddress}, но такой области в новом листе нет.`,
      })
      continue
    }

    const sourceMerge = findDocumentTemplateMerge(sourceSheet, sourceReference.row, sourceReference.column)
    const targetMerge = findDocumentTemplateMerge(targetSheet, targetReference.row, targetReference.column)
    if (!hasSameDocumentTemplateMergeShape(sourceMerge, targetMerge, sourceReference, targetReference)) {
      issues.push({
        code: 'cell-merge-changed',
        message: `У назначенной ячейки ${binding.cell} изменилась геометрия объединения в новом адресе ${targetAddress}.`,
      })
      continue
    }
    retainedBindingCount += 1
  }

  if (config.repeatRow) {
    const repeatStart = config.repeatRow + rowOffset
    const repeatEnd = (config.repeatRowEnd ?? config.repeatRow) + rowOffset
    if (
      repeatStart < targetSheet.startRow
      || repeatEnd > targetSheet.endRow
      || repeatStart <= 0
      || repeatEnd < repeatStart
    ) {
      issues.push({
        code: 'repeat-block-missing',
        message: `Повторяемый блок строк ${config.repeatRow}–${config.repeatRowEnd ?? config.repeatRow} не помещается в новом листе после переноса.`,
      })
    } else if (!hasSameDocumentTemplateRepeatMerges(
      sourceSheet,
      targetSheet,
      config.repeatRow,
      config.repeatRowEnd ?? config.repeatRow,
      rowOffset,
      columnOffset,
    )) {
      issues.push({
        code: 'repeat-block-merge-changed',
        message: 'В повторяемом блоке изменились объединенные ячейки. Автоматическое копирование строк требует проверки.',
      })
    }
  }

  return {
    retainedBindingCount,
    issues: deduplicateDocumentTemplateReplacementIssues(issues),
  }
}

function isDocumentTemplateCellInsideSheet(
  sheet: DocumentTemplateSheetStructure,
  row: number,
  column: number,
) {
  return (
    row >= sheet.startRow
    && row <= sheet.endRow
    && column >= sheet.startColumn
    && column <= sheet.endColumn
  )
}

function findDocumentTemplateMerge(
  sheet: DocumentTemplateSheetStructure,
  row: number,
  column: number,
) {
  return sheet.merges.find((merge) => (
    row >= merge.startRow
    && row <= merge.endRow
    && column >= merge.startColumn
    && column <= merge.endColumn
  ))
}

function hasSameDocumentTemplateMergeShape(
  sourceMerge: DocumentTemplateMergeRange | undefined,
  targetMerge: DocumentTemplateMergeRange | undefined,
  sourceReference: { row: number; column: number },
  targetReference: { row: number; column: number },
) {
  if (!sourceMerge && !targetMerge) return true
  if (!sourceMerge || !targetMerge) return false
  return (
    sourceReference.row === sourceMerge.startRow
    && sourceReference.column === sourceMerge.startColumn
    && targetReference.row === targetMerge.startRow
    && targetReference.column === targetMerge.startColumn
    && sourceMerge.endRow - sourceMerge.startRow === targetMerge.endRow - targetMerge.startRow
    && sourceMerge.endColumn - sourceMerge.startColumn === targetMerge.endColumn - targetMerge.startColumn
  )
}

function hasSameDocumentTemplateRepeatMerges(
  sourceSheet: DocumentTemplateSheetStructure,
  targetSheet: DocumentTemplateSheetStructure,
  repeatStart: number,
  repeatEnd: number,
  rowOffset: number,
  columnOffset: number,
) {
  const sourceMerges = sourceSheet.merges
    .filter((merge) => merge.endRow >= repeatStart && merge.startRow <= repeatEnd)
    .map((merge) => shiftDocumentTemplateMerge(merge, rowOffset, columnOffset))
  const targetStart = repeatStart + rowOffset
  const targetEnd = repeatEnd + rowOffset
  const targetMerges = targetSheet.merges.filter((merge) => (
    merge.endRow >= targetStart && merge.startRow <= targetEnd
  ))
  const toKey = (merge: DocumentTemplateMergeRange) =>
    `${merge.startRow}:${merge.startColumn}:${merge.endRow}:${merge.endColumn}`
  const sourceKeys = sourceMerges.map(toKey).sort()
  const targetKeys = targetMerges.map(toKey).sort()
  return (
    sourceKeys.length === targetKeys.length
    && sourceKeys.every((key, index) => key === targetKeys[index])
  )
}

function shiftDocumentTemplateMerge(
  merge: DocumentTemplateMergeRange,
  rowOffset: number,
  columnOffset: number,
): DocumentTemplateMergeRange {
  return {
    startRow: merge.startRow + rowOffset,
    endRow: merge.endRow + rowOffset,
    startColumn: merge.startColumn + columnOffset,
    endColumn: merge.endColumn + columnOffset,
  }
}

function shiftDocumentTemplateConstructorConfig(
  config: DocumentTemplateConstructorConfig,
  sheetName: string,
  rowOffset: number,
  columnOffset: number,
): DocumentTemplateConstructorConfig {
  return normalizeDocumentTemplateConstructorConfig({
    ...config,
    sheetName,
    repeatRow: config.repeatRow ? config.repeatRow + rowOffset : undefined,
    repeatRowEnd: config.repeatRowEnd ? config.repeatRowEnd + rowOffset : undefined,
    bindings: config.bindings.map((binding) => {
      const reference = decodeCellReference(binding.cell)
      if (!reference) return { ...binding }
      return {
        ...binding,
        cell: encodeCellReference(
          reference.row + rowOffset,
          reference.column + columnOffset,
        ),
      }
    }),
  })
}

function deduplicateDocumentTemplateReplacementIssues(
  issues: DocumentTemplateReplacementIssue[],
) {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
