import * as XLSX from 'xlsx'
import { getEditableReportImportLabel } from '@/lib/report-display-state'
import {
  emptyToNull,
  parseCell,
  parseCsv,
  parseEditableCsv,
  parseEditableWorkbook,
  parseWorkbook,
} from '@/lib/weld-import-export'
import { withOfficialJointStatus } from '@/lib/report-control-state'
import { prepareImportedWeldRecords } from '@/lib/weld-journal-mutation-updates'
import {
  MASS_FILL_ROW_ID_HEADER,
  REPLACE_DELETE_ROW_HEADER,
  getReportImportCheckedFieldKeys,
  getReportImportPreviewFields,
  isExistingRowsImportLockedField,
  isMassFillFieldLocked,
  isSystemImportField,
  stripIgnoredImportFields,
} from '@/lib/report-import-template'
import { getReportImportFieldKeys } from '@/lib/report-field-state'
import type { ActiveReport } from '@/lib/home-state'
import type { StampSelectOptionLike } from '@/lib/weld-journal-mutation-types'
import { FIELD_BY_KEY, FIELD_BY_LABEL, normalizeHeader, type WeldField, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export type ReportImportPreviewError = {
  rowNumber: number
  title: string
  message: string
  id?: number
  fieldKeys?: WeldFieldKey[]
}

export type ReportImportRecord = WeldInput & { id?: number; deleteRequested?: boolean }

export type ReportImportPreview = {
  fileName: string
  fields: WeldField[]
  records: ReportImportRecord[]
  validRecords: ReportImportRecord[]
  errors: ReportImportPreviewError[]
  skippedRows: number
}

type ReportImportPreviewValidationOptions = {
  activeReport: ActiveReport
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
}

type BuildReportImportPreviewOptions = {
  activeReport: ActiveReport
  file: File
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
}

type BuildReportMassFillPreviewOptions = BuildReportImportPreviewOptions & {
  rows: WeldRow[]
}

export async function buildReportImportPreview({
  activeReport,
  file,
  weldFormStampSelectOptions,
  welderStamps,
  welderStampSuspensions,
}: BuildReportImportPreviewOptions): Promise<ReportImportPreview> {
  const parsed = await parseReportImportFile(activeReport, file)
  const records = parsed.records.map((record) => stripIgnoredImportFields(record, activeReport))
  const fields = getReportImportPreviewFields(activeReport)

  if (activeReport !== 'weldingJournal') {
    return {
      fileName: file.name,
      fields,
      records,
      validRecords: records,
      errors: [],
      skippedRows: parsed.skippedRows,
    }
  }

  const { validRecords, errors } = validateReportImportRecords(records, {
    activeReport,
    weldFormStampSelectOptions,
    welderStamps,
    welderStampSuspensions,
  })

  return {
    fileName: file.name,
    fields,
    records,
    validRecords,
    errors,
    skippedRows: parsed.skippedRows,
  }
}

export async function buildReportMassFillPreview({
  activeReport,
  file,
  rows,
  weldFormStampSelectOptions,
  welderStamps,
  welderStampSuspensions,
}: BuildReportMassFillPreviewOptions): Promise<ReportImportPreview> {
  return buildExistingRowsImportPreview({
    mode: 'massFill',
    activeReport,
    file,
    rows,
    weldFormStampSelectOptions,
    welderStamps,
    welderStampSuspensions,
  })
}

export async function buildReportReplaceDataPreview({
  activeReport,
  file,
  rows,
  weldFormStampSelectOptions,
  welderStamps,
  welderStampSuspensions,
}: BuildReportMassFillPreviewOptions): Promise<ReportImportPreview> {
  return buildExistingRowsImportPreview({
    mode: 'replaceData',
    activeReport,
    file,
    rows,
    weldFormStampSelectOptions,
    welderStamps,
    welderStampSuspensions,
  })
}

async function buildExistingRowsImportPreview({
  mode,
  activeReport,
  file,
  rows,
  weldFormStampSelectOptions,
  welderStamps,
  welderStampSuspensions,
}: BuildReportMassFillPreviewOptions & { mode: 'massFill' | 'replaceData' }): Promise<ReportImportPreview> {
  if (activeReport !== 'weldingJournal') {
    throw new Error(mode === 'replaceData' ? 'Замена данных пока доступна только для сварочного журнала.' : 'Массовое заполнение пока доступно только для сварочного журнала.')
  }

  const parsed = await parseMassFillImportFile(file)
  const fieldsByColumn = mapMassFillHeadersToFields(parsed.headers)
  const fields = getExistingRowsPreviewFields(fieldsByColumn)
  const idColumnIndex = getMassFillIdColumnIndex(parsed.headers)
  const deleteColumnIndex = mode === 'replaceData' ? getReplaceDeleteColumnIndex(parsed.headers) : -1
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const records: ReportImportRecord[] = []
  const validRecords: ReportImportRecord[] = []
  const errors: ReportImportPreviewError[] = []
  let skippedRows = parsed.skippedRows

  parsed.dataRows.forEach((row, index) => {
    const rowNumber = index + 2
    if (isEmptyWorksheetRow(row)) return

    const id = parseMassFillRowId(row[idColumnIndex])
    const existingRow = id === null ? null : rowsById.get(id) ?? null
    if (!existingRow) {
      skippedRows += 1
      errors.push({
        rowNumber,
        title: 'Строка без найденной записи',
        message: 'В колонке ID записи нет существующего стыка. Скачайте свежий шаблон и повторите заполнение.',
      })
      return
    }

    if (mode === 'replaceData' && deleteColumnIndex !== -1 && isDeleteRequested(row[deleteColumnIndex])) {
      const deletedRecord = { ...existingRow, id: existingRow.id, deleteRequested: true } as ReportImportRecord
      records.push(deletedRecord)
      validRecords.push(deletedRecord)
      return
    }

    const updates: ReportImportRecord = { id: existingRow.id }
    fieldsByColumn.forEach((field, columnIndex) => {
      if (!field || isExistingRowsFieldLocked(mode, activeReport, field, existingRow)) return
      const value = parseCell(field, row[columnIndex])
      if (mode === 'massFill' && emptyToNull(value) === null) return
      if (mode === 'replaceData' && normalizePreviewValue(value) === normalizePreviewValue(existingRow[field.key as keyof WeldRow])) return
      updates[field.key] = value
    })

    const changedKeys = Object.keys(updates).filter((key) => key !== 'id')
    const candidate = { ...existingRow, ...updates } as ReportImportRecord
    if (changedKeys.length === 0) {
      skippedRows += 1
      return
    }

    records.push(candidate)
    const changedFieldKeys = getKnownFieldKeys(changedKeys)

    try {
      const prepared = prepareImportedWeldRecords({
        records: [{ ...candidate }],
        skipManualJointNameValidation: true,
        weldFormStampSelectOptions,
        welderStamps,
        welderStampSuspensions,
      })[0] as ReportImportRecord
      const preparedUpdates: ReportImportRecord = { id: existingRow.id }
      changedKeys.forEach((key) => {
        const field = FIELD_BY_KEY.get(key as WeldFieldKey)
        if (!field) return
        preparedUpdates[field.key] = prepared[field.key]
      })
      applyPreparedDerivedUpdates(preparedUpdates, prepared, existingRow, changedKeys)
      validRecords.push(preparedUpdates)
    } catch (error) {
      errors.push({
        rowNumber,
        title: getRecordTitle(existingRow),
        message: getImportErrorMessage(error),
        id: existingRow.id,
        fieldKeys: changedFieldKeys,
      })
    }
  })

  return {
    fileName: file.name,
    fields,
    records,
    validRecords,
    errors,
    skippedRows,
  }
}

function applyPreparedDerivedUpdates(
  updates: ReportImportRecord,
  prepared: ReportImportRecord,
  existingRow: WeldRow,
  changedKeys: string[],
) {
  const changedKeySet = new Set(changedKeys)
  const wdiInputTouched = ['d1', 'd2', 't1', 't2', 'wdi'].some((key) => changedKeySet.has(key))
  if (wdiInputTouched && normalizePreviewValue(prepared.wdi) !== normalizePreviewValue(existingRow.wdi)) {
    updates.wdi = prepared.wdi
  }
}

function isExistingRowsFieldLocked(mode: 'massFill' | 'replaceData', activeReport: ActiveReport, field: WeldField, existingRow: WeldRow) {
  if (isExistingRowsImportLockedField(field)) return true
  if (mode === 'replaceData') return isSystemImportField(activeReport, field)
  return isMassFillFieldLocked(activeReport, field, existingRow)
}

function getExistingRowsPreviewFields(fieldsByColumn: Array<WeldField | null>) {
  const seen = new Set<string>()
  return fieldsByColumn.filter((field): field is WeldField => {
    if (!field || seen.has(field.key)) return false
    seen.add(field.key)
    return true
  })
}

export function fixReportImportPreviewErrors(
  preview: ReportImportPreview,
  options: ReportImportPreviewValidationOptions,
): ReportImportPreview {
  if (preview.errors.length === 0) return preview

  const errorRowNumbers = new Set(preview.errors.map((error) => error.rowNumber))
  const fixedRecords = preview.records.map((record, index) => {
    const rowNumber = index + 2
    if (!errorRowNumbers.has(rowNumber)) return record
    return fixImportRecordCheckedCells(record, options)
  })
  const { validRecords, errors } = validateReportImportRecords(fixedRecords, options)

  return {
    ...preview,
    records: fixedRecords,
    validRecords,
    errors,
  }
}

function validateReportImportRecords(
  records: ReportImportRecord[],
  { activeReport, weldFormStampSelectOptions, welderStamps, welderStampSuspensions }: ReportImportPreviewValidationOptions,
) {
  if (activeReport !== 'weldingJournal') {
    return { validRecords: records, errors: [] as ReportImportPreviewError[] }
  }

  const validRecords: ReportImportRecord[] = []
  const errors: ReportImportPreviewError[] = []

  records.forEach((record, index) => {
    try {
      const prepared = prepareImportedWeldRecords({
        records: [{ ...withOfficialJointStatus(record) }],
        weldFormStampSelectOptions,
        welderStamps,
        welderStampSuspensions,
      })
      validRecords.push({ ...prepared[0], id: record.id })
    } catch (error) {
      errors.push({
        rowNumber: index + 2,
        title: getRecordTitle(record),
        message: getImportErrorMessage(error),
        id: record.id,
        fieldKeys: getRecordErrorFieldKeys(record, activeReport),
      })
    }
  })

  return { validRecords, errors }
}

function fixImportRecordCheckedCells(record: WeldInput, options: ReportImportPreviewValidationOptions) {
  const checkedFieldKeys = [...getReportImportCheckedFieldKeys(options.activeReport)] as WeldFieldKey[]
  const clearableFieldKeys = checkedFieldKeys.filter((fieldKey) => fieldKey !== 'joint')

  for (const fieldKey of clearableFieldKeys) {
    const candidate = clearImportRecordFields(record, [fieldKey])
    if (validateReportImportRecords([candidate], options).errors.length === 0) return candidate
  }

  const candidate = clearImportRecordFields(record, clearableFieldKeys)
  return validateReportImportRecords([candidate], options).errors.length === 0 ? candidate : record
}

function clearImportRecordFields(record: WeldInput, fieldKeys: readonly WeldFieldKey[]) {
  const nextRecord = { ...record }
  for (const fieldKey of fieldKeys) {
    nextRecord[fieldKey] = null
  }
  return nextRecord
}

function getKnownFieldKeys(keys: readonly string[]) {
  return keys.filter((key): key is WeldFieldKey => FIELD_BY_KEY.has(key as WeldFieldKey))
}

function getRecordErrorFieldKeys(record: WeldInput, activeReport: ActiveReport) {
  const checkedFieldKeys = [...getReportImportCheckedFieldKeys(activeReport)] as WeldFieldKey[]
  const filledCheckedKeys = checkedFieldKeys.filter((fieldKey) => emptyToNull(record[fieldKey]) !== null)
  return filledCheckedKeys.length ? filledCheckedKeys : checkedFieldKeys
}

async function parseReportImportFile(activeReport: ActiveReport, file: File) {
  if (activeReport === 'heatTreatment' || activeReport === 'lnk') {
    const options = getReportImportFieldKeys(activeReport)
    if (!options) {
      throw new Error(`Для отчета ${getEditableReportImportLabel(activeReport)} импорт не настроен.`)
    }
    return file.name.toLowerCase().endsWith('.csv')
      ? parseEditableCsv(await file.text(), options)
      : parseEditableWorkbook(await file.arrayBuffer(), options)
  }

  return file.name.toLowerCase().endsWith('.csv')
    ? parseCsv(await file.text())
    : parseWorkbook(await file.arrayBuffer())
}

async function parseMassFillImportFile(file: File) {
  const rows = file.name.toLowerCase().endsWith('.csv')
    ? readFirstSheetRows(await file.text(), 'string')
    : readFirstSheetRows(await file.arrayBuffer(), 'array')
  const [rawHeaders = [], ...dataRows] = rows
  const headers = rawHeaders.map((header) => normalizeHeader(header))

  if (!headers.includes(MASS_FILL_ROW_ID_HEADER)) {
    throw new Error(`В шаблоне массового заполнения не найдена колонка "${MASS_FILL_ROW_ID_HEADER}".`)
  }

  return {
    headers,
    dataRows,
    skippedRows: dataRows.filter(isEmptyWorksheetRow).length,
  }
}

function readFirstSheetRows(data: ArrayBuffer | string, type: 'array' | 'string') {
  const workbook = XLSX.read(data, { type, raw: true, cellDates: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: true, defval: null })
}

function mapMassFillHeadersToFields(headers: readonly string[]) {
  return headers.map((header) => {
    if (header === MASS_FILL_ROW_ID_HEADER || header === REPLACE_DELETE_ROW_HEADER) return null
    return FIELD_BY_LABEL.get(normalizeHeader(header)) ?? null
  })
}

function getMassFillIdColumnIndex(headers: readonly string[]) {
  return headers.findIndex((header) => header === MASS_FILL_ROW_ID_HEADER)
}

function getReplaceDeleteColumnIndex(headers: readonly string[]) {
  return headers.findIndex((header) => header === REPLACE_DELETE_ROW_HEADER)
}

function parseMassFillRowId(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return null
  const id = Number(normalized)
  return Number.isInteger(id) && id > 0 ? id : null
}

function isDeleteRequested(value: unknown) {
  const normalized = emptyToNull(value)
  if (normalized === null) return false
  const text = String(normalized).trim().toLowerCase()
  return ['да', 'yes', 'true', '1', '+', 'удалить'].includes(text)
}

function isEmptyWorksheetRow(row: readonly unknown[]) {
  return row.every((value) => emptyToNull(value) === null)
}

function normalizePreviewValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' ? value.trim() : value
}

function getRecordTitle(record: WeldInput) {
  const line = String(record.line ?? '').trim()
  const joint = String(record.joint ?? '').trim()
  if (line && joint) return `${line} · ${joint}`
  return joint || line || 'Строка без номера стыка'
}

function getImportErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.replace(/^Импорт остановлен:\s*/i, '').trim()
  }
  return 'Не удалось проверить строку импорта.'
}
