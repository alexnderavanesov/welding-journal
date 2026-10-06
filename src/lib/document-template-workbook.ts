import type * as XLSXTypes from 'xlsx'
import { formatBusinessDateTime } from '@/lib/business-date'
import type { WeldRow } from '@/lib/dispatcher-types'
import { FIELD_BY_LABEL, isVirtualWeldField, normalizeHeader, WELD_FIELDS, type WeldInput } from '@/lib/weld-fields'
import { formatControlAvailabilityForExport } from '@/lib/report-value-utils'
import { CONTROL_BASIS_SUMMARY_FIELD_KEY, formatControlBasisSummary } from '@/lib/control-assignment-basis'
import { getLnkDefectDescriptionDescriptor, getLnkDefectDescriptionDisplayValue } from '@/lib/lnk-defect-description'
import { PRE_HEAT_TREATMENT_DEFECT_DESCRIPTION_FIELD_KEYS } from '@/lib/pre-heat-treatment-report-fields'
import { formatExportDate, formatExportNumber } from '@/lib/weld-export-utils'
import {
  STAMP_NAME_TEMPLATE_FIELDS,
  getWelderNameForTemplateStamp,
  getWelderNamesForOfficialStamps,
  type TemplateStampNameFieldKey,
} from '@/lib/welder-stamp-names'
import { parseRkExposureDescription, type RkExposureLine } from '@/lib/rk-exposure'
import { isLayeredControlDocumentType } from '@/lib/generated-document-types'
import { getLayeredControlDocumentProfile } from '@/lib/layered-control-documents'
import { getSystemDocumentRowResult } from '@/lib/system-document-types'

import {
  type TemplateSystemField,
  type TemplateUploadInfo,
  getFileExtension,
  type TemplateMarkerLocation,
  type StoredDocumentTemplate,
  type WeldingJournalTemplateContext,
  normalizeDocumentTemplateConstructorConfig,
  type DocumentTemplateConstructorConfig,
  type DocumentTemplateCellBinding,
  getConstructorBindingParts,
  type DocumentTemplateFieldKey,
  type DocumentTemplateCellPart,
  type TemplateMarkerCell,
} from '@/lib/document-template-model'
import {
  loadXlsx,
  shiftWorksheetRows,
  copyWorksheetRow,
  copyWorksheetRowMerges,
  cloneCellStyle,
  enableAutoRowHeight,
  expandWorksheetRef,
  preserveTemplateWorkbookXml,
  getWorksheetCellRowRange,
  assertRepeatBlockMergesAreContained,
  snapshotWorksheetRowBlock,
  cloneTemplateRowCell,
  restoreWorksheetRowBlock,
  type WorksheetRowBlockSnapshot,
  XLSX,
} from '@/lib/document-template-xlsx'

const TEMPLATE_FIELD_ALIASES = new Map<string, keyof WeldInput | TemplateSystemField>([
  [normalizeTemplateFieldName('№'), '__index'],
  [normalizeTemplateFieldName('№ п/п'), '__index'],
  [normalizeTemplateFieldName('N'), '__index'],
  [normalizeTemplateFieldName('Номер'), '__index'],
  [normalizeTemplateFieldName('№ группы'), '__groupIndex'],
  [normalizeTemplateFieldName('№ блока'), '__groupIndex'],
  [normalizeTemplateFieldName('№ группы/блока'), '__groupIndex'],
  [normalizeTemplateFieldName('ФИО сварщика'), '__welderName'],
  [normalizeTemplateFieldName('Наименование системного документа'), '__systemDocumentTitle'],
  [normalizeTemplateFieldName('Дата системного документа'), '__systemDocumentDate'],
  [normalizeTemplateFieldName('№ системного документа'), '__systemDocumentNumber'],
  [normalizeTemplateFieldName('Номер системного документа'), '__systemDocumentNumber'],
  [normalizeTemplateFieldName('Виды контроля системного документа'), '__systemDocumentMethods'],
  [normalizeTemplateFieldName('Результат системного документа'), '__systemDocumentResult'],
])

for (const field of STAMP_NAME_TEMPLATE_FIELDS) {
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(`${field.label}ФИО сварщика`), `__welderName:${field.key}`)
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(`${field.label} ФИО сварщика`), `__welderName:${field.key}`)
}

