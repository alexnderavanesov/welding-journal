import { AlertTriangle, CheckCircle2, Download, FileDown, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { getActiveReportTitle } from '@/lib/report-display-state'
import {
  buildImportTemplateXlsxBytes,
  buildMassFillTemplateXlsxBytes,
  buildReplaceDataTemplateXlsxBytes,
  getMassFillTemplateFilename,
  getReplaceDataTemplateFilename,
  getReportImportTemplateFilename,
  type ImportableReport,
  type ReportImportMode,
} from '@/lib/report-import-template'
import {
  buildReportImportPreview,
  buildReportMassFillPreview,
  buildReportReplaceDataPreview,
  fixReportImportPreviewErrors,
  type ReportImportPreview,
  type ReportImportPreviewError,
  type ReportImportRecord,
} from '@/lib/report-import-preview'
import { cn } from '@/lib/utils'
import { addLineProgramImportErrors } from '@/lib/line-program-import'
import { getLineProgramIdentityKey, normalizeLineProgramIdentity, type LineProgramRecord } from '@/lib/line-program'
import { getLineProgramsForImport } from '@/server/line-program'
import type { StampSelectOptionLike } from '@/lib/weld-journal-mutation-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import { WELD_IMPORT_MAX_ROWS } from '@/lib/weld-import-limits'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { listWeldingJournalImportScope } from '@/server/weld-import-api'

import { ReadOnlyGrid } from './read-only-grid'
import type { ColDef, GridApi } from 'ag-grid-community'

type PreviewRowLimit = 50 | 100 | 'all'

export type ReportImportDialogProps = {
  open: boolean
  activeReport: ImportableReport
  isPending: boolean
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
  columnFilters: Record<string, string>
  onClose: () => void
  onImportRecords: (records: WeldInput[], skippedRows: number) => Promise<boolean>
  onMassFillRecords: (records: ReportImportRecord[], skippedRows: number, expectedVersions: WeldRowVersionTarget[]) => Promise<boolean>
  onReplaceDataRecords: (records: ReportImportRecord[], skippedRows: number, expectedVersions: WeldRowVersionTarget[]) => Promise<boolean>
}

export function ReportImportDialog({
  open,
  activeReport,
  isPending,
  weldFormStampSelectOptions,
  welderStamps,
  welderStampSuspensions,
  columnFilters,
  onClose,
  onImportRecords,
  onMassFillRecords,
  onReplaceDataRecords,
}: ReportImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [mode, setMode] = useState<ReportImportMode>('newRecords')
  const [templateDownloaded, setTemplateDownloaded] = useState(false)
  const [preview, setPreview] = useState<ReportImportPreview | null>(null)
  const [previewPrograms, setPreviewPrograms] = useState<LineProgramRecord[]>([])
  const [previewRowLimit, setPreviewRowLimit] = useState<PreviewRowLimit>(50)
  const [errorsCollapsed, setErrorsCollapsed] = useState(false)
  const [showOnlyErrorRows, setShowOnlyErrorRows] = useState(false)
  const [activeErrorIndex, setActiveErrorIndex] = useState(-1)
  const [previewFocus, setPreviewFocus] = useState<{ index: number; field?: string } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const readGeneration = useRef(0)
  useEffect(() => () => { readGeneration.current++ }, [open, activeReport])

  const importScopeQuery = useQuery({
    queryKey: ['welding-journal-import-scope', columnFilters],
    queryFn: () => listWeldingJournalImportScope({ data: { columnFilters } }),
    enabled: open && mode !== 'newRecords',
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const rows = importScopeQuery.data?.rows ?? []
  const fullyAssignedPstoLineKeys = importScopeQuery.data?.fullyAssignedPstoLineKeys ?? []
  const scopeTotal = importScopeQuery.data?.total ?? 0
  const scopeLimitExceeded = importScopeQuery.data?.limitExceeded === true
  const isScopeLoading = mode !== 'newRecords' && importScopeQuery.isFetching
  const scopeError =
    mode !== 'newRecords' && importScopeQuery.error instanceof Error
      ? importScopeQuery.error.message
      : null

  const { changedPreviewCellKeys, errorPreviewCellKeys, errorPreviewRowKeys, stickyPreviewColumns } = useMemo(() => ({
    changedPreviewCellKeys: preview ? buildPreviewChangedCellKeys(preview) : new Map<string, Set<string>>(),
    errorPreviewCellKeys: preview ? buildPreviewErrorCellKeys(preview) : new Map<string, Set<string>>(),
    errorPreviewRowKeys: new Set(preview?.errors.map(getPreviewErrorRowKey)),
    stickyPreviewColumns: preview ? getStickyPreviewColumns(preview) : [],
  }), [preview])
  const previewRecordsWithIndexes = useMemo(() => preview
    ? preview.records.map((record, index) => ({ record, index })).filter(({ record, index }) =>
        !showOnlyErrorRows || errorPreviewRowKeys.has(getPreviewRowKey(record, index)))
    : [], [preview, showOnlyErrorRows, errorPreviewRowKeys])
  const visiblePreviewRecords = useMemo(() => getVisiblePreviewRecords(previewRecordsWithIndexes, previewRowLimit), [previewRecordsWithIndexes, previewRowLimit])

  if (!open) return null

  const validCount = preview?.validRecords.length ?? 0
  const errorCount = preview?.errors.length ?? 0
  const deleteCount = preview?.validRecords.filter((record) => record.deleteRequested).length ?? 0
  const errorRowCount = preview ? new Set(preview.errors.map((error) => error.id ? `id:${error.id}` : `row:${error.rowNumber}`)).size : 0
  const errorGroups = preview ? groupImportPreviewErrors(preview.errors) : []
  const isPreviewLimited = visiblePreviewRecords.length < previewRecordsWithIndexes.length
  const modeCopy = getImportModeCopy(mode, activeReport)

  const handleDownloadTemplate = () => {
    if (mode !== 'newRecords' && (isScopeLoading || scopeLimitExceeded || scopeError)) return
    const bytes =
      mode === 'replaceData'
        ? buildReplaceDataTemplateXlsxBytes(activeReport, rows)
        : mode === 'massFill'
          ? buildMassFillTemplateXlsxBytes(activeReport, rows)
          : buildImportTemplateXlsxBytes(activeReport)
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download =
      mode === 'replaceData'
        ? getReplaceDataTemplateFilename(activeReport)
        : mode === 'massFill'
          ? getMassFillTemplateFilename(activeReport)
          : getReportImportTemplateFilename(activeReport)
    link.click()
    URL.revokeObjectURL(url)
    setTemplateDownloaded(true)
  }

  const resetImportState = () => {
    readGeneration.current++
    setTemplateDownloaded(false)
    setPreview(null)
    setPreviewFocus(null)
    setPreviewRowLimit(50)
    setErrorsCollapsed(false)
    setShowOnlyErrorRows(false)
    setActiveErrorIndex(-1)
    setReadError(null)
    setIsReading(false)
  }

  const handleModeChange = (nextMode: ReportImportMode) => {
    if (mode === nextMode) return
    setMode(nextMode)
    resetImportState()
  }

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return
    const generation = ++readGeneration.current
    setPreviewFocus(null)
    setIsReading(true)
    setReadError(null)
    try {
      const nextPreview =
        mode === 'replaceData'
          ? await buildReportReplaceDataPreview({
              activeReport,
              file,
              rows,
              fullyAssignedPstoLineKeys,
              weldFormStampSelectOptions,
              welderStamps,
              welderStampSuspensions,
            })
          : mode === 'massFill'
          ? await buildReportMassFillPreview({
              activeReport,
              file,
              rows,
              fullyAssignedPstoLineKeys,
              weldFormStampSelectOptions,
              welderStamps,
              welderStampSuspensions,
            })
          : await buildReportImportPreview({
              activeReport,
              file,
              weldFormStampSelectOptions,
              welderStamps,
              welderStampSuspensions,
            })
      // Switching modes or closing the dialog retires this read. Its records
      // must never become eligible for a different import operation.
      if (generation !== readGeneration.current) return
      const identities = [...new Map(nextPreview.records.filter((row) => !row.deleteRequested && String(row.line ?? '').trim()).map((row) => [getLineProgramIdentityKey(row), normalizeLineProgramIdentity(row)])).values()]
      const programs = identities.length ? await getLineProgramsForImport({ data: { identities } }) : []
      if (generation !== readGeneration.current) return
      setPreviewPrograms(programs)
      setPreview(addLineProgramImportErrors(nextPreview, programs, rows))
      setPreviewRowLimit(50)
      setErrorsCollapsed(false)
      setShowOnlyErrorRows(false)
      setActiveErrorIndex(-1)
    } catch (error) {
      if (generation !== readGeneration.current) return
      setPreview(null)
      setPreviewFocus(null)
      setReadError(error instanceof Error ? error.message : 'Не удалось прочитать файл импорта.')
    } finally {
      if (generation === readGeneration.current) setIsReading(false)
    }
  }

  const handleImport = async () => {
    if (!preview || preview.validRecords.length === 0) return
    if (mode === 'replaceData' && preview.errors.length > 0) return
    setReadError(null)
    try {
      const saved = mode === 'replaceData'
        ? await onReplaceDataRecords(preview.validRecords, preview.skippedRows, preview.expectedRowVersions ?? [])
        : mode === 'massFill'
          ? await onMassFillRecords(preview.validRecords, preview.skippedRows, preview.expectedRowVersions ?? [])
          : await onImportRecords(preview.validRecords, preview.skippedRows)
      if (!saved) return
      resetImportState()
      onClose()
    } catch (error) {
      setReadError(
        `Сохранение не выполнено. ${error instanceof Error ? error.message : 'Сервер отклонил данные импорта.'}`,
      )
    }
  }

  const handleFixPreviewErrors = () => {
    if (mode !== 'newRecords' || !preview || preview.errors.length === 0) return
    setPreview(addLineProgramImportErrors(fixReportImportPreviewErrors(preview, {
      activeReport,
      weldFormStampSelectOptions,
      welderStamps,
      welderStampSuspensions,
    }), previewPrograms, rows))
  }

  const handleNextError = () => {
    if (!preview?.errors.length) return
    const nextIndex = (activeErrorIndex + 1) % preview.errors.length
    setActiveErrorIndex(nextIndex)
    window.requestAnimationFrame(() => {
      document.getElementById(`import-error-${nextIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  const handleExportErrors = async () => {
    if (!preview?.errors.length) return
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.json_to_sheet(preview.errors.map((error) => ({
      'Строка Excel': error.rowNumber,
      ID: error.id ?? '',
      'Группа ошибки': error.title,
      'Описание': error.message,
      'Поля': error.fieldKeys?.map((key) => preview.fields.find((field) => field.key === key)?.label ?? key).join(', ') ?? '',
    })))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Ошибки импорта')
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `Ошибки импорта - ${preview.fileName.replace(/\.[^.]+$/, '')}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <LargeDialogShell ariaLabel="Импорт данных" maxWidthClassName="max-w-[1440px]" maxHeightClassName="max-h-[94vh]" overlayClassName="z-[90] bg-slate-950/35">
      <DialogHeader
        title="Импорт данных"
        subtitle={`${getActiveReportTitle(activeReport)} · ${modeCopy.subtitle}`}
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 py-4">
        <div className="inline-flex w-fit rounded-md border border-slate-200 bg-slate-50 p-1">
          <ImportModeTab
            active={mode === 'newRecords'}
            label="Импорт данных"
            onClick={() => handleModeChange('newRecords')}
          />
          <ImportModeTab active={mode === 'massFill'} label="Массовое заполнение" onClick={() => handleModeChange('massFill')} />
          <ImportModeTab active={mode === 'replaceData'} label="Замена данных" onClick={() => handleModeChange('replaceData')} />
        </div>

        <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {mode !== 'newRecords'
            ? isScopeLoading
              ? 'Определяем стыки по текущему фильтру сварочного журнала. '
              : `В шаблон попадут стыки из текущего фильтра сварочного журнала: ${scopeTotal}. Если фильтр не задан, попадут все стыки. `
            : ''}
          За одну загрузку обрабатывается не более {WELD_IMPORT_MAX_ROWS} непустых строк.
        </div>

        {scopeLimitExceeded ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Текущий фильтр содержит {scopeTotal} строк. Для подготовки одного шаблона оставьте не более{' '}
            {WELD_IMPORT_MAX_ROWS} строк: уточните фильтр по проекту, шифру, линии или другому столбцу.
          </div>
        ) : null}

        {scopeError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Не удалось получить стыки текущего фильтра: {scopeError}
          </div>
        ) : null}

        <div className="grid gap-2 lg:grid-cols-[1fr_1fr_1.15fr]">
          <ImportStepCard
            icon={<Download className="h-4 w-4" />}
            title="1. Шаблон"
            text={modeCopy.templateText}
          />
          <ImportStepCard
            icon={<Upload className="h-4 w-4" />}
            title="2. Загрузка"
            text={modeCopy.uploadText}
          />
          <ImportStepCard
            icon={<FileSpreadsheet className="h-4 w-4" />}
            title="3. Предпросмотр"
            text={modeCopy.previewText}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <LegendItem className="bg-slate-200" text={modeCopy.grayLegend} />
            <LegendItem className="bg-amber-100 ring-amber-200" text={modeCopy.yellowLegend} />
            <LegendItem className="bg-white ring-slate-200" text={modeCopy.whiteLegend} />
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                void handleFileChange(event.target.files?.[0])
                event.currentTarget.value = ''
              }}
            />
            {!templateDownloaded ? (
              <Button onClick={handleDownloadTemplate} disabled={isScopeLoading || scopeLimitExceeded || Boolean(scopeError)}>
                {isScopeLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Скачать шаблон
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={handleDownloadTemplate}
                  className="text-muted-foreground"
                  disabled={isScopeLoading || scopeLimitExceeded || Boolean(scopeError)}
                >
                  {isScopeLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Скачать заново
                </Button>
                <Button onClick={() => fileInputRef.current?.click()} disabled={isReading}>
                  {isReading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Загрузить шаблон
                </Button>
              </>
            )}
          </div>
        </div>

        {readError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{readError}</div>
        ) : null}

        {preview ? (
          <div className="flex min-h-[360px] flex-col gap-4">
            <div className="min-w-0 rounded-md border border-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">Предпросмотр</div>
                  <div className="text-xs text-muted-foreground">
                    {preview.fileName} · найдено: {preview.records.length} · {mode === 'newRecords' ? 'к добавлению' : 'к изменению'}: {validCount}
                    {preview.skippedRows ? ` · пропущено: ${preview.skippedRows}` : ''}{deleteCount ? ` · к удалению: ${deleteCount}` : ''}
                    {isPreviewLimited ? ` · показано: ${visiblePreviewRecords.length}` : ''}
                  </div>
                  {changedPreviewCellKeys.size > 0 || errorPreviewCellKeys.size > 0 ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-emerald-700">Зеленым</span> подсвечены ячейки, которые будут сохранены.
                      <span className="font-medium text-amber-700"> Желтым</span> - ячейки, которые требуют исправления.
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {errorRowCount ? (
                    <button
                      type="button"
                      onClick={() => setShowOnlyErrorRows((current) => !current)}
                      className={`h-8 rounded-md border px-3 text-xs font-semibold ${showOnlyErrorRows ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      {showOnlyErrorRows ? 'Показаны только ошибки' : `Только строки с ошибками · ${errorRowCount}`}
                    </button>
                  ) : null}
                  <PreviewRowLimitControl
                    value={previewRowLimit}
                    totalRows={previewRecordsWithIndexes.length}
                    visibleRows={visiblePreviewRecords.length}
                    onChange={setPreviewRowLimit}
                  />
                  {validCount ? (
                    <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {validCount}
                    </span>
                  ) : null}
                </div>
              </div>
              <ImportPreviewGrid
                records={visiblePreviewRecords} fields={preview.fields} stickyColumns={stickyPreviewColumns}
                changedCells={changedPreviewCellKeys} errorCells={errorPreviewCellKeys} focus={previewFocus}
              />
            </div>

            <div className="min-w-0 rounded-md border border-slate-200">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">Ошибки</div>
                  <div className="text-xs text-muted-foreground">
                    {mode !== 'newRecords'
                      ? 'Исправьте файл и загрузите его заново.'
                      : 'Исправление очищает проблемные проверочные ячейки.'}
                  </div>
                </div>
                {errorCount ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {errorCount}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setErrorsCollapsed((value) => !value)}>
                      {errorsCollapsed ? 'Развернуть' : 'Свернуть'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleNextError}>Следующая ошибка</Button>
                    <Button size="sm" variant="outline" onClick={() => void handleExportErrors()}>
                      <FileDown className="mr-1.5 h-4 w-4" />Excel с ошибками
                    </Button>
                    {mode === 'newRecords' ? (
                      <Button size="sm" variant="outline" onClick={handleFixPreviewErrors} disabled={isReading || isPending}>
                        Исправить ошибки
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                    нет
                  </span>
                )}
              </div>
              {!errorsCollapsed ? (
                <div className="max-h-[220px] overflow-auto p-3">
                  {preview.errors.length ? (
                    <div>
                      <div className="mb-3 flex flex-wrap gap-2">
                        {errorGroups.map((group) => (
                          <span key={group.title} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                            {group.title}: {group.count}
                          </span>
                        ))}
                      </div>
                      <div className="grid gap-2 xl:grid-cols-2">
                      {preview.errors.map((error, errorIndex) => (
                        <button
                          id={`import-error-${errorIndex}`}
                          type="button"
                          key={`${error.rowNumber}-${error.title}-${errorIndex}`}
                          onClick={() => {
                            const index = preview.records.findIndex((record, index) => getPreviewRowKey(record, index) === getPreviewErrorRowKey(error))
                            if (index < 0) return
                            setPreviewRowLimit('all')
                            setActiveErrorIndex(errorIndex)
                            setPreviewFocus({ index, field: error.fieldKeys?.[0] })
                          }}
                          className={`rounded border px-3 py-2 text-left text-sm text-amber-900 ${activeErrorIndex === errorIndex ? 'border-amber-500 bg-amber-100 ring-2 ring-amber-200' : 'border-amber-200 bg-amber-50 hover:bg-amber-100'}`}
                        >
                          <div className="font-semibold">
                            Строка {error.rowNumber}: {error.title}
                          </div>
                          <div className="mt-1 text-xs leading-relaxed">{error.message}</div>
                        </button>
                      ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      Проверочные ячейки прошли проверку.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-muted-foreground">
            {templateDownloaded ? 'Загрузите заполненный шаблон, чтобы увидеть предпросмотр.' : 'Скачайте шаблон для начала импорта.'}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
        <div className="text-sm text-muted-foreground">
          {preview
            ? `${mode === 'newRecords' ? 'К добавлению' : 'К изменению'}: ${validCount}. Пропущено: ${preview.skippedRows}. ${deleteCount ? `К удалению: ${deleteCount}. ` : ''}Строк с ошибками: ${errorRowCount}. Сообщений: ${errorCount}.`
            : 'Импорт начнется только после предпросмотра.'}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending || isReading}>
            Отмена
          </Button>
          <Button
            onClick={handleImport}
            disabled={!preview || validCount === 0 || (mode === 'replaceData' && errorCount > 0) || isPending || isReading}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {mode === 'replaceData' ? 'Заменить' : mode === 'massFill' ? 'Заполнить' : 'Импортировать'} {validCount ? `${validCount} строк` : ''}
          </Button>
        </div>
      </div>
    </LargeDialogShell>
  )
}

function ImportModeTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1.5 text-sm font-medium transition',
        active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800',
      )}
    >
      {label}
    </button>
  )
}

function getImportModeCopy(mode: ReportImportMode, _activeReport: ImportableReport) {
  if (mode === 'replaceData') {
    return {
      subtitle: 'редкий осторожный режим: скачайте текущие стыки, измените нужные разрешенные ячейки и загрузите файл для проверки.',
      templateText: 'В шаблоне уже будут текущие стыки и скрытые служебные версии строк. Серые ячейки системные и не меняются; желтые проверяются; белые заменяются без специальной проверки.',
      uploadText: 'После загрузки система сравнит файл с текущим журналом и подготовит только строки, где данные действительно изменились. Устаревший файл не перезапишет более свежие правки.',
      previewText: 'Перед заменой проверьте список строк и ошибок. Пустая разрешенная ячейка заменит текущее значение на пусто.',
      grayLegend: 'Системные поля, не менять',
      yellowLegend: 'Проверяемые поля / удаление строки',
      whiteLegend: 'Разрешенная замена',
    }
  }

  if (mode === 'massFill') {
    return {
      subtitle: 'скачайте шаблон с существующими стыками, заполните пустые разрешенные ячейки и загрузите его для проверки.',
      templateText: 'В шаблоне уже будут текущие стыки. Серые ячейки заняты или защищены, желтые проверяются, белые заполняются свободно.',
      uploadText: 'После загрузки система найдет строки по ID записи и подготовит только те стыки, где появились новые значения.',
      previewText: 'Перед сохранением можно увидеть, какие существующие записи будут обновлены и какие ячейки требуют исправления.',
      grayLegend: 'Заполнено или нельзя менять',
      yellowLegend: 'Проверяемое пустое поле',
      whiteLegend: 'Свободное пустое поле',
    }
  }

  return {
    subtitle: 'сначала скачайте шаблон, затем загрузите заполненный файл для проверки.',
    templateText: 'Серые ячейки игнорируются, желтые проверяются, белые можно заполнять свободно.',
    uploadText: 'После загрузки файл будет проверен. Ошибки можно очистить в предпросмотре без удаления строки.',
    previewText: 'Перед импортом можно увидеть найденные строки и список ошибок по проверочным ячейкам.',
    grayLegend: 'Не заполнять, импорт игнорирует',
    yellowLegend: 'Проверочные ячейки',
    whiteLegend: 'Свободный ввод',
  }
}

function ImportStepCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="rounded border border-slate-200 bg-slate-50 p-0.5 text-slate-500">{icon}</span>
        {title}
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{text}</p>
    </div>
  )
}

function LegendItem({ className, text }: { className: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      <span className={cn('h-3 w-6 rounded-sm ring-1 ring-inset', className)} />
      {text}
    </span>
  )
}

function PreviewRowLimitControl({
  value,
  totalRows,
  visibleRows,
  onChange,
}: {
  value: PreviewRowLimit
  totalRows: number
  visibleRows: number
  onChange: (value: PreviewRowLimit) => void
}) {
  const options: Array<{ value: PreviewRowLimit; label: string; disabled?: boolean }> = [
    { value: 50, label: '50', disabled: totalRows <= 50 },
    { value: 100, label: '100', disabled: totalRows <= 50 },
    { value: 'all', label: 'Все', disabled: totalRows <= 100 },
  ]

  if (totalRows <= 50) {
    return <span className="text-xs text-muted-foreground">Показано: {visibleRows}</span>
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Строки: {visibleRows}/{totalRows}</span>
      <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition',
              value === option.value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800',
              option.disabled && 'cursor-not-allowed opacity-40 hover:text-slate-500',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function formatPreviewValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function getVisiblePreviewRecords<T>(records: T[], rowLimit: PreviewRowLimit) {
  return rowLimit === 'all' ? records : records.slice(0, rowLimit)
}

function groupImportPreviewErrors(errors: ReportImportPreviewError[]) {
  const groups = new Map<string, number>()
  errors.forEach((error) => groups.set(error.title, (groups.get(error.title) ?? 0) + 1))
  return Array.from(groups, ([title, count]) => ({ title, count })).sort((left, right) => right.count - left.count || left.title.localeCompare(right.title, 'ru'))
}

const STICKY_PREVIEW_COLUMN_WIDTHS: Record<string, number> = {
  id: 72,
  line: 220,
  joint: 168,
}

function getStickyPreviewColumns(preview: ReportImportPreview) {
  const stickyColumns: string[] = []
  if (preview.records.some((record) => record.id)) stickyColumns.push('id')
  if (preview.fields.some((field) => field.key === 'line')) stickyColumns.push('line')
  if (preview.fields.some((field) => field.key === 'joint')) stickyColumns.push('joint')
  return stickyColumns
}

function getPreviewCellClass({
  isErrorCell,
  isChangedCell,
  isStickyCell,
}: {
  isErrorCell: boolean
  isChangedCell: boolean
  isStickyCell: boolean
}) {
  return cn(
    'whitespace-nowrap border-b text-slate-700',
    isErrorCell
      ? 'border-amber-200 bg-amber-50 font-semibold text-amber-950 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.28)]'
      : isChangedCell
        ? 'border-emerald-200 bg-emerald-50 font-semibold text-emerald-950 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.25)]'
        : isStickyCell
          ? 'border-slate-100 bg-white'
          : 'border-slate-100',
  )
}

function buildPreviewChangedCellKeys(preview: ReportImportPreview) {
  const result = new Map<string, Set<string>>()
  const validRecordsById = new Map<number, ReportImportRecord>()
  preview.validRecords.forEach((record) => {
    if (record.id) validRecordsById.set(record.id, record)
  })
  const errorRows = new Set(preview.errors.map((error) => error.rowNumber))

  preview.records.forEach((record, index) => {
    if (record.deleteRequested) return
    const rowKey = getPreviewRowKey(record, index)
    if (record.id) {
      const source = validRecordsById.get(record.id)
      if (!source) return
      const fieldKeys = preview.fields.map((field) => field.key).filter((fieldKey) => fieldKey in source)
      if (fieldKeys.length > 0) result.set(rowKey, new Set(fieldKeys))
      return
    }

    if (errorRows.has(index + 2)) return

    const fieldKeys = preview.fields
      .map((field) => field.key)
      .filter((fieldKey) => fieldKey in record && record[fieldKey as WeldFieldKey] !== null && record[fieldKey as WeldFieldKey] !== undefined && record[fieldKey as WeldFieldKey] !== '')

    if (fieldKeys.length > 0) result.set(rowKey, new Set(fieldKeys))
  })

  return result
}

function buildPreviewErrorCellKeys(preview: ReportImportPreview) {
  const result = new Map<string, Set<string>>()
  preview.errors.forEach((error) => {
    if (!error.fieldKeys?.length) return
    const rowKey = getPreviewErrorRowKey(error)
    const fieldKeys = result.get(rowKey) ?? new Set<string>()
    error.fieldKeys.forEach((fieldKey) => fieldKeys.add(fieldKey))
    result.set(rowKey, fieldKeys)
  })
  return result
}

function getPreviewRowKey(record: ReportImportRecord, index: number) {
  return record.id ? `id:${record.id}` : `row:${index + 2}`
}

function getPreviewErrorRowKey(error: ReportImportPreviewError) {
  return error.id ? `id:${error.id}` : `row:${error.rowNumber}`
}

type PreviewGridRow = { record: ReportImportRecord; index: number }
const previewGridRowId = ({ data }: { data: PreviewGridRow }) => String(data.index)

function ImportPreviewGrid({ records, fields, stickyColumns, changedCells, errorCells, focus }: {
  records: PreviewGridRow[]
  fields: ReportImportPreview['fields']
  stickyColumns: string[]
  changedCells: Map<string, Set<string>>
  errorCells: Map<string, Set<string>>
  focus: { index: number; field?: string } | null
}) {
  const api = useRef<GridApi<PreviewGridRow> | null>(null)
  const completedFocus = useRef<typeof focus>(null)
  const columns = useMemo<ColDef<PreviewGridRow>[]>(() => [
    ...(stickyColumns.includes('id') ? [{ key: 'id', label: 'ID' }] : []), ...fields,
  ].map(field => ({
    colId: field.key, headerName: field.label,
    pinned: stickyColumns.includes(field.key) ? 'left' : undefined,
    initialWidth: STICKY_PREVIEW_COLUMN_WIDTHS[field.key] ?? 170, minWidth: 70,
    valueGetter: ({ data }) => formatPreviewValue(data?.record[field.key as keyof ReportImportRecord]),
    cellRenderer: ({ value, data }: { value: string; data?: PreviewGridRow }) => <ImportPreviewValue value={value}
      focusRequest={data?.index === focus?.index && field.key === (focus?.field ?? fields[0]?.key) ? focus : null}
      completedFocus={completedFocus} />,
    cellClass: ({ data }) => getPreviewCellClass({
      isErrorCell: !!data && !!errorCells.get(getPreviewRowKey(data.record, data.index))?.has(field.key),
      isChangedCell: !!data && !!changedCells.get(getPreviewRowKey(data.record, data.index))?.has(field.key),
      isStickyCell: stickyColumns.includes(field.key),
    }),
  })), [fields, stickyColumns, changedCells, errorCells, focus])
  const reveal = () => {
    const grid = api.current
    if (!focus || !grid || grid.isDestroyed()) return
    const node = grid.getRowNode(String(focus.index))
    if (node?.rowIndex == null) return
    grid.ensureIndexVisible(node.rowIndex, 'middle')
    const column = focus.field ?? fields[0]?.key
    if (column) { grid.ensureColumnVisible(column); grid.setFocusedCell(node.rowIndex, column) }
  }
  useEffect(reveal, [focus, records])
  return <div data-import-preview-grid>
    <ReadOnlyGrid label="Предпросмотр импорта" rowData={records} columnDefs={columns}
      getRowId={previewGridRowId}
      onGridReady={({ api: grid }) => { api.current = grid }} onRowDataUpdated={reveal} onFirstDataRendered={reveal}
    />
  </div>
}

function ImportPreviewValue({ value, focusRequest, completedFocus }: {
  value: string
  focusRequest: { index: number; field?: string } | null
  completedFocus: { current: { index: number; field?: string } | null }
}) {
  const element = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!focusRequest || completedFocus.current === focusRequest) return
    // The virtual row's React cell now exists. Logical AG focus alone may
    // precede its DOM; one request must not steal focus when scrolling back.
    const cell = element.current?.closest<HTMLElement>('.ag-cell')
    if (cell) { cell.focus({ preventScroll: true }); completedFocus.current = focusRequest }
  }, [focusRequest, completedFocus])
  return <span ref={element} title={value}>{value}</span>
}
