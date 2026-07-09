import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DocumentGenerationRequest } from '@/lib/document-generation'
import {
  DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS,
  DOCUMENT_TEMPLATE_STORAGE_EVENT,
  downloadWeldingJournalFromTemplate,
  loadDocumentTemplate,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import { isUnofficialJoint } from '@/lib/joint-display'
import { FIELD_BY_LABEL, WELD_FIELDS, normalizeHeader } from '@/lib/weld-fields'
import { calculateFinalStatusInRows, normalizeFinalStatus } from '@/lib/weld-status'

type DocumentsPageProps = {
  rows: WeldRow[]
  generationRequest?: DocumentGenerationRequest | null
}

type JournalField = {
  key: string
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

const WELDING_JOURNAL_FIELDS: JournalField[] = [
  { key: 'projectTitle', label: 'Проект/Титул' },
  { key: 'subtitleCode', label: 'Шифр/Подтитул' },
  { key: 'line', label: 'Линия' },
  { key: 'spool', label: 'Спул' },
  { key: 'spoolId', label: 'ID спула' },
  { key: 'joint', label: 'Стык' },
  { key: 'materialId1', label: 'ID материала 1' },
  { key: 'materialId2', label: 'ID материала 2' },
  { key: 'element1', label: 'Элемент 1' },
  { key: 'element2', label: 'Элемент 2' },
  { key: 'material1', label: 'Материал 1' },
  { key: 'material2', label: 'Материал 2' },
  { key: 'weldingMethod', label: 'Тип сварки' },
  { key: 'connectionType', label: 'Тип соедин.' },
  { key: 'd1', label: 'D1' },
  { key: 'd2', label: 'D2' },
  { key: 't1', label: 'T1' },
  { key: 't2', label: 'T2' },
  { key: 'wdi', label: 'WDI' },
  { key: 'weldDate', label: 'Дата сварки' },
  { key: 'stamp1KFact', label: 'Корень_1 факт' },
  { key: 'stamp1ZFact', label: 'Заполнение_1 факт' },
  { key: 'stamp1OFact', label: 'Облицовка_1 факт' },
  { key: 'stamp2KFact', label: 'Корень_2 факт' },
  { key: 'stamp2ZFact', label: 'Заполнение_2 факт' },
  { key: 'stamp2OFact', label: 'Облицовка_2 факт' },
  { key: 'responsible', label: 'Ответственный' },
]

const TEMPLATE_PREVIEW_FIELD_ALIASES = new Map<string, string | '__index'>([
  [normalizeTemplateFieldName('№'), '__index'],
  [normalizeTemplateFieldName('№ п/п'), '__index'],
  [normalizeTemplateFieldName('N'), '__index'],
  [normalizeTemplateFieldName('Номер'), '__index'],
])

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

async function downloadWeldingJournal(rows: WeldRow[], periodFrom: string, periodTo: string, fileName?: string) {
  const XLSX = await import('xlsx')
  const worksheet = XLSX.utils.json_to_sheet(buildExportRows(rows))
  worksheet['!cols'] = [{ wch: 5 }, ...WELDING_JOURNAL_FIELDS.map((field) => ({ wch: Math.max(14, field.label.length + 3) }))]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Сварочный журнал')
  XLSX.writeFile(workbook, `${fileName || `welding-journal-${periodFrom || 'all'}-${periodTo || 'all'}`}.xlsx`)
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
    formatScopeFilePart(scope.projects, 'Все проекты'),
    formatScopeFilePart(scope.subtitles, 'Все шифры'),
    formatScopeFilePart(scope.lines, 'Все линии'),
    'Сварочный журнал',
    `${formatShortDate(periodFrom)} - ${formatShortDate(periodTo)}`,
  ]
  return parts.map(sanitizeFileNamePart).filter(Boolean).join(' - ')
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

  const locations = template.locations.map((location) => ({
    ...location,
    decoded: decodeTemplateCellAddress(location.cell),
  }))

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
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  return label || fields.join(' / ') || 'Поле'
}

function getTemplatePreviewCellValue(source: string, row: WeldRow, rowIndex: number) {
  const singleMarker = source.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/)
  if (singleMarker) return getTemplatePreviewFieldValue(singleMarker[1], row, rowIndex)

  return source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, fieldName: string) =>
    String(getTemplatePreviewFieldValue(fieldName, row, rowIndex) ?? ''),
  )
}