for (const field of WELD_FIELDS) {
  if (
    isVirtualWeldField(field) &&
    field.key !== CONTROL_BASIS_SUMMARY_FIELD_KEY &&
    !PRE_HEAT_TREATMENT_DEFECT_DESCRIPTION_FIELD_KEYS.has(field.key)
  ) continue
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(field.label), field.key as keyof WeldInput)
}

for (const [label, field] of FIELD_BY_LABEL.entries()) {
  if (
    isVirtualWeldField(field) &&
    field.key !== CONTROL_BASIS_SUMMARY_FIELD_KEY &&
    !PRE_HEAT_TREATMENT_DEFECT_DESCRIPTION_FIELD_KEYS.has(field.key)
  ) continue
  TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName(label), field.key as keyof WeldInput)
}

TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName('Статус'), 'officiality')

TEMPLATE_FIELD_ALIASES.set(normalizeTemplateFieldName('status'), 'officiality')

export async function parseDocumentTemplateFile(file: File): Promise<TemplateUploadInfo & { fileData: ArrayBuffer }> {
  const extension = getFileExtension(file.name)
  if (!['xlsx', 'xls'].includes(extension)) {
    throw new Error('Поддерживаются только шаблоны Excel в форматах .xlsx и .xls.')
  }

  const fileData = await file.arrayBuffer()

  const XLSX = await loadXlsx()
  const workbook = XLSX.read(fileData, { type: 'array' })
  const fieldSet = new Set<string>()
  const locations: TemplateMarkerLocation[] = []

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    for (const markerCell of collectTemplateMarkerCells(sheet)) {
      markerCell.fields.forEach((field) => fieldSet.add(field))
      locations.push({
        sheet: sheetName,
        cell: markerCell.address,
        source: markerCell.source,
        fields: markerCell.fields,
      })
    }
  })

  const fields = Array.from(fieldSet).sort((left, right) => left.localeCompare(right, 'ru'))
  return {
    fileName: file.name,
    fileType: extension,
    fileSize: file.size,
    uploadedAt: formatBusinessDateTime(new Date()),
    sheetNames: [...workbook.SheetNames],
    fields,
    markerCount: locations.reduce((count, location) => count + location.fields.length, 0),
    locations,
    warnings: [],
    fileData,
  }
}

