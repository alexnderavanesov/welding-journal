import { getEditableReportImportLabel } from '@/lib/report-display-state'
import {
  parseCsv,
  parseEditableCsv,
  parseEditableWorkbook,
  parseWorkbook,
} from '@/lib/weld-import-export'
import { withOfficialJointStatus } from '@/lib/report-control-state'
import { prepareImportedWeldRecords } from '@/lib/weld-journal-mutation-updates'
import {
  getReportImportCheckedFieldKeys,
  getReportImportPreviewFields,
  stripIgnoredImportFields,
} from '@/lib/report-import-template'
import { getReportImportFieldKeys } from '@/lib/report-field-state'
import type { ActiveReport } from '@/lib/home-state'
import type { StampSelectOptionLike } from '@/lib/weld-journal-mutation-types'
import type { WeldField, WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export type ReportImportPreviewError = {
  rowNumber: number
  title: string
  message: string
}

export type ReportImportPreview = {
  fileName: string
  fields: WeldField[]
  records: WeldInput[]
  validRecords: WeldInput[]
  errors: ReportImportPreviewError[]
  skippedRows: number
}

type ReportImportPreviewValidationOptions = {
  activeReport: ActiveReport
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
}

type BuildReportImportPreviewOptions = {
  activeReport: ActiveReport
  file: File
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
}

export async function buildReportImportPreview({
  activeReport,
  file,
  weldFormStampSelectOptions,
  welderStamps,
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
  records: WeldInput[],
  { activeReport, weldFormStampSelectOptions, welderStamps }: ReportImportPreviewValidationOptions,
) {
  if (activeReport !== 'weldingJournal') {
    return { validRecords: records, errors: [] as ReportImportPreviewError[] }
  }

  const validRecords: WeldInput[] = []
  const errors: ReportImportPreviewError[] = []

  records.forEach((record, index) => {
    try {
      const prepared = prepareImportedWeldRecords({
        records: [{ ...withOfficialJointStatus(record) }],
        weldFormStampSelectOptions,
        welderStamps,
      })
      validRecords.push(prepared[0])
    } catch (error) {
      errors.push({
        rowNumber: index + 2,
        title: getRecordTitle(record),
        message: getImportErrorMessage(error),
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
