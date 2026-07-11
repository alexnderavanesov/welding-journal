import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
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
  getReportImportCellKind,
  getReportImportTemplateFilename,
  getReportImportTemplateFields,
  type ReportImportMode,
} from '@/lib/report-import-template'
import {
  buildReportImportPreview,
  buildReportMassFillPreview,
  buildReportReplaceDataPreview,
  fixReportImportPreviewErrors,
  type ReportImportPreview,
  type ReportImportRecord,
} from '@/lib/report-import-preview'
import { cn } from '@/lib/utils'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { StampSelectOptionLike } from '@/lib/weld-journal-mutation-types'
import type { WeldField, WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export type ReportImportDialogProps = {
  open: boolean
  activeReport: ActiveReport
  isPending: boolean
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
  rows: WeldRow[]
  onClose: () => void
  onImportRecords: (records: WeldInput[], skippedRows: number) => Promise<void>
  onMassFillRecords: (records: ReportImportRecord[], skippedRows: number) => Promise<void>
  onReplaceDataRecords: (records: ReportImportRecord[], skippedRows: number) => Promise<void>
}

export function ReportImportDialog({
  open,
  activeReport,
  isPending,
  weldFormStampSelectOptions,
  welderStamps,
  welderStampSuspensions,
  rows,
  onClose,
  onImportRecords,
  onMassFillRecords,
  onReplaceDataRecords,
}: ReportImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [mode, setMode] = useState<ReportImportMode>('newRecords')
  const [templateDownloaded, setTemplateDownloaded] = useState(false)
  const [preview, setPreview] = useState<ReportImportPreview | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)

  if (!open) return null

  const templateFields = getReportImportTemplateFields(activeReport)
  const validCount = preview?.validRecords.length ?? 0
  const errorCount = preview?.errors.length ?? 0
  const deleteCount = preview?.validRecords.filter((record) => record.deleteRequested).length ?? 0
  const supportsExistingRowsImport = activeReport === 'weldingJournal'
  const modeCopy = getImportModeCopy(mode, activeReport)

  const handleDownloadTemplate = () => {
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
    setTemplateDownloaded(false)
    setPreview(null)
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
    setIsReading(true)
    setReadError(null)
    try {
      const nextPreview =
        mode === 'replaceData'
          ? await buildReportReplaceDataPreview({
              activeReport,
              file,
              rows,
              weldFormStampSelectOptions,
              welderStamps,
              welderStampSuspensions,
            })
          : mode === 'massFill'
          ? await buildReportMassFillPreview({
              activeReport,
              file,
              rows,
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
      setPreview(nextPreview)
    } catch (error) {
      setPreview(null)
      setReadError(error instanceof Error ? error.message : 'Не удалось прочитать файл импорта.')
    } finally {
      setIsReading(false)
    }
  }

  const handleImport = async () => {
    if (!preview || preview.validRecords.length === 0) return
    if (mode === 'replaceData') {
      await onReplaceDataRecords(preview.validRecords, preview.skippedRows)
    } else if (mode === 'massFill') {
      await onMassFillRecords(preview.validRecords, preview.skippedRows)
    } else {
      await onImportRecords(preview.validRecords, preview.skippedRows)
    }
    resetImportState()
    onClose()
  }

  const handleFixPreviewErrors = () => {
    if (mode !== 'newRecords' || !preview || preview.errors.length === 0) return
    setPreview(fixReportImportPreviewErrors(preview, {
      activeReport,
      weldFormStampSelectOptions,
      welderStamps,
      welderStampSuspensions,
    }))
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[1180px]" maxHeightClassName="max-h-[90vh]" overlayClassName="z-[90] bg-slate-950/35">
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
          {supportsExistingRowsImport ? (
            <ImportModeTab
              active={mode === 'massFill'}
              label="Массовое заполнение"
              onClick={() => handleModeChange('massFill')}
            />
          ) : null}
          {supportsExistingRowsImport ? (
            <ImportModeTab
              active={mode === 'replaceData'}
              label="Замена данных"
              onClick={() => handleModeChange('replaceData')}
            />
          ) : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.2fr]">
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
              <Button onClick={handleDownloadTemplate}>
                <Download className="mr-2 h-4 w-4" />
                Скачать шаблон
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={handleDownloadTemplate} className="text-muted-foreground">
                  <Download className="mr-2 h-4 w-4" />
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

        <TemplateColumnsOverview activeReport={activeReport} fields={templateFields} />

        {readError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{readError}</div>
        ) : null}

        {preview ? (
          <div className="grid min-h-[280px] gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="min-w-0 rounded-md border border-slate-200">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">Предпросмотр</div>
                  <div className="text-xs text-muted-foreground">
                    {preview.fileName} · найдено строк: {preview.records.length} · к импорту: {validCount}
                    {deleteCount ? ` · к удалению: ${deleteCount}` : ''}
                  </div>
                </div>
                {validCount ? (
                  <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {validCount}
                  </span>
                ) : null}
              </div>
              <div className="max-h-[360px] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-xs text-slate-600">
                    <tr>
                      {preview.fields.map((field) => (
                        <th key={field.key} className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold">
                          {field.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.records.slice(0, 20).map((record, index) => (
                      <tr key={`${index}-${String(record.joint ?? '')}`} className="odd:bg-white even:bg-slate-50/70">
                        {preview.fields.map((field) => (
                          <td key={field.key} className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-slate-700">
                            {formatPreviewValue(record[field.key as WeldFieldKey])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <div className="max-h-[360px] overflow-auto p-3">
                {preview.errors.length ? (
                  <div className="space-y-2">
                    {preview.errors.map((error) => (
                      <div key={`${error.rowNumber}-${error.title}`} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <div className="font-semibold">
                          Строка {error.rowNumber}: {error.title}
                        </div>
                        <div className="mt-1 text-xs leading-relaxed">{error.message}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    Проверочные ячейки прошли проверку.
                  </div>
                )}
              </div>
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
            ? `Будет импортировано: ${validCount}. ${deleteCount ? `Удалений: ${deleteCount}. ` : ''}Ошибок: ${errorCount}.`
            : 'Импорт начнется только после предпросмотра.'}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending || isReading}>
            Отмена
          </Button>
          <Button onClick={handleImport} disabled={!preview || validCount === 0 || isPending || isReading}>
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

function getImportModeCopy(mode: ReportImportMode, activeReport: ActiveReport) {
  if (mode === 'replaceData') {
    return {
      subtitle: 'редкий осторожный режим: скачайте текущие стыки, измените нужные разрешенные ячейки и загрузите файл для проверки.',
      templateText: 'В шаблоне уже будут текущие стыки. Серые ячейки системные и не меняются; желтые проверяются; белые заменяются без специальной проверки.',
      uploadText: 'После загрузки система сравнит файл с текущим журналом и подготовит только строки, где данные действительно изменились.',
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
    templateText:
      activeReport === 'weldingJournal'
        ? 'Серые ячейки игнорируются, желтые проверяются, белые можно заполнять свободно.'
        : 'В шаблоне остаются только колонки, нужные для выбранного отчета.',
    uploadText: 'После загрузки файл будет проверен. Ошибки можно очистить в предпросмотре без удаления строки.',
    previewText: 'Перед импортом можно увидеть найденные строки и список ошибок по проверочным ячейкам.',
    grayLegend: 'Не заполнять, импорт игнорирует',
    yellowLegend: 'Проверочные ячейки',
    whiteLegend: 'Свободный ввод',
  }
}

function ImportStepCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="rounded border border-slate-200 bg-slate-50 p-1 text-slate-500">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{text}</p>
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

function TemplateColumnsOverview({ activeReport, fields }: { activeReport: ActiveReport; fields: readonly WeldField[] }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 text-sm font-semibold">Колонки шаблона</div>
      <div className="flex max-h-24 flex-wrap gap-1 overflow-auto pr-1">
        {fields.map((field) => {
          const kind = getReportImportCellKind(activeReport, field.key)
          return (
            <span
              key={field.key}
              className={cn(
                'rounded border px-2 py-1 text-xs',
                kind === 'ignored' && 'border-slate-200 bg-slate-100 text-slate-500',
                kind === 'checked' && 'border-amber-200 bg-amber-50 text-amber-800',
                kind === 'free' && 'border-slate-200 bg-white text-slate-600',
              )}
            >
              {field.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function formatPreviewValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}
