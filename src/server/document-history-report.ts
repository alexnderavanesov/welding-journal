import { sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import type { DocumentHistoryReportRequest } from '@/lib/document-history-report'
import type { PrintableReport } from '@/lib/printable-report'
import { REPORT_PREVIEW_ROW_LIMIT } from '@/lib/report-preview-limit'
import { escapeXml } from '@/lib/weld-export-utils'
import { isGeneratedDocumentType } from '@/lib/generated-document-types'
import { isSystemDocumentType } from '@/lib/system-document-types'
import { normalizeGeneratedDocumentHistoryGridRequest, prepareGeneratedDocumentHistoryOutput } from './generated-documents'
import { normalizeSystemDocumentHistoryGridRequest } from './system-documents'
import { prepareSystemDocumentHistoryOutput } from './system-document-index'
import { createTabularExcelResponse } from './report-excel-file'
import { requirePermission } from './access-context'

export function normalizeDocumentHistoryReportRequest(input: DocumentHistoryReportRequest) {
  if (!input || typeof input !== 'object' || !input.source || !['generated', 'system'].includes(input.source.kind)
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200
    || !Array.isArray(input.columns) || !input.columns.length || input.columns.length > 13
    || input.columns.some(column => !column || typeof column.key !== 'string' || typeof column.label !== 'string' || !column.label.trim() || column.label.length > 200)
    || new Set(input.columns.map(column => column.key)).size !== input.columns.length) throw new Error('Некорректные параметры списка документов.')
  const source = input.source
  if (source.kind === 'generated' ? !Array.isArray(source.types) || !source.types.length || source.types.some(type => !isGeneratedDocumentType(type))
    : !isSystemDocumentType(source.type)) throw new Error('Неизвестный вид документов.')
  const query = { startRow: 0, endRow: 500, rowGroupCols: input.rowGroupCols, groupKeys: [], sortModel: input.sortModel,
    search: input.search, cells: { columns: input.columns.map(column => column.key) } }
  const request = source.kind === 'generated' ? normalizeGeneratedDocumentHistoryGridRequest({ ...query, ...source })
    : normalizeSystemDocumentHistoryGridRequest({ ...query, ...source })
  return { input, request }
}

/** One cursor/snapshot for the full list. No browser workbook or repeated OFFSET scans. */
export async function visitDocumentHistoryReport(input: DocumentHistoryReportRequest, consume: (rows: Array<Array<string | number>>) => Promise<boolean | void>, signal?: AbortSignal) {
  await requirePermission('documents.view'); await requirePermission('documents.export')
  const normalized = normalizeDocumentHistoryReportRequest(input)
  signal?.throwIfAborted()
  // Initialize legacy indexes in a short transaction. Never hold their write
  // lock while a potentially large report is being read/compressed.
  const systemSource = input.source.kind === 'system' ? await requireDb().transaction(tx =>
    prepareSystemDocumentHistoryOutput(tx, normalized.request as ReturnType<typeof normalizeSystemDocumentHistoryGridRequest>)) : null
  return requireDb().transaction(async tx => {
    const source = systemSource ?? await prepareGeneratedDocumentHistoryOutput(tx, normalized.request as ReturnType<typeof normalizeGeneratedDocumentHistoryGridRequest>)
    const time = await tx.execute<{ time: string }>(sql`select transaction_timestamp()::text as time`)
    await tx.execute(sql`declare document_history_output no scroll cursor for ${source.query}`)
    let total = 0
    try {
      for (;;) {
        signal?.throwIfAborted()
        const batch = await tx.execute<Record<string, unknown>>(sql`fetch forward 1000 from document_history_output`)
        if (!batch.rows.length) break
        total = Number(batch.rows[0].__outputTotal)
        const rows = batch.rows.map(raw => source.cells(input.columns.map(column => column.key), raw).map((value, index) =>
          input.columns[index].key === 'wdi' ? Number(String(value).replace(/\s/g, '').replace(',', '.')) : value))
        signal?.throwIfAborted()
        if (await consume(rows) === false) break
      }
    } finally { await tx.execute(sql`close document_history_output`) }
    return { total, generatedAt: new Date(time.rows[0].time).toISOString() }
  }, { isolationLevel: 'repeatable read' })
}

export async function readDocumentHistoryReport(input: DocumentHistoryReportRequest, signal?: AbortSignal): Promise<PrintableReport> {
  const rows: Array<Array<string | number>> = []
  const snapshot = await visitDocumentHistoryReport(input, async batch => {
    rows.push(...batch.slice(0, REPORT_PREVIEW_ROW_LIMIT - rows.length))
    return rows.length < REPORT_PREVIEW_ROW_LIMIT
  }, signal)
  return { title: input.title, generatedAt: snapshot.generatedAt, meta: [{ label: 'Документов', value: String(snapshot.total) }],
    emptyMessage: 'По текущим условиям документы не найдены.',
    preview: { truncated: snapshot.total > rows.length, sourceRows: snapshot.total, totalRows: snapshot.total, freshExcel: true },
    tables: rows.length ? [{ title: '', columns: input.columns.map(column => column.label), rows,
      numericColumns: input.columns.flatMap((column, index) => ['rowCount', 'wdi'].includes(column.key) ? [index] : []) }] : [] }
}

export function documentHistoryWorksheetRow(values: Array<string | number>, index: number) {
  const cells = values.map((value, column) => {
    if (String(value).length > 32767) throw new Error('Текст ячейки превышает допустимый размер Excel. Уточните фильтры списка документов.')
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Некорректное число в списке документов.')
    let letter = '', position = column + 1
    while (position) { letter = String.fromCharCode(65 + (position - 1) % 26) + letter; position = Math.floor((position - 1) / 26) }
    const ref = `${letter}${index + 1}`, style = index === 0 ? 1 : 0
    return typeof value === 'number' && index > 0 ? `<c r="${ref}" s="${style}"><v>${value}</v></c>`
      : `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
  })
  return `<row r="${index + 1}">${cells.join('')}</row>`
}

export async function createDocumentHistoryExcelResponse(input: DocumentHistoryReportRequest, signal: AbortSignal) {
  normalizeDocumentHistoryReportRequest(input)
  return createTabularExcelResponse({ sheetName: 'Реестр документов', filename: 'documents.xlsx', row: documentHistoryWorksheetRow,
    header: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>'
      + input.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.key === 'title' ? 48 : 24}" customWidth="1"/>`).join('')
      + '</cols><sheetData>' + documentHistoryWorksheetRow(input.columns.map(column => column.label), 0),
  }, consume => visitDocumentHistoryReport(input, consume, signal), signal)
}
