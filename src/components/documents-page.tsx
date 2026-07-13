import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, Download, ExternalLink, FileSpreadsheet, FileText, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirmAction } from '@/lib/confirm-action-context'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DocumentGenerationRequest } from '@/lib/document-generation'
import {
  DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS,
  DOCUMENT_TEMPLATE_STORAGE_EVENT,
  createWeldingJournalBlobFromTemplate,
  isKnownTemplateMarkerField,
  loadDocumentTemplate,
  parseTemplateMarkerToken,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import {
  deleteGeneratedDocument,
  downloadBlob,
  downloadGeneratedDocument,
  GENERATED_DOCUMENT_STORAGE_EVENT,
  loadGeneratedDocuments,
  openGeneratedDocument,
  saveGeneratedDocument,
  type StoredGeneratedDocument,
} from '@/lib/generated-document-storage'
import { isUnofficialJoint } from '@/lib/joint-display'
import { FIELD_BY_KEY, FIELD_BY_LABEL, WELD_FIELDS, normalizeHeader, type WeldFieldKey } from '@/lib/weld-fields'
import { calculateFinalStatusInRows, normalizeFinalStatus } from '@/lib/weld-status'
import {
  STAMP_NAME_TEMPLATE_FIELDS,
  getWelderNameForTemplateStamp,
  getWelderNamesForOfficialStamps,
  type TemplateStampNameFieldKey,
} from '@/lib/welder-stamp-names'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type DocumentsPageProps = {
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  generationRequest?: DocumentGenerationRequest | null
}

type JournalField = {
  key: WeldFieldKey
  label: string
}

type DocumentScope = {
  projects: string[]
  subtitles: string[]
  lines: string[]
}

type TemplatePreviewColumn = {
  id: string
  header: string
  source: string
  fields: string[]
}

const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const WELDING_JOURNAL_FIELD_KEYS: WeldFieldKey[] = [
  'projectTitle',
  'subtitleCode',
  'line',
  'spool',
  'spoolId',
  'joint',
  'materialId1',
  'materialId2',
  'element1',
  'element2',
  'material1',
  'material2',
  'materialUniqueNumber1',
  'materialUniqueNumber2',
  'materialFullName1',
  'materialFullName2',
  'materialNormativeDocument1',
  'materialNormativeDocument2',
  'materialCertificateNumber1',
  'materialCertificateNumber2',
  'weldingMethod',
  'connectionType',
  'd1',
  'd2',
  't1',
  't2',
  'wdi',
  'weldDate',
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
  'responsible',
]

const WELDING_JOURNAL_FIELDS: JournalField[] = WELDING_JOURNAL_FIELD_KEYS.map((key) => {
  const field = FIELD_BY_KEY.get(key)
  return { key, label: field?.label ?? key }
})

type TemplatePreviewSystemField = '__index' | '__welderName' | `__welderName:${TemplateStampNameFieldKey}`

const TEMPLATE_PREVIEW_FIELD_ALIASES = new Map<string, string | TemplatePreviewSystemField>([
  [normalizeTemplateFieldName('№'), '__index'],
  [normalizeTemplateFieldName('№ п/п'), '__index'],
  [normalizeTemplateFieldName('N'), '__index'],
  [normalizeTemplateFieldName('Номер'), '__index'],
  [normalizeTemplateFieldName('ФИО сварщика'), '__welderName'],
])

for (const field of STAMP_NAME_TEMPLATE_FIELDS) {
  TEMPLATE_PREVIEW_FIELD_ALIASES.set(normalizeTemplateFieldName(`${field.label}ФИО сварщика`), `__welderName:${field.key}`)
  TEMPLATE_PREVIEW_FIELD_ALIASES.set(normalizeTemplateFieldName(`${field.label} ФИО сварщика`), `__welderName:${field.key}`)
}

for (const field of WELD_FIELDS) {
  TEMPLATE_PREVIEW_FIELD_ALIASES.set(normalizeTemplateFieldName(field.label), field.key)
}

for (const [label, field] of FIELD_BY_LABEL.entries()) {
  TEMPLATE_PREVIEW_FIELD_ALIASES.set(normalizeTemplateFieldName(label), field.key)
}

for (const field of WELDING_JOURNAL_FIELDS) {
  TEMPLATE_PREVIEW_FIELD_ALIASES.set(normalizeTemplateFieldName(field.label), field.key)
}

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getCurrentMonthRange() {
  const now = new Date()
  return {
    from: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toInputDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  }
}

function getRowsDateRange(rows: WeldRow[]) {
  const dates = rows
    .map((row) => parseDate(row.weldDate))
    .filter((date): date is Date => Boolean(date))

  if (dates.length === 0) return null

  const sortedDates = [...dates].sort((left, right) => left.getTime() - right.getTime())
  return {
    from: toInputDate(sortedDates[0]),
    to: toInputDate(sortedDates[sortedDates.length - 1]),
  }
}

function parseDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
  }

  const displayMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (displayMatch) {
    return new Date(Number(displayMatch[3]), Number(displayMatch[2]) - 1, Number(displayMatch[1]))
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDate(value: unknown) {
  const parsed = parseDate(value)
  if (!parsed) return String(value ?? '').trim()
  return `${String(parsed.getDate()).padStart(2, '0')}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${parsed.getFullYear()}`
}

function formatShortDate(value: unknown) {
  const parsed = parseDate(value)
  if (!parsed) return 'all'
  return `${String(parsed.getDate()).padStart(2, '0')}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${String(parsed.getFullYear()).slice(-2)}`
}

function getCellValue(row: WeldRow, key: string) {
  const value = (row as Record<string, unknown>)[key]
  if (key.toLowerCase().includes('date')) return formatDate(value)
  return value == null || value === '' ? '-' : String(value)
}

function normalizeTemplateFieldName(value: string) {
  return normalizeHeader(value).replace(/[{}]/g, '').trim()
}

function buildExportRows(rows: WeldRow[]) {
  return rows.map((row, index) => {
    const exportRow: Record<string, string | number> = { '№': index + 1 }
    for (const field of WELDING_JOURNAL_FIELDS) {
      exportRow[field.label] = getCellValue(row, field.key)
    }
    return exportRow
  })
}

async function createWeldingJournalBlob(rows: WeldRow[]) {
  const XLSX = await import('xlsx')
  const worksheet = XLSX.utils.json_to_sheet(buildExportRows(rows))
  worksheet['!cols'] = [{ wch: 5 }, ...WELDING_JOURNAL_FIELDS.map((field) => ({ wch: Math.max(14, field.label.length + 3) }))]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Сварочный журнал')
  const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([workbookData], { type: EXCEL_MIME_TYPE })
}

function getTextValue(value: unknown) {
  return String(value ?? '').trim()
}

function getUniqueSortedValues(rows: WeldRow[], key: string) {
  return Array.from(new Set(rows.map((row) => getTextValue((row as Record<string, unknown>)[key])).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, 'ru', { numeric: true }),
  )
}

function matchesSelection(value: unknown, selectedValues: string[]) {
  if (selectedValues.length === 0) return true
  return selectedValues.includes(getTextValue(value))
}

function sanitizeFileNamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatScopeFilePart(values: string[], fallback: string) {
  if (values.length === 0) return fallback
  if (values.length <= 3) return values.join(', ')
  return `${values.slice(0, 3).join(', ')} и еще ${values.length - 3}`
}

function buildWeldingJournalFileName(scope: DocumentScope, periodFrom: string, periodTo: string) {
  const parts = [
    formatScopeFilePart(scope.subtitles, 'Все шифры'),
    'Сварочный журнал',
    `${formatShortDate(periodFrom)} - ${formatShortDate(periodTo)}`,
  ]
  return parts.map(sanitizeFileNamePart).filter(Boolean).join(' - ')
}

function normalizeManualFileName(value: string) {
  return sanitizeFileNamePart(value.replace(/\.xlsx$/i, '').trim())
}

function ensureXlsxFileName(value: string) {
  const baseName = normalizeManualFileName(value) || 'Сварочный журнал'
  return `${baseName}.xlsx`
}

function extractTemplateFields(source: string) {
  const fields: string[] = []
  const markerPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
  let marker: RegExpExecArray | null

  while ((marker = markerPattern.exec(source)) !== null) {
    const fieldName = marker[1]?.trim()
    if (fieldName) fields.push(fieldName)
  }

  return fields
}

function decodeTemplateCellAddress(address: string) {
  const match = address.match(/^([A-Z]+)(\d+)$/i)
  if (!match) return { row: 0, column: 0 }

  const column = match[1]
    .toUpperCase()
    .split('')
    .reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0)

  return {
    row: Number(match[2]) - 1,
    column: column - 1,
  }
}

