import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileSpreadsheet, Layers3 } from 'lucide-react'

import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { useSecurityGuard } from '@/lib/security-context'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DocumentGenerationRequest } from '@/lib/document-generation'
import { previewGeneratedDocumentNamePattern } from '@/lib/generated-document-naming'
import {
  getWeldingJournalTemplateOptions,
  loadDocumentTemplate,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import { WELDING_JOURNAL_DOCUMENT_SPLIT_MODES } from '@/lib/welding-journal-document-splitting'
import {
  buildWeldingJournalGenerationPlan,
  formatWeldingJournalGenerationSuccess,
  getWeldingJournalRowsDateRange,
  prepareWeldingJournalDocumentRows,
  saveWeldingJournalGenerationPlan,
} from '@/lib/welding-journal-generation'
import { getGeneratedDocumentProfile } from '@/lib/generated-document-types'

export type WeldingJournalGenerationDialogProps = {
  request: DocumentGenerationRequest
  contextRows: WeldRow[]
  contextLoading?: boolean
  onClose: () => void
  onGenerated: (message: string) => void
}

export function WeldingJournalGenerationDialog({
  request,
  contextRows,
  contextLoading = false,
  onClose,
  onGenerated,
}: WeldingJournalGenerationDialogProps) {
  const { requireDocumentGenerationPassword } = useSecurityGuard()
  const documentProfile = getGeneratedDocumentProfile(request.type)
  const documentLabel = documentProfile.label
  const documentName = documentProfile.label
  const [template, setTemplate] = useState<StoredDocumentTemplate | null>(null)
  const [templateLoading, setTemplateLoading] = useState(true)
  const [manualTitle, setManualTitle] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dateRange = useMemo(() => getWeldingJournalRowsDateRange(request.rows), [request.rows])
  const options = useMemo(
    () =>
      getWeldingJournalTemplateOptions(
        template?.options?.[request.type],
      ),
    [
      request.type,
      template?.options?.checklist,
      template?.options?.weldingJournal,
      template?.options?.zni,
    ],
  )
  const effectiveContextRows = contextRows.length > 0 ? contextRows : request.rows
  const preparedRows = useMemo(
    () =>
      prepareWeldingJournalDocumentRows({
        sourceRows: request.rows,
        contextRows: effectiveContextRows,
        periodFrom: dateRange?.from ?? '',
        periodTo: dateRange?.to ?? '',
        options,
      }),
    [dateRange?.from, dateRange?.to, effectiveContextRows, options, request.rows],
  )
  const plan = useMemo(
    () =>
      buildWeldingJournalGenerationPlan({
        type: request.type,
        documentLabel,
        rows: preparedRows,
        template,
        options,
        periodFrom: dateRange?.from ?? '',
        periodTo: dateRange?.to ?? '',
        manualTitle,
      }),
    [dateRange?.from, dateRange?.to, documentLabel, manualTitle, options, preparedRows, request.type, template],
  )
  const splitModeLabel =
    WELDING_JOURNAL_DOCUMENT_SPLIT_MODES.find((mode) => mode.value === options.splitMode)?.label ?? 'Проект'
  const excludedCount = request.rows.length - preparedRows.length
  const activeRestrictions = [
    options.officialOnly ? 'только официальные' : null,
    options.goodOnly ? 'только годные' : null,
    options.actualOnly ? 'только актуальные' : null,
  ].filter((value): value is string => Boolean(value))
  const previewTitles = useMemo(
    () => plan.titles.map((title) => previewGeneratedDocumentNamePattern(title)),
    [plan.titles],
  )

  useEffect(() => {
    let active = true
    setTemplateLoading(true)
    setManualTitle('')
    setError(null)
    loadDocumentTemplate(request.type)
      .then((nextTemplate) => {
        if (active) setTemplate(nextTemplate ?? null)
      })
      .catch(() => {
        if (active) setTemplate(null)
      })
      .finally(() => {
        if (active) setTemplateLoading(false)
      })
    return () => {
      active = false
    }
  }, [request.id, request.type])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isGenerating) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isGenerating, onClose])

  const handleGenerate = async () => {
    if (plan.groups.length === 0 || isGenerating || contextLoading || templateLoading) return
    setIsGenerating(true)
    const accessGranted = await requireDocumentGenerationPassword(`формирование ${documentLabel}`)
    if (!accessGranted) {
      setIsGenerating(false)
      return
    }
    setError(null)
    try {
      const savedDocuments = await saveWeldingJournalGenerationPlan(plan)
      onGenerated(
        `${formatWeldingJournalGenerationSuccess(savedDocuments, previewTitles[0], documentLabel)} Стыков: ${preparedRows.length}.`,
      )
      onClose()
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : `Не удалось сформировать ${documentName}.`)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[760px]" maxHeightClassName="max-h-[86vh]" overlayClassName="z-[90] bg-slate-950/35">
      <DialogHeader
        title={`Формирование: ${documentLabel}`}
        subtitle={`Выбрано стыков: ${request.rows.length}. После формирования вы останетесь в сварочном журнале.`}
        onClose={() => {
          if (!isGenerating) onClose()
        }}
      />

      <div className="min-h-0 overflow-y-auto px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <GenerationStat label="Выбрано" value={request.rows.length} />
          <GenerationStat label={`Попадет в ${documentLabel}`} value={preparedRows.length} tone="teal" />
          <GenerationStat label="Будет документов" value={plan.groups.length} tone="blue" />
        </div>

        <div className="mt-4 rounded-md border border-[#cbdde6] bg-[#f5f9fb] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {templateLoading ? 'Загружаем шаблон' : template?.fileName ?? 'Системная форма'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-800">
              <Layers3 className="h-3.5 w-3.5" />
              Разделение: {splitModeLabel.toLocaleLowerCase('ru')}
            </span>
            {activeRestrictions.map((restriction) => (
              <span
                key={restriction}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600"
              >
                {restriction}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Используются общий шаблон, правило названия и ограничения из настроек документов.
          </p>
          {excludedCount > 0 ? (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Не попадут в {documentName}: {excludedCount}. Эти стыки исключены настройками шаблона или не имеют даты сварки.
            </p>
          ) : null}
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Название документа</span>
          <input
            value={manualTitle}
            onChange={(event) => setManualTitle(event.target.value.replace(/\s*\n+\s*/g, ' '))}
            placeholder={previewTitles[0] ?? 'Название по правилу конструктора'}
            className="mt-1.5 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Оставьте пустым, чтобы использовать автоматическое название из конструктора.
          </span>
        </label>

        {previewTitles.length > 0 ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Будут сформированы
            </div>
            <div className="max-h-40 divide-y divide-slate-100 overflow-y-auto">
              {previewTitles.map((title, index) => (
                <div key={`${title}:${index}`} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700">
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-slate-100 px-1 text-[11px] font-semibold text-slate-500">
                    {index + 1}
                  </span>
                  <span className="min-w-0 truncate" title={title}>{title}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400">
                    {plan.groups[index]?.length ?? 0} ст.
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {contextLoading || templateLoading ? (
          <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700">
            Подготавливаем данные для формирования...
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
        {!contextLoading && !templateLoading && preparedRows.length === 0 ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Среди выбранных строк нет стыков, которые можно включить в {documentName} по текущим настройкам.
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
        <Button type="button" variant="outline" onClick={onClose} disabled={isGenerating}>
          Отмена
        </Button>
        <Button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={plan.groups.length === 0 || isGenerating || contextLoading || templateLoading}
          className="min-w-40 gap-2 bg-[#17627d] text-white hover:bg-[#12536b] disabled:border disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100"
        >
          <FileSpreadsheet className="h-4 w-4" />
          {isGenerating
            ? 'Формирую'
            : plan.groups.length > 1
              ? `Сформировать (${plan.groups.length})`
              : 'Сформировать'}
        </Button>
      </div>
    </LargeDialogShell>
  )
}

function GenerationStat({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: number
  tone?: 'slate' | 'teal' | 'blue'
}) {
  const toneClassName = {
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
    teal: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    blue: 'border-sky-200 bg-sky-50 text-sky-900',
  }[tone]
  return (
    <div className={`rounded-md border px-3 py-2.5 ${toneClassName}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-60">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
