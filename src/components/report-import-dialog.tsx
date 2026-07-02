import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { getActiveReportTitle } from '@/lib/report-display-state'
import {
  buildImportTemplateXlsxBytes,
  getReportImportCellKind,
  getReportImportTemplateFilename,
  getReportImportTemplateFields,
} from '@/lib/report-import-template'
import { buildReportImportPreview, fixReportImportPreviewErrors, type ReportImportPreview } from '@/lib/report-import-preview'
import { cn } from '@/lib/utils'
import type { ActiveReport } from '@/lib/home-state'
import type { StampSelectOptionLike } from '@/lib/weld-journal-mutation-types'
import type { WeldField, WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export type ReportImportDialogProps = {
  open: boolean
  activeReport: ActiveReport
  isPending: boolean
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
  onClose: () => void
  onImportRecords: (records: WeldInput[], skippedRows: number) => Promise<void>
}

export function ReportImportDialog({
  open,
  activeReport,
  isPending,
  weldFormStampSelectOptions,
  welderStamps,
  onClose,
  onImportRecords,
}: ReportImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [templateDownloaded, setTemplateDownloaded] = useState(false)
  const [preview, setPreview] = useState<ReportImportPreview | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)

  if (!open) return null

  const templateFields = getReportImportTemplateFields(activeReport)
  const validCount = preview?.validRecords.length ?? 0
  const errorCount = preview?.errors.length ?? 0

  const handleDownloadTemplate = () => {
    const bytes = buildImportTemplateXlsxBytes(activeReport)
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = getReportImportTemplateFilename(activeReport)
    link.click()
    URL.revokeObjectURL(url)
    setTemplateDownloaded(true)
  }

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return
    setIsReading(true)
    setReadError(null)
    try {
      const nextPreview = await buildReportImportPreview({
        activeReport,
        file,
        weldFormStampSelectOptions,
        welderStamps,
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
    await onImportRecords(preview.validRecords, preview.skippedRows)
    setPreview(null)
    setReadError(null)
    setTemplateDownloaded(false)
    onClose()
  }

  const handleFixPreviewErrors = () => {
    if (!preview || preview.errors.length === 0) return
    setPreview(fixReportImportPreviewErrors(preview, {
      activeReport,
      weldFormStampSelectOptions,
      welderStamps,
    }))
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[1180px]" maxHeightClassName="max-h-[90vh]" overlayClassName="z-[90] bg-slate-950/35">
      <DialogHeader
        title="Импорт данных"
        subtitle={`${getActiveReportTitle(activeReport)} · сначала скачайте шаблон, затем загрузите заполненный файл для проверки.`}
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 py-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.2fr]">
          <ImportStepCard
            icon={<Download className="h-4 w-4" />}
            title="1. Шаблон"
            text="Серые ячейки игнорируются, желтые проверяются, белые можно заполнять свободно."
          />
          <ImportStepCard
            icon={<Upload className="h-4 w-4" />}
            title="2. Загрузка"
            text="После загрузки файл будет проверен. Ошибки можно очистить в предпросмотре без удаления строки."
          />
          <ImportStepCard
            icon={<FileSpreadsheet className="h-4 w-4" />}
            title="3. Предпросмотр"
            text="Перед импортом можно увидеть найденные строки и список ошибок по проверочным ячейкам."
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <LegendItem className="bg-slate-200" text="Не заполнять, импорт игнорирует" />
            <LegendItem className="bg-amber-100 ring-amber-200" text="Проверочные ячейки" />
            <LegendItem className="bg-white ring-slate-200" text="Свободный ввод" />
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
                            {formatPreviewValue(record[field.key])}
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
                  <div className="text-xs text-muted-foreground">Исправление очищает проблемные проверочные ячейки.</div>
                </div>
                {errorCount ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {errorCount}
                    </span>
                    <Button size="sm" variant="outline" onClick={handleFixPreviewErrors} disabled={isReading || isPending}>
                      Исправить ошибки
                    </Button>
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
          {preview ? `Будет импортировано: ${validCount}. Ошибок: ${errorCount}.` : 'Импорт начнется только после предпросмотра.'}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending || isReading}>
            Отмена
          </Button>
          <Button onClick={handleImport} disabled={!preview || validCount === 0 || isPending || isReading}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Импортировать {validCount ? `${validCount} строк` : ''}
          </Button>
        </div>
      </div>
    </LargeDialogShell>
  )
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