function buildTemplatePreviewColumns(template: StoredDocumentTemplate | null) {
  if (!template?.locations.length) return []

  const locations = template.locations
    .map((location) => ({
      ...location,
      fields: location.fields.filter(isKnownTemplateMarkerField),
      decoded: decodeTemplateCellAddress(location.cell),
    }))
    .filter((location) => location.fields.length > 0)

  const rowScores = new Map<number, number>()
  for (const location of locations) {
    rowScores.set(location.decoded.row, (rowScores.get(location.decoded.row) ?? 0) + location.fields.length)
  }

  const primaryRow = Array.from(rowScores.entries()).sort((left, right) => {
    const countDelta = right[1] - left[1]
    if (countDelta !== 0) return countDelta
    return right[0] - left[0]
  })[0]?.[0]

  if (primaryRow === undefined) return []

  return locations
    .filter((location) => location.decoded.row === primaryRow)
    .sort((left, right) => left.decoded.column - right.decoded.column)
    .map<TemplatePreviewColumn>((location) => ({
      id: `${location.sheet}:${location.cell}`,
      header: formatTemplatePreviewHeader(location.source, location.fields),
      source: location.source,
      fields: location.fields,
    }))
}

function formatTemplatePreviewHeader(source: string, fields: string[]) {
  const label = source
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, fieldName: string) => {
      const marker = parseTemplateMarkerToken(fieldName)
      return isKnownTemplateMarkerField(marker.fieldName) ? marker.fieldName : ''
    })
    .replace(/\s+/g, ' ')
    .trim()

  return label || fields.join(' / ') || 'Поле'
}