export async function downloadWeldingJournalFromTemplate(
  template: StoredDocumentTemplate,
  records: WeldInput[],
  periodFrom: string,
  periodTo: string,
  fileName?: string,
  context?: WeldingJournalTemplateContext,
) {
  const blob = await createWeldingJournalBlobFromTemplate(template, records, context)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileName || `Сварочный журнал ${periodFrom || 'all'}-${periodTo || 'all'}`}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function createWeldingJournalBlobFromTemplate(
  template: StoredDocumentTemplate,
  records: WeldInput[],
  context: WeldingJournalTemplateContext = {},
) {
  const XLSX = await loadXlsx()
  const workbook = XLSX.read(template.fileData, { type: 'array', cellStyles: true })
  const constructorConfig = template.constructorConfig
  const sheetName =
    constructorConfig?.sheetName && workbook.SheetNames.includes(constructorConfig.sheetName)
      ? constructorConfig.sheetName
      : workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) throw new Error('В шаблоне не найден выбранный лист.')

  if (constructorConfig?.bindings.length) {
    return createWeldingJournalBlobFromConstructor(
      template,
      workbook,
      worksheet,
      records,
      normalizeDocumentTemplateConstructorConfig(constructorConfig),
      context,
    )
  }

  if (isLayeredControlDocumentType(template.id)) {
    const templateLabel = getLayeredControlDocumentProfile(template.id).templateLabel
    throw new Error(
      `Шаблон «${templateLabel}» загружен, но конструктор заполнения не настроен. `
      + `Откройте «Настройки» → «Документы» → «Послойный НК» → «${templateLabel}» и назначьте поля ячейкам.`,
    )
  }

  const markerCells = collectTemplateMarkerCells(worksheet)
  if (!markerCells.length) throw new Error('В шаблоне не найдено строки с маркерами вида {{Поле}}.')

  const markerRow = getPrimaryMarkerRow(markerCells)
  const repeatedCells = markerCells.filter((cell) => cell.row === markerRow)
  if (!repeatedCells.length) throw new Error('Не удалось определить строку для заполнения сварочного журнала.')

  const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : { s: { r: markerRow, c: 0 }, e: { r: markerRow, c: 0 } }
  const extraRows = Math.max(records.length - 1, 0)
  if (extraRows > 0) shiftWorksheetRows(worksheet, markerRow + 1, extraRows)

  records.forEach((record, recordIndex) => {
    const targetRow = markerRow + recordIndex
    copyWorksheetRow(worksheet, markerRow, targetRow, range.s.c, range.e.c)
    copyWorksheetRowMerges(worksheet, markerRow, targetRow)

    for (const markerCell of repeatedCells) {
      const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: markerCell.column })
      const originalCell = worksheet[markerCell.address]
      const value = replaceTemplateMarkers(markerCell.source, record, recordIndex, context)
      worksheet[targetAddress] = {
        ...originalCell,
        t: typeof value === 'number' ? 'n' : 's',
        v: value,
        w: undefined,
        s: cloneCellStyle(originalCell?.s),
      }
    }
    enableAutoRowHeight(worksheet, targetRow)
  })

  expandWorksheetRef(worksheet, markerRow + Math.max(records.length - 1, 0), Math.max(range.e.c, ...repeatedCells.map((cell) => cell.column)))
  const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  const preservedWorkbookData = preserveTemplateWorkbookXml(template.fileData, workbookData, {
    markerRow,
    recordCount: records.length,
    sheetIndex: workbook.SheetNames.indexOf(sheetName),
  })
  return new Blob([preservedWorkbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

type ConstructorRepeatUnit = {
  record: WeldInput | null
  records: WeldInput[]
  recordIndex: number
  rkExposureLine?: RkExposureLine
}

function getConstructorRepeatUnits(
  records: WeldInput[],
  config: DocumentTemplateConstructorConfig,
): ConstructorRepeatUnit[] {
  if (config.repeatMode !== 'groups' || !config.repeatGroupBy) {
    const expandsRkExposures = config.bindings.some(
      (binding) => binding.mode === 'row' && bindingUsesRkExposureField(binding),
    )
    if (!expandsRkExposures) {
      return records.map((record, recordIndex) => ({ record, records: [record], recordIndex }))
    }
    return records.flatMap((record, recordIndex) => {
      const lines = parseRkExposureDescription(record.lnkDefectDescription)
      if (!lines.length) return [{ record, records: [record], recordIndex }]
      return lines.map((rkExposureLine) => ({ record, records: [record], recordIndex, rkExposureLine }))
    })
  }

  const groupingFields = getConstructorGroupingFields(config.repeatGroupBy)
  const groups = new Map<string, WeldInput[]>()
  for (const record of records) {
    const key = groupingFields
      .map((field) => normalizeConstructorGroupValue(record[field as keyof WeldInput]))
      .join('\u001f')
    const groupRecords = groups.get(key) ?? []
    groupRecords.push(record)
    groups.set(key, groupRecords)
  }

  return Array.from(groups.values()).map((groupRecords, recordIndex) => ({
    record: groupRecords[0] ?? null,
    records: groupRecords,
    recordIndex,
  }))
}

function bindingUsesRkExposureField(binding: DocumentTemplateCellBinding) {
  return getConstructorBindingParts(binding).some(
    (part) => part.field === '__rkExposureCoordinate' || part.field === '__rkExposureDescription',
  )
}

function getConstructorGroupingFields(field: DocumentTemplateFieldKey): DocumentTemplateFieldKey[] {
  if (field === 'projectTitle') return ['projectTitle']
  if (field === 'subtitleCode') return ['projectTitle', 'subtitleCode']
  if (field === 'line') return ['projectTitle', 'subtitleCode', 'line']
  return [field]
}

function normalizeConstructorGroupValue(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru')
}

async function createWeldingJournalBlobFromConstructor(
  template: StoredDocumentTemplate,
  workbook: XLSXTypes.WorkBook,
  worksheet: XLSXTypes.WorkSheet,
  records: WeldInput[],
  config: DocumentTemplateConstructorConfig,
  context: WeldingJournalTemplateContext,
) {
  const XLSX = await loadXlsx()
  const repeatRowStartIndex = config.repeatRow ? config.repeatRow - 1 : undefined
  const repeatRowEndIndex =
    repeatRowStartIndex === undefined
      ? undefined
      : Math.max(repeatRowStartIndex, (config.repeatRowEnd || config.repeatRow || 1) - 1)
  const repeatBlockHeight =
    repeatRowStartIndex === undefined || repeatRowEndIndex === undefined
      ? 1
      : repeatRowEndIndex - repeatRowStartIndex + 1
  const rowBindings = config.bindings.filter((binding) => binding.mode === 'row')
  const groupBindings = config.bindings.filter(
    (binding) => binding.mode === 'summary' && binding.scope === 'group',
  )
  const aggregateBindings = config.bindings.filter(
    (binding) => binding.mode === 'summary' && binding.scope !== 'group',
  )
  const repeatBindings = [...rowBindings, ...groupBindings]
  const repeatUnits = getConstructorRepeatUnits(records, config)

  if (repeatBindings.length && repeatRowStartIndex === undefined) {
    throw new Error('В конструкторе не выбран блок строк, который должен повторяться для каждого стыка.')
  }
  if (repeatRowStartIndex !== undefined && repeatRowEndIndex !== undefined) {
    for (const binding of repeatBindings) {
      const bindingRow = XLSX.utils.decode_cell(binding.cell).r
      if (bindingRow < repeatRowStartIndex || bindingRow > repeatRowEndIndex) {
        throw new Error(
          `Поле ${binding.cell} должно находиться в повторяемом блоке строк ${config.repeatRow}–${config.repeatRowEnd || config.repeatRow}.`,
        )
      }
    }
    for (const binding of aggregateBindings) {
      const bindingRange = getWorksheetCellRowRange(worksheet, binding.cell)
      const intersectsRepeatBlock =
        bindingRange.end >= repeatRowStartIndex && bindingRange.start <= repeatRowEndIndex
      if (intersectsRepeatBlock) {
        throw new Error(`Сводное поле ${binding.cell} должно находиться вне повторяемого блока строк.`)
      }
    }
  }
  if (groupBindings.length && config.repeatMode !== 'groups') {
    throw new Error('Данные текущей группы доступны только когда повторяемый блок настроен по группам.')
  }
  if (config.repeatMode === 'groups' && !config.repeatGroupBy) {
    throw new Error('Выберите поле, по которому должен группироваться повторяемый блок.')
  }
  const initialRange = worksheet['!ref']
    ? XLSX.utils.decode_range(worksheet['!ref'])
    : { s: { r: repeatRowStartIndex ?? 0, c: 0 }, e: { r: repeatRowEndIndex ?? 0, c: 0 } }

  for (const binding of aggregateBindings) {
    writeConstructorCell(
      worksheet,
      binding.cell,
      getConstructorAggregateValue(binding, records, context),
    )
  }

  if (repeatRowStartIndex !== undefined && repeatRowEndIndex !== undefined && repeatBindings.length) {
    assertRepeatBlockMergesAreContained(worksheet, repeatRowStartIndex, repeatRowEndIndex)
    const blockSnapshot = snapshotWorksheetRowBlock(
      worksheet,
      repeatRowStartIndex,
      repeatRowEndIndex,
      initialRange.s.c,
      initialRange.e.c,
    )
    const outputRecordCount = Math.max(repeatUnits.length, 1)
    const extraRows = Math.max(outputRecordCount - 1, 0) * repeatBlockHeight
    if (extraRows > 0) shiftWorksheetRows(worksheet, repeatRowEndIndex + 1, extraRows)

    const sourceCells = new Map(
      repeatBindings.map((binding) => {
        const sourceCell = worksheet[binding.cell]
        return [binding.cell, sourceCell ? cloneTemplateRowCell(sourceCell) : undefined] as const
      }),
    )

    const unitsToWrite = repeatUnits.length
      ? repeatUnits
      : [{ record: null, records: [], recordIndex: 0 }]
    unitsToWrite.forEach((unit, unitIndex) => {
      const targetBlockStart = repeatRowStartIndex + unitIndex * repeatBlockHeight
      restoreWorksheetRowBlock(worksheet, blockSnapshot, targetBlockStart)

      for (const binding of repeatBindings) {
        const decoded = XLSX.utils.decode_cell(binding.cell)
        const targetAddress = XLSX.utils.encode_cell({
          r: targetBlockStart + (decoded.r - repeatRowStartIndex),
          c: decoded.c,
        })
        const sourceCell = sourceCells.get(binding.cell)
        if (sourceCell) worksheet[targetAddress] = cloneTemplateRowCell(sourceCell)
        const value =
          binding.mode === 'row' && unit.record
            ? getConstructorRowValue(
                binding,
                unit.record,
                unit.recordIndex,
                context,
                unit.rkExposureLine,
              )
            : binding.mode === 'summary'
              ? getConstructorAggregateValue(binding, unit.records, context, unit.recordIndex)
              : applyConstructorEmptyValue('', binding)
        writeConstructorCell(worksheet, targetAddress, value)
      }
      for (let rowOffset = 0; rowOffset < repeatBlockHeight; rowOffset += 1) {
        enableAutoRowHeight(worksheet, targetBlockStart + rowOffset)
      }
    })
    if (repeatBlockHeight === 1) {
      mergeRepeatedRkExposureJointCells({
        worksheet,
        repeatBindings,
        units: unitsToWrite,
        repeatRowStartIndex,
        blockSnapshot,
      })
    }

    expandWorksheetRef(
      worksheet,
      repeatRowStartIndex + outputRecordCount * repeatBlockHeight - 1,
      initialRange.e.c,
    )
  }

  const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  const preservedWorkbookData =
    repeatRowStartIndex === undefined
      ? workbookData
      : preserveTemplateWorkbookXml(template.fileData, workbookData, {
          markerRow: repeatRowStartIndex,
          markerRowCount: repeatBlockHeight,
          recordCount: repeatUnits.length,
          sheetIndex: workbook.SheetNames.indexOf(config.sheetName),
        })
  return new Blob([preservedWorkbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function writeConstructorCell(worksheet: XLSXTypes.WorkSheet, address: string, value: string | number) {
  const originalCell = worksheet[address]
  const nextCell: XLSXTypes.CellObject = {
    ...originalCell,
    t: typeof value === 'number' ? 'n' : 's',
    v: value,
    w: undefined,
    s: cloneCellStyle(originalCell?.s),
  }
  delete nextCell.f
  delete nextCell.F
  delete nextCell.D
  delete nextCell.r
  delete nextCell.h
  worksheet[address] = nextCell
}

function mergeRepeatedRkExposureJointCells({
  worksheet,
  repeatBindings,
  units,
  repeatRowStartIndex,
  blockSnapshot,
}: {
  worksheet: XLSXTypes.WorkSheet
  repeatBindings: DocumentTemplateCellBinding[]
  units: ConstructorRepeatUnit[]
  repeatRowStartIndex: number
  blockSnapshot: WorksheetRowBlockSnapshot
}) {
  if (!units.some((unit) => unit.rkExposureLine)) return
  const exposureColumnRanges = repeatBindings
    .filter((binding) => binding.mode === 'row' && bindingUsesRkExposureField(binding))
    .map((binding) => {
      const column = XLSX.utils.decode_cell(binding.cell).c
      const sourceMerge = blockSnapshot.merges.find(
        (merge) => merge.s.r === 0 && merge.e.r === 0 && merge.s.c <= column && merge.e.c >= column,
      )
      return {
        startColumn: sourceMerge?.s.c ?? column,
        endColumn: sourceMerge?.e.c ?? column,
      }
    })

  const ordinaryCellRanges: Array<{ startColumn: number; endColumn: number }> = []
  const collectedRanges = new Set<string>()
  for (let column = blockSnapshot.startColumn; column <= blockSnapshot.endColumn; column += 1) {
    const sourceMerge = blockSnapshot.merges.find(
      (merge) => merge.s.r === 0 && merge.e.r === 0 && merge.s.c <= column && merge.e.c >= column,
    )
    const startColumn = sourceMerge?.s.c ?? column
    const endColumn = sourceMerge?.e.c ?? column
    const key = `${startColumn}:${endColumn}`
    if (collectedRanges.has(key)) continue
    collectedRanges.add(key)

    const containsExposureField = exposureColumnRanges.some(
      (range) => range.startColumn <= endColumn && range.endColumn >= startColumn,
    )
    if (!containsExposureField) ordinaryCellRanges.push({ startColumn, endColumn })
  }

  const recordRanges: Array<{ start: number; end: number }> = []
  let start = 0
  for (let index = 1; index <= units.length; index += 1) {
    if (index < units.length && units[index].recordIndex === units[start].recordIndex) continue
    if (index - start > 1) recordRanges.push({ start, end: index - 1 })
    start = index
  }

  for (const range of recordRanges) {
    const targetStartRow = repeatRowStartIndex + range.start
    const targetEndRow = repeatRowStartIndex + range.end
    for (const { startColumn, endColumn } of ordinaryCellRanges) {
      worksheet['!merges'] ??= []
      worksheet['!merges'] = worksheet['!merges'].filter((merge) => !(
        merge.s.r >= targetStartRow &&
        merge.e.r <= targetEndRow &&
        merge.s.c === startColumn &&
        merge.e.c === endColumn
      ))
      worksheet['!merges'].push({
        s: { r: targetStartRow, c: startColumn },
        e: { r: targetEndRow, c: endColumn },
      })
      for (let row = targetStartRow; row <= targetEndRow; row += 1) {
        for (let currentColumn = startColumn; currentColumn <= endColumn; currentColumn += 1) {
          if (row === targetStartRow && currentColumn === startColumn) continue
          clearMergedCellValue(worksheet, XLSX.utils.encode_cell({ r: row, c: currentColumn }))
        }
      }
    }
  }
}

function clearMergedCellValue(worksheet: XLSXTypes.WorkSheet, address: string) {
  const cell = worksheet[address]
  if (!cell) return
  delete cell.v
  delete cell.w
  delete cell.f
  delete cell.t
}

function getConstructorRowValue(
  binding: DocumentTemplateCellBinding,
  record: WeldInput,
  recordIndex: number,
  context: WeldingJournalTemplateContext,
  rkExposureLine?: RkExposureLine,
) {
  const parts = getConstructorBindingParts(binding)
  if (parts.length) {
    const singlePart = parts[0]
    if (
      parts.length === 1 &&
      !binding.uniqueParts &&
      !singlePart.prefix &&
      !singlePart.suffix &&
      !singlePart.lineBreakAfter
    ) {
      return applyConstructorEmptyValue(
        getConstructorPartValue(singlePart, record, recordIndex, context, rkExposureLine),
        binding,
      )
    }
    const seenValues = new Set<string>()
    const value = parts
      .map((part) => {
        const rawValue = getConstructorPartValue(part, record, recordIndex, context, rkExposureLine)
        const normalizedValue = String(rawValue ?? '').trim()
        if (!normalizedValue) return ''
        const uniqueKey = normalizedValue.toLocaleLowerCase('ru')
        if (binding.uniqueParts && seenValues.has(uniqueKey)) return ''
        seenValues.add(uniqueKey)
        return `${part.prefix ?? ''}${normalizedValue}${part.suffix ?? ''}${part.lineBreakAfter ? '\n' : ''}`
      })
      .join('')
      .replace(/\n+$/, '')
    return applyConstructorEmptyValue(value, binding)
  }
  if (!binding.field) return applyConstructorEmptyValue('', binding)
  const value = getTemplateFieldValueByKey(binding.field, record, recordIndex, context, rkExposureLine)
  return applyConstructorEmptyValue(value, binding)
}

function getConstructorAggregateValue(
  binding: DocumentTemplateCellBinding,
  records: WeldInput[],
  context: WeldingJournalTemplateContext,
  groupIndex?: number,
) {
  const separator = getConstructorListSeparator(binding)
  const parts = getConstructorBindingParts(binding)
  let singleNumericValue: number | undefined
  const value = parts
    .map((part) => {
      const values = records
        .map((record, recordIndex) => {
          const rawValue = getConstructorPartValue(
            part,
            record,
            recordIndex,
            context,
            undefined,
            groupIndex,
          )
          return { rawValue, text: String(rawValue ?? '').trim() }
        })
        .filter((entry) => Boolean(entry.text))
      const outputValues =
        binding.uniqueValues === false
          ? values
          : Array.from(
              new Map(values.map((entry) => [entry.text.toLocaleLowerCase('ru'), entry])).values(),
            )
      if (!outputValues.length) return ''
      if (
        parts.length === 1 &&
        outputValues.length === 1 &&
        typeof outputValues[0].rawValue === 'number' &&
        !part.prefix &&
        !part.suffix &&
        !part.lineBreakAfter
      ) {
        singleNumericValue = outputValues[0].rawValue
      }
      return `${part.prefix ?? ''}${outputValues.map((entry) => entry.text).join(separator)}${part.suffix ?? ''}${part.lineBreakAfter ? '\n' : ''}`
    })
    .join('')
    .replace(/\n+$/, '')
  if (singleNumericValue !== undefined) {
    return applyConstructorEmptyValue(singleNumericValue, binding)
  }
  return applyConstructorEmptyValue(value, binding)
}

function getConstructorListSeparator(binding: DocumentTemplateCellBinding) {
  if (binding.separator === 'newline') return '\n'
  if (binding.separator === 'custom') return binding.customSeparator || ', '
  return ', '
}

function applyConstructorEmptyValue(value: unknown, binding: DocumentTemplateCellBinding) {
  const hasValue = typeof value === 'number' || Boolean(String(value ?? '').trim())
  if (hasValue) {
    if (binding.filledMode === 'custom') return binding.filledText ?? ''
    return typeof value === 'number' ? value : String(value)
  }
  if (binding.emptyMode === 'np') return 'н/п'
  if (binding.emptyMode === 'custom') return binding.emptyText ?? ''
  return ''
}

function getConstructorPartValue(
  part: DocumentTemplateCellPart,
  record: WeldInput,
  recordIndex: number,
  context: WeldingJournalTemplateContext,
  rkExposureLine?: RkExposureLine,
  groupIndex?: number,
) {
  const primaryValue = getTemplateFieldValueByKey(
    part.field,
    record,
    recordIndex,
    context,
    rkExposureLine,
    groupIndex,
  )
  const hasNumericFormula = Boolean(part.numericOperation || part.multiplier?.trim())
  if (!hasNumericFormula) return primaryValue

  let result = parseConstructorNumericValue(primaryValue)
  if (part.numericOperation) {
    const compareValue = part.compareField
      ? parseConstructorNumericValue(
          getTemplateFieldValueByKey(
            part.compareField,
            record,
            recordIndex,
            context,
            rkExposureLine,
            groupIndex,
          ),
        )
      : undefined
    const values = [result, compareValue].filter((value): value is number => value !== undefined)
    if (!values.length) return ''
    result = part.numericOperation === 'min' ? Math.min(...values) : Math.max(...values)
  }

  if (result === undefined) return ''
  const multiplier = parseConstructorNumericValue(part.multiplier)
  if (part.multiplier?.trim() && multiplier === undefined) return ''
  if (multiplier !== undefined) result *= multiplier
  return roundConstructorNumericValue(result)
}

function parseConstructorNumericValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.')
  if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function roundConstructorNumericValue(value: number) {
  return Number(value.toFixed(12))
}

export function extractTemplateFields(source: string) {
  const fields: string[] = []
  const markerPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
  let marker: RegExpExecArray | null

  while ((marker = markerPattern.exec(source)) !== null) {
    const fieldName = parseTemplateMarkerToken(marker[1] ?? '').fieldName
    if (isKnownTemplateMarkerField(fieldName)) fields.push(fieldName)
  }

  return fields
}

export function isKnownTemplateMarkerField(fieldName: string) {
  return TEMPLATE_FIELD_ALIASES.has(normalizeTemplateFieldName(fieldName))
}

export function parseTemplateMarkerToken(token: string) {
  const normalized = normalizeHeader(token)
  const fallbackMatch = normalized.match(/^(.*?)\/\s*(?:"([^"]*)"|'([^']*)'|«([^»]*)»|“([^”]*)”)\s*$/)
  if (!fallbackMatch) return { fieldName: normalized, fallback: undefined }

  const fieldName = normalizeHeader(fallbackMatch[1])
  if (!fieldName) return { fieldName: normalized, fallback: undefined }

  return {
    fieldName,
    fallback: fallbackMatch[2] ?? fallbackMatch[3] ?? fallbackMatch[4] ?? fallbackMatch[5] ?? '',
  }
}

function collectTemplateMarkerCells(worksheet: XLSXTypes.WorkSheet) {
  if (!worksheet['!ref']) return []

  const range = XLSX.utils.decode_range(worksheet['!ref'])
  const markerCells: TemplateMarkerCell[] = []
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      const cell = worksheet[address]
      const rawValue = getTemplateCellText(cell)
      if (rawValue === undefined || rawValue === null) continue

      const source = String(rawValue)
      const fields = extractTemplateFields(source)
      if (!fields.length) continue

      markerCells.push({
        address,
        row,
        column,
        source,
        fields,
      })
    }
  }
  return markerCells
}

export function getTemplateCellText(cell: XLSXTypes.CellObject | undefined) {
  if (!cell) return undefined
  if (typeof cell.v === 'string') return cell.v
  return cell.w ?? cell.v
}

function getPrimaryMarkerRow(markerCells: TemplateMarkerCell[]) {
  const rowCounts = new Map<number, number>()
  for (const cell of markerCells) {
    rowCounts.set(cell.row, (rowCounts.get(cell.row) ?? 0) + cell.fields.length)
  }

  return Array.from(rowCounts.entries()).sort((left, right) => {
    const countDelta = right[1] - left[1]
    if (countDelta !== 0) return countDelta
    return right[0] - left[0]
  })[0][0]
}

function replaceTemplateMarkers(source: string, record: WeldInput, recordIndex: number, context: WeldingJournalTemplateContext) {
  const singleMarker = source.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/)
  if (singleMarker) return getTemplateFieldValue(singleMarker[1], record, recordIndex, context)

  return source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, fieldName: string) =>
    String(getTemplateFieldValue(fieldName, record, recordIndex, context) ?? ''),
  )
}