function getTemplatePreviewFieldValue(fieldName: string, row: WeldRow, rowIndex: number) {
  const mappedKey = TEMPLATE_PREVIEW_FIELD_ALIASES.get(normalizeTemplateFieldName(fieldName))
  if (!mappedKey) return ''
  if (mappedKey === '__index') return rowIndex + 1

  return getCellValue(row, mappedKey)
}

export function DocumentsPage({ rows, generationRequest }: DocumentsPageProps) {
  const initialRange = useMemo(() => getCurrentMonthRange(), [])
  const [periodFrom, setPeriodFrom] = useState(initialRange.from)
  const [periodTo, setPeriodTo] = useState(initialRange.to)
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [selectedSubtitles, setSelectedSubtitles] = useState<string[]>([])
  const [selectedLines, setSelectedLines] = useState<string[]>([])
  const [isDownloading, setIsDownloading] = useState(false)
  const [weldingJournalTemplate, setWeldingJournalTemplate] = useState<StoredDocumentTemplate | null>(null)
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
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Формирование сварочного журнала</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Журнал собирает стыки с датой сварки внутри выбранного периода. Если в настройках сохранен шаблон сварочного журнала, файл
              формируется по нему; иначе используется базовая системная форма.
            </p>
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
          <Button
            onClick={async () => {
              setIsDownloading(true)
              try {
                if (weldingJournalTemplate?.fileType === 'xlsx' || weldingJournalTemplate?.fileType === 'xls') {
                  downloadWeldingJournalFromTemplate(weldingJournalTemplate, journalRows, periodFrom, periodTo, exportFileName)
                } else {
                  await downloadWeldingJournal(journalRows, periodFrom, periodTo, exportFileName)
                }
              } finally {
                setIsDownloading(false)
              }
            }}
            disabled={journalRows.length === 0 || isDownloading}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {isDownloading ? 'Готовлю файл' : 'Скачать Excel'}
          </Button>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(320px,520px)_1fr]">
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-slate-700">
                  Период с
                  <input
                    type="date"
                    value={periodFrom}
                    onChange={(event) => setPeriodFrom(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  по
                  <input
                    type="date"
                    value={periodTo}
                    onChange={(event) => setPeriodTo(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </label>
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => {
                  setPeriodFrom(initialRange.from)
                  setPeriodTo(initialRange.to)
                }}
              >
                Текущий месяц
              </Button>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="mb-2 text-sm font-semibold text-slate-900">Срез документа</div>
              <div className="space-y-3">
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
                <TemplatePreviewTable columns={templatePreviewColumns} rows={previewRows} totalRows={journalRows.length} />
              ) : (
                <BasePreviewTable rows={previewRows} totalRows={journalRows.length} />
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Что формируется здесь</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Раздел “Документы” отвечает за формирование и просмотр рабочих документов. Настройка шаблонов вынесена отдельно, чтобы не
            смешивать подготовку форм и ежедневную работу с готовыми документами.
          </p>
        </div>

        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-5">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Следующий слой</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Позже сюда можно добавить список “созданных документов” и переход из кликабельных заявок или заключений прямо к готовому
            документу.
          </p>
        </div>
      </section>
    </div>
  )
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
  const selectedSet = new Set(selectedValues)

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((selectedValue) => selectedValue !== value))
      return
    }
    onChange([...selectedValues, value])
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        {selectedValues.length > 0 ? (
          <button type="button" className="text-xs font-medium text-sky-700 hover:text-sky-900" onClick={() => onChange([])}>
            сбросить
          </button>
        ) : (
          <span className="text-xs text-slate-400">{emptyLabel}</span>
        )}
      </div>
      <div className="mt-1 flex max-h-24 flex-wrap gap-1.5 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
        {options.length > 0 ? (
          options.map((option) => {
            const isSelected = selectedSet.has(option)
            return (
              <button
                key={option}
                type="button"
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                  isSelected
                    ? 'border-sky-300 bg-sky-50 text-sky-800 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
                onClick={() => toggleValue(option)}
              >
                {option}
              </button>
            )
          })
        ) : (
          <span className="px-1 py-1 text-xs text-slate-400">нет значений</span>
        )}
      </div>
    </div>
  )
}

function TemplatePreviewTable({ columns, rows, totalRows }: { columns: TemplatePreviewColumn[]; rows: WeldRow[]; totalRows: number }) {
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
                  {getTemplatePreviewCellValue(column.source, row, rowIndex) || '-'}
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
          <th className="px-3 py-2 text-left font-semibold">Тип сварки</th>
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