function getTemplatePreviewCellValue(source: string, row: WeldRow, rowIndex: number, welderStamps: WelderStampRecord[]) {
  const singleMarker = source.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/)
  if (singleMarker) return getTemplatePreviewFieldValue(singleMarker[1], row, rowIndex, welderStamps)

  return source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, fieldName: string) =>
    String(getTemplatePreviewFieldValue(fieldName, row, rowIndex, welderStamps) ?? ''),
  )
}

function getTemplatePreviewFieldValue(fieldName: string, row: WeldRow, rowIndex: number, welderStamps: WelderStampRecord[]) {
  const marker = parseTemplateMarkerToken(fieldName)
  const mappedKey = TEMPLATE_PREVIEW_FIELD_ALIASES.get(normalizeTemplateFieldName(marker.fieldName))
  if (!mappedKey) return ''
  if (mappedKey === '__index') return rowIndex + 1
  if (mappedKey === '__welderName') return formatTemplatePreviewFieldValue(getWelderNamesForOfficialStamps(row, welderStamps), marker.fallback)
  if (isTemplateStampWelderNamePreviewField(mappedKey)) {
    return formatTemplatePreviewFieldValue(
      getWelderNameForTemplateStamp(row, mappedKey.replace('__welderName:', '') as TemplateStampNameFieldKey, welderStamps),
      marker.fallback,
    )
  }

  return formatTemplatePreviewFieldValue(getCellValue(row, mappedKey), marker.fallback)
}