function getTemplateFieldValue(fieldName: string, record: WeldInput, recordIndex: number, context: WeldingJournalTemplateContext) {
  const marker = parseTemplateMarkerToken(fieldName)
  const mappedKey = TEMPLATE_FIELD_ALIASES.get(normalizeTemplateFieldName(marker.fieldName))
  if (!mappedKey) return ''
  return formatTemplateFieldValue(getTemplateFieldValueByKey(mappedKey, record, recordIndex, context), marker.fallback)
}

function getTemplateFieldValueByKey(
  mappedKey: DocumentTemplateFieldKey,
  record: WeldInput,
  recordIndex: number,
  context: WeldingJournalTemplateContext,
  rkExposureLine?: RkExposureLine,
  groupIndex?: number,
) {
  if (mappedKey === '__index') return recordIndex + 1
  if (mappedKey === '__groupIndex') return (groupIndex ?? recordIndex) + 1
  if (mappedKey === '__welderName') return getWelderNamesForOfficialStamps(record, context.welderStamps ?? [])
  if (mappedKey === '__systemDocumentTitle') return context.systemDocument?.title ?? ''
  if (mappedKey === '__systemDocumentDate') return formatExportDate(context.systemDocument?.date)
  if (mappedKey === '__systemDocumentNumber') return context.systemDocument?.number ?? ''
  if (mappedKey === '__systemDocumentMethods') return context.systemDocument?.methodCodes.join(', ') ?? ''
  if (mappedKey === '__systemDocumentResult') {
    return context.systemDocument
      ? getSystemDocumentRowResult(record, context.systemDocument)
      : ''
  }
  if (mappedKey === '__rkExposureCoordinate') {
    if (rkExposureLine) return rkExposureLine.coordinate
    return parseRkExposureDescription(record.lnkDefectDescription)
      .map((line) => line.coordinate)
      .join('\n')
  }
  if (mappedKey === '__rkExposureDescription') {
    if (rkExposureLine) return rkExposureLine.description
    return parseRkExposureDescription(record.lnkDefectDescription)
      .map((line) => line.description)
      .join('\n')
  }
  if (mappedKey === CONTROL_BASIS_SUMMARY_FIELD_KEY) return formatControlBasisSummary(record, 'all')
  if (isTemplateStampWelderNameField(mappedKey)) {
    return getWelderNameForTemplateStamp(
      record,
      mappedKey.replace('__welderName:', '') as TemplateStampNameFieldKey,
      context.welderStamps ?? [],
    )
  }

  const defectDescriptor = getLnkDefectDescriptionDescriptor(mappedKey as Parameters<typeof getLnkDefectDescriptionDescriptor>[0])
  if (
    defectDescriptor &&
    (defectDescriptor.stage === 'primary' || (record as WeldRow).preHeatTreatmentControls !== undefined)
  ) {
    return getLnkDefectDescriptionDisplayValue(record, defectDescriptor)
  }

  const field = WELD_FIELDS.find((candidate) => candidate.key === mappedKey)
  const value = record[mappedKey]
  if (field?.kind === 'date') return formatExportDate(value)
  if (field?.kind === 'number') return formatExportNumber(value)
  if (field?.kind === 'boolean') return formatControlAvailabilityForExport(value)
  return value
}

function formatTemplateFieldValue(value: unknown, fallback: string | undefined) {
  if (typeof value === 'number') return value
  return String(value ?? '').trim() ? value : fallback ?? ''
}

function isTemplateStampWelderNameField(value: keyof WeldInput | TemplateSystemField): value is `__welderName:${TemplateStampNameFieldKey}` {
  return typeof value === 'string' && value.startsWith('__welderName:')
}

function normalizeTemplateFieldName(value: string) {
  return normalizeHeader(value).replace(/[{}]/g, '').trim()
}