function formatTemplatePreviewFieldValue(value: unknown, fallback: string | undefined) {
  if (typeof value === 'number') return value
  const text = String(value ?? '').trim()
  return text && text !== '-' ? value : fallback ?? ''
}

function isTemplateStampWelderNamePreviewField(value: string | TemplatePreviewSystemField): value is `__welderName:${TemplateStampNameFieldKey}` {
  return value.startsWith('__welderName:')
}

export function DocumentsPage({ rows, welderStamps, generationRequest }: DocumentsPageProps) {
  const initialRange = useMemo(() => getCurrentMonthRange(), [])
  const [periodFrom, setPeriodFrom] = useState(initialRange.from)
  const [periodTo, setPeriodTo] = useState(initialRange.to)
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [selectedSubtitles, setSelectedSubtitles] = useState<string[]>([])
  const [selectedLines, setSelectedLines] = useState<string[]>([])
  const [manualFileName, setManualFileName] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)
  const [weldingJournalTemplate, setWeldingJournalTemplate] = useState<StoredDocumentTemplate | null>(null)
  const [generatedDocuments, setGeneratedDocuments] = useState<StoredGeneratedDocument[]>([])
  const [isGenerationOpen, setIsGenerationOpen] = useState(true)
  const weldingJournalOptions = weldingJournalTemplate?.options?.weldingJournal ?? DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS
  const sourceRows = generationRequest?.type === 'weldingJournal' ? generationRequest.rows : rows

  useEffect(() => {
    if (generationRequest?.type !== 'weldingJournal') return

    const range = getRowsDateRange(generationRequest.rows)
    if (range) {
      setPeriodFrom(range.from)
      setPeriodTo(range.to)
    }
    setSelectedProjects([])
    setSelectedSubtitles([])
    setSelectedLines([])
  }, [generationRequest?.id, generationRequest?.rows, generationRequest?.type])

  const scopeOptions = useMemo(
    () => ({
      projects: getUniqueSortedValues(sourceRows, 'projectTitle'),
      subtitles: getUniqueSortedValues(sourceRows, 'subtitleCode'),
      lines: getUniqueSortedValues(sourceRows, 'line'),
    }),
    [sourceRows],
  )

  useEffect(() => {
    let isMounted = true
    const syncTemplate = () => {
      loadDocumentTemplate('weldingJournal')
        .then((template) => {
          if (isMounted) setWeldingJournalTemplate(template ?? null)
        })
        .catch(() => {
          if (isMounted) setWeldingJournalTemplate(null)
        })
    }

    syncTemplate()
    window.addEventListener(DOCUMENT_TEMPLATE_STORAGE_EVENT, syncTemplate)
    return () => {
      isMounted = false
      window.removeEventListener(DOCUMENT_TEMPLATE_STORAGE_EVENT, syncTemplate)
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    const syncGeneratedDocuments = () => {
      loadGeneratedDocuments()
        .then((documents) => {
          if (isMounted) setGeneratedDocuments(documents)
        })
        .catch(() => {
          if (isMounted) setGeneratedDocuments([])
        })
    }

    syncGeneratedDocuments()
    window.addEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, syncGeneratedDocuments)
    return () => {
      isMounted = false
      window.removeEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, syncGeneratedDocuments)
    }
  }, [])

  const journalRows = useMemo(() => {
    const fromDate = parseDate(periodFrom)
    const toDate = parseDate(periodTo)
    return sourceRows
      .filter((row) => {
        const weldDate = parseDate(row.weldDate)
        if (!weldDate) return false
        if (fromDate && weldDate < fromDate) return false
        if (toDate && weldDate > toDate) return false
        if (!matchesSelection(row.projectTitle, selectedProjects)) return false
        if (!matchesSelection(row.subtitleCode, selectedSubtitles)) return false
        if (!matchesSelection(row.line, selectedLines)) return false
        if (weldingJournalOptions.officialOnly && isUnofficialJoint(row)) return false
        if (weldingJournalOptions.goodOnly && normalizeFinalStatus(calculateFinalStatusInRows(row, rows)) !== 'годен') return false
        return true
      })
      .sort((a, b) => {
        const aTime = parseDate(a.weldDate)?.getTime() ?? 0
        const bTime = parseDate(b.weldDate)?.getTime() ?? 0
        return aTime - bTime || String(a.line ?? '').localeCompare(String(b.line ?? '')) || String(a.joint ?? '').localeCompare(String(b.joint ?? ''))
      })
  }, [periodFrom, periodTo, rows, selectedLines, selectedProjects, selectedSubtitles, sourceRows, weldingJournalOptions.goodOnly, weldingJournalOptions.officialOnly])

  const exportScope = useMemo<DocumentScope>(
    () => ({
      projects: selectedProjects.length > 0 ? selectedProjects : getUniqueSortedValues(journalRows, 'projectTitle'),
      subtitles: selectedSubtitles.length > 0 ? selectedSubtitles : getUniqueSortedValues(journalRows, 'subtitleCode'),
      lines: selectedLines.length > 0 ? selectedLines : getUniqueSortedValues(journalRows, 'line'),
    }),
    [journalRows, selectedLines, selectedProjects, selectedSubtitles],
  )

  const exportFileName = useMemo(
    () => buildWeldingJournalFileName(exportScope, periodFrom, periodTo),
    [exportScope, periodFrom, periodTo],
  )
  const downloadFileName = normalizeManualFileName(manualFileName) || exportFileName

  const previewRows = journalRows.slice(0, 5)
  const templatePreviewColumns = useMemo(() => buildTemplatePreviewColumns(weldingJournalTemplate), [weldingJournalTemplate])
  const showTemplatePreview = weldingJournalTemplate && templatePreviewColumns.length > 0
  const wdiTotal = journalRows.reduce((sum, row) => sum + (Number(row.wdi) || 0), 0)

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Сварочный журнал</button>
          <button className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400" disabled>
            Заявки
          </button>
          <button className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400" disabled>
            Заключения
          </button>
        </div>
      </div>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="flex max-w-full items-start gap-2 text-left"
              onClick={() => setIsGenerationOpen((open) => !open)}
              aria-expanded={isGenerationOpen}
            >
              <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition ${isGenerationOpen ? 'rotate-180' : ''}`} />
              <span className="min-w-0">
                <span className="block text-lg font-semibold leading-tight text-slate-900">Формирование сварочного журнала</span>
                <span className="mt-1 block max-w-3xl text-sm text-slate-500">
                  Журнал собирает стыки с датой сварки внутри выбранного периода и формируется по сохраненному шаблону или базовой форме.
                </span>
              </span>
            </button>
            <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
              {weldingJournalTemplate ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Шаблон: {weldingJournalTemplate.fileName}
                </>
              ) : (
                <>
                  <FileSpreadsheet className="h-4 w-4 text-slate-500" />
                  Шаблон не сохранен, будет системная форма
                </>
              )}
            </div>
            {weldingJournalTemplate && (weldingJournalOptions.officialOnly || weldingJournalOptions.goodOnly) ? (
              <div className="mt-2 text-xs text-slate-500">
                Фильтр шаблона:{' '}
                {[
                  weldingJournalOptions.officialOnly ? 'только официальные стыки' : null,
                  weldingJournalOptions.goodOnly ? 'только годные стыки' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            ) : null}
          </div>
          <div className="w-full rounded-md border border-slate-200 bg-slate-50 p-3 shadow-sm shadow-slate-200/30 sm:w-[420px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Имя файла
              <textarea
                rows={2}
                value={manualFileName}
                onChange={(event) => setManualFileName(event.target.value.replace(/\s*\n+\s*/g, ' '))}
                placeholder={exportFileName}
                title={downloadFileName}
                className="mt-1 h-14 w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-snug text-slate-900 placeholder:text-slate-400"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                setIsDownloading(true)
                try {
                  const fileName = ensureXlsxFileName(downloadFileName)
                  const blob =
                    weldingJournalTemplate?.fileType === 'xlsx' || weldingJournalTemplate?.fileType === 'xls'
                      ? createWeldingJournalBlobFromTemplate(weldingJournalTemplate, journalRows, { welderStamps })
                      : await createWeldingJournalBlob(journalRows)

                  await saveGeneratedDocument({
                    type: 'weldingJournal',
                    title: downloadFileName,
                    fileName,
                    mimeType: EXCEL_MIME_TYPE,
                    fileData: await blob.arrayBuffer(),
                    periodFrom,
                    periodTo,
                    rowCount: journalRows.length,
                    wdiTotal,
                  })
                  downloadBlob(blob, fileName)
                } finally {
                  setIsDownloading(false)
                }
              }}
              disabled={journalRows.length === 0 || isDownloading}
              className="mt-2 h-9 w-full gap-2 border-slate-300 bg-white text-slate-700 shadow-sm shadow-slate-200/40 hover:bg-slate-100 hover:text-slate-950"
            >
              <Download className="h-4 w-4" />
              {isDownloading ? 'Готовлю файл' : 'Скачать Excel'}
            </Button>
          </div>
        </div>

        {isGenerationOpen ? (
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
            <div className="space-y-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm font-medium text-slate-700">
                    Период с
                    <input
                      type="date"
                      value={periodFrom}
                      onChange={(event) => setPeriodFrom(event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    по
                    <input
                      type="date"
                      value={periodTo}
                      onChange={(event) => setPeriodTo(event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 h-8 w-full text-sm"
                  onClick={() => {
                    setPeriodFrom(initialRange.from)
                    setPeriodTo(initialRange.to)
                  }}
                >
                  Текущий месяц
                </Button>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">Срез документа</div>
                  {(selectedProjects.length > 0 || selectedSubtitles.length > 0 || selectedLines.length > 0) && (
                    <button
                      type="button"
                      className="text-xs font-medium text-sky-700 hover:text-sky-900"
                      onClick={() => {
                        setSelectedProjects([])
                        setSelectedSubtitles([])
                        setSelectedLines([])
                      }}
                    >
                      сбросить все
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <DocumentMultiFilter
                    label="Проекты"
                    options={scopeOptions.projects}
                    selectedValues={selectedProjects}
                    emptyLabel="все проекты"
                    onChange={setSelectedProjects}
                  />
                  <DocumentMultiFilter
                    label="Шифры"
                    options={scopeOptions.subtitles}
                    selectedValues={selectedSubtitles}
                    emptyLabel="все шифры"
                    onChange={setSelectedSubtitles}
                  />
                  <DocumentMultiFilter
                    label="Линии"
                    options={scopeOptions.lines}
                    selectedValues={selectedLines}
                    emptyLabel="все линии"
                    onChange={setSelectedLines}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <CompactMetricCard label="Стыков" value={journalRows.length} />
                <CompactMetricCard label="WDI" value={wdiTotal} />
              </div>
            </div>

            <div className="rounded-md border border-slate-200">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <FileSpreadsheet className="h-4 w-4 text-slate-500" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">Предпросмотр</div>
                  <div className="text-xs text-slate-500">
                    {showTemplatePreview ? 'По текущему шаблону: ' : ''}
                    показаны первые {previewRows.length} из {journalRows.length}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                {showTemplatePreview ? (
                  <TemplatePreviewTable columns={templatePreviewColumns} rows={previewRows} totalRows={journalRows.length} welderStamps={welderStamps} />
                ) : (
                  <BasePreviewTable rows={previewRows} totalRows={journalRows.length} />
                )}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <GeneratedDocumentsPanel documents={generatedDocuments.filter((documentRecord) => documentRecord.type === 'weldingJournal')} />
    </div>
  )
}

function GeneratedDocumentsPanel({ documents }: { documents: StoredGeneratedDocument[] }) {
  const [isOpen, setIsOpen] = useState(true)
  const confirmAction = useConfirmAction()

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
          <FileText className="h-5 w-5 text-slate-500" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">История документов</h2>
            <p className="text-xs text-slate-500">
              {documents.length > 0 ? `${documents.length} ${formatDocumentCount(documents.length)}` : 'Сформированные документы появятся здесь.'}
            </p>
          </div>
        </button>
      </div>

      {!isOpen ? null : documents.length > 0 ? (
        <div className="divide-y divide-slate-100">
          {documents.map((documentRecord) => (
            <div key={documentRecord.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => openGeneratedDocument(documentRecord)}
                title="Открыть документ в новой вкладке"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate text-sm font-semibold text-sky-800 hover:text-sky-950">{documentRecord.title}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{formatGeneratedDocumentDate(documentRecord.createdAt)}</span>
                  {documentRecord.periodFrom || documentRecord.periodTo ? (
                    <span>
                      период: {formatDate(documentRecord.periodFrom)} - {formatDate(documentRecord.periodTo)}
                    </span>
                  ) : null}
                  {typeof documentRecord.rowCount === 'number' ? <span>строк: {documentRecord.rowCount}</span> : null}
                  {typeof documentRecord.wdiTotal === 'number' ? <span>WDI: {documentRecord.wdiTotal}</span> : null}
                </div>
              </button>

              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => downloadGeneratedDocument(documentRecord)}>
                  <Download className="h-4 w-4" />
                  Скачать
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={async () => {
                    const confirmed = await confirmAction({
                      title: 'Удалить документ',
                      itemName: documentRecord.title,
                      description: 'Документ будет удален из истории сформированных документов.',
                      warning: 'Файл больше не будет доступен в истории. Это действие нельзя отменить.',
                    })
                    if (confirmed) await deleteGeneratedDocument(documentRecord.id)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-slate-500">Пока нет сохраненных документов.</div>
      )}
    </section>
  )
}

function formatGeneratedDocumentDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDocumentCount(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'документов'
  if (last === 1) return 'документ'
  if (last >= 2 && last <= 4) return 'документа'
  return 'документов'
}

function DocumentMultiFilter({
  label,
  options,
  selectedValues,
  emptyLabel,
  onChange,
}: {
  label: string
  options: string[]
  selectedValues: string[]
  emptyLabel: string
  onChange: (values: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const selectedSet = new Set(selectedValues)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = normalizedQuery ? options.filter((option) => option.toLowerCase().includes(normalizedQuery)) : options
  const summary = selectedValues.length === 0 ? emptyLabel : formatSelectedFilterSummary(selectedValues)

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((selectedValue) => selectedValue !== value))
      return
    }
    onChange([...selectedValues, value])
  }

  return (
    <details className="group rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
            <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
              {options.length}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs font-semibold text-slate-800">{summary}</div>
        </div>
        {selectedValues.length > 0 ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-900"
            title={`Сбросить ${label.toLowerCase()}`}
            aria-label={`Сбросить ${label.toLowerCase()}`}
            onClick={(event) => {
              event.preventDefault()
              onChange([])
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>

      <div className="border-t border-slate-200 p-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск"
            className="h-8 w-full rounded-md border border-slate-200 bg-white py-1 pl-8 pr-2 text-sm text-slate-900 placeholder:text-slate-400"
          />
        </label>

        <div className="mt-2 max-h-44 overflow-auto rounded-md border border-slate-200 bg-white">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              const isSelected = selectedSet.has(option)
              return (
                <label
                  key={option}
                  className="flex min-h-8 cursor-pointer items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 last:border-b-0 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleValue(option)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700" title={option}>
                    {option}
                  </span>
                </label>
              )
            })
          ) : (
            <div className="px-2.5 py-3 text-center text-xs text-slate-400">нет значений</div>
          )}
        </div>
      </div>
    </details>
  )
}

function formatSelectedFilterSummary(values: string[]) {
  if (values.length === 1) return values[0]
  return `${values.length} выбрано · ${values.slice(0, 2).join(', ')}${values.length > 2 ? ` +${values.length - 2}` : ''}`
}

function TemplatePreviewTable({
  columns,
  rows,
  totalRows,
  welderStamps,
}: {
  columns: TemplatePreviewColumn[]
  rows: WeldRow[]
  totalRows: number
  welderStamps: WelderStampRecord[]
}) {
  return (
    <table className="w-full border-collapse text-sm" style={{ minWidth: `${Math.max(760, columns.length * 150)}px` }}>
      <thead className="bg-slate-100 text-slate-600">
        <tr>
          {columns.map((column) => (
            <th key={column.id} className="px-3 py-2 text-left font-semibold">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? (
          rows.map((row, rowIndex) => (
            <tr key={row.id} className="border-t border-slate-100">
              {columns.map((column) => (
                <td key={column.id} className="whitespace-pre-line px-3 py-2 align-top text-slate-700">
                  {getTemplatePreviewCellValue(column.source, row, rowIndex, welderStamps) || '-'}
                </td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={Math.max(columns.length, 1)} className="px-3 py-8 text-center text-slate-500">
              За выбранный период сваренных стыков не найдено.
            </td>
          </tr>
        )}
        {rows.length > 0 && totalRows > rows.length ? (
          <tr className="border-t border-slate-100 bg-slate-50">
            <td colSpan={Math.max(columns.length, 1)} className="px-3 py-2 text-xs text-slate-500">
              В предпросмотре показаны первые 5 строк. В документ попадут все {totalRows}.
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  )
}

function BasePreviewTable({ rows, totalRows }: { rows: WeldRow[]; totalRows: number }) {
  return (
    <table className="w-full min-w-[760px] border-collapse text-sm">
      <thead className="bg-slate-100 text-slate-600">
        <tr>
          <th className="px-3 py-2 text-left font-semibold">Линия</th>
          <th className="px-3 py-2 text-left font-semibold">Стык</th>
          <th className="px-3 py-2 text-left font-semibold">Дата сварки</th>
          <th className="px-3 py-2 text-left font-semibold">Способ сварки</th>
          <th className="px-3 py-2 text-left font-semibold">D1/D2</th>
          <th className="px-3 py-2 text-left font-semibold">Факт. клейма</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? (
          rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-700">{getCellValue(row, 'line')}</td>
              <td className="px-3 py-2 font-semibold text-slate-900">{getCellValue(row, 'joint')}</td>
              <td className="px-3 py-2 text-slate-700">{formatDate(row.weldDate) || '-'}</td>
              <td className="px-3 py-2 text-slate-700">{getCellValue(row, 'weldingMethod')}</td>
              <td className="px-3 py-2 text-slate-700">
                {getCellValue(row, 'd1')} / {getCellValue(row, 'd2')}
              </td>
              <td className="px-3 py-2 text-slate-700">
                {[row.stamp1KFact, row.stamp1ZFact, row.stamp1OFact, row.stamp2KFact, row.stamp2ZFact, row.stamp2OFact]
                  .map((value) => String(value ?? '').trim())
                  .filter(Boolean)
                  .join(', ') || '-'}
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
              За выбранный период сваренных стыков не найдено.
            </td>
          </tr>
        )}
        {rows.length > 0 && totalRows > rows.length ? (
          <tr className="border-t border-slate-100 bg-slate-50">
            <td colSpan={6} className="px-3 py-2 text-xs text-slate-500">
              В предпросмотре показаны первые 5 строк. В документ попадут все {totalRows}.
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  )
}

function CompactMetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-xl font-semibold leading-none text-slate-900">{value}</div>
    </div>
  )
}
