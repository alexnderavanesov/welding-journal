import { ArrowRight, CheckCircle2, ExternalLink, FileText, ListTodo, Pencil, TriangleAlert } from 'lucide-react'

import {
  JointDispatcherTasksSummary,
} from '@/components/joint-dispatcher-tasks-panel'
import { Button } from '@/components/ui/button'
import { isControlCancelledValue } from '@/lib/control-availability-values'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import { formatDisplayDate } from '@/lib/date-format'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { buildJointNextActions, type JointNextAction } from '@/lib/joint-next-actions'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { getPreHeatTreatmentControls } from '@/lib/lnk-control-stage'
import { getLnkDisplayValue, isPstoNoNeed } from '@/lib/lnk-status'
import { PRE_HEAT_TREATMENT_REPORT_FIELDS } from '@/lib/pre-heat-treatment-report-fields'
import { buildPstoCycleTimeline, type PstoCycleSnapshot } from '@/lib/psto-cycle'
import {
  buildPrimaryPstoSystemDocumentRow,
  buildPstoRepeatSystemDocumentRow,
} from '@/lib/system-document-virtual-row'
import type { WeldFieldKey } from '@/lib/weld-fields'

type ReportTarget = 'weldingJournal' | 'lnk' | 'heatTreatment'

type JointHistoryOverviewProps = {
  row: WeldRow
  dispatcherTasks?: readonly RepeatedJointTask[]
  controlProcessSettings?: Pick<ControlProcessSettings, 'preHeatTreatmentLnkEnabled' | 'allowPrimaryLnkBeforePreviousStagesComplete'>
  onOpenDocument: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenReport: (row: WeldRow, report: ReportTarget) => void
  onShowInReport: (row: WeldRow) => void
  onEditRow: (row: WeldRow) => void
  onRunNextAction: (row: WeldRow, action: JointNextAction) => void
  onOpenTasks: () => void
}

export function JointHistoryOverview({
  row,
  dispatcherTasks = [],
  controlProcessSettings,
  onOpenDocument,
  onOpenReport,
  onShowInReport,
  onEditRow,
  onRunNextAction,
  onOpenTasks,
}: JointHistoryOverviewProps) {
  const preControls = getPreHeatTreatmentControls(row)
  const cycles = buildPstoCycleTimeline(row, row.pstoRepeatCycles ?? [])
  const pstoCancelled = isControlCancelledValue(row.pstoRequired)
  const nextActions = buildJointNextActions(row, dispatcherTasks, controlProcessSettings).slice(0, 1)
  const mainControls = LNK_METHODS.filter((method) => [
    row[method.enabledKey],
    row[method.requestKey],
    row[method.resultKey],
    row[method.conclusionKey],
  ].some(hasValue))
  const duplicateControls = row.duplicateControls ?? []
  const dispatcherTaskCodes = text(row.activeDispatcherTasks) || text(row.dispatcherTasks)

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {text(row.line) || '-'} · {text(row.joint) || '-'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Проект: {text(row.projectTitle) || '-'} · Шифр: {text(row.subtitleCode) || '-'}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <ReportButton label="Журнал" onClick={() => onOpenReport(row, 'weldingJournal')} />
          <ReportButton label="ЛНК" onClick={() => onOpenReport(row, 'lnk')} />
          <ReportButton label="ПСТО" onClick={() => onOpenReport(row, 'heatTreatment')} />
          <ReportButton label="Показать в отчете" onClick={() => onShowInReport(row)} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-8 gap-1.5 bg-white px-0 text-xs sm:w-auto sm:px-3"
            onClick={() => onEditRow(row)}
            aria-label="Редактировать"
            title="Редактировать стык"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Редактировать</span>
          </Button>
        </div>
      </div>

      <NextActionsPanel
        row={row}
        actions={nextActions}
        onRunNextAction={onRunNextAction}
      />

      <div className="divide-y divide-slate-200">
        <HistorySection title="Сварка">
          <HistoryLine
            label="Сварка"
            date={row.weldDate}
            value={`Официальность: ${text(row.officiality) || 'официальный'}`}
            secondary={`Итоговый статус: ${text(row.finalStatus) || '-'}`}
          />
        </HistorySection>

        <HistorySection title="НК до ТО" empty={preControls.length === 0}>
          {preControls.map((control) => {
            const requestField = getPreFieldKey(control.method, 'requestName')
            const resultField = getPreFieldKey(control.method, 'result')
            const conclusionField = getPreFieldKey(control.method, 'conclusionName')
            const result = resultField ? getLnkDisplayValue(row, resultField) : control.result
            return (
              <HistoryLine
                key={control.id}
                label={control.method}
                date={control.conclusionDate || control.requestDate}
                value={text(result) || (hasValue(control.requestName) ? 'ожидает НК' : 'ожидает заявку')}
                documents={[
                  createDocument(control.requestName, requestField, row),
                  createDocument(control.conclusionName, conclusionField, row),
                ]}
                onOpenDocument={onOpenDocument}
              />
            )
          })}
        </HistorySection>

        <HistorySection title="ПСТО и ТВМТ" empty={!pstoCancelled && cycles.length === 0}>
          {pstoCancelled ? (
            <HistoryLine
              label="Линия ПСТО"
              date={row.pstoCancellationDate}
              value="отменена"
            />
          ) : null}
          {cycles.map((cycle) => (
            <PstoCycleLine key={cycle.sequence} row={row} cycle={cycle} onOpenDocument={onOpenDocument} />
          ))}
        </HistorySection>

        <HistorySection title="Основной этап НК" empty={mainControls.length === 0}>
          {mainControls.map((method) => (
            <HistoryLine
              key={method.code}
              label={method.code}
              date={row[method.conclusionDateKey] || row[method.requestDateKey]}
              value={text(getLnkDisplayValue(row, method.resultKey)) || (hasValue(row[method.requestKey]) ? 'ожидает НК' : 'ожидает заявку')}
              documents={[
                createDocument(row[method.requestKey], method.requestKey, row),
                createDocument(row[method.conclusionKey], method.conclusionKey, row),
              ]}
              onOpenDocument={onOpenDocument}
            />
          ))}
        </HistorySection>

        <HistorySection title="Дубль-контроль" empty={duplicateControls.length === 0}>
          {duplicateControls.map((control) => (
            <HistoryLine
              key={control.id}
              label={control.method}
              date={control.conclusionDate || control.controlDate}
              value={control.result}
              secondary={text(control.conclusion) ? `Заключение: ${text(control.conclusion)}` : undefined}
            />
          ))}
        </HistorySection>

        <JointDispatcherTasksSummary
          row={row}
          tasks={dispatcherTasks}
          fallbackCodes={dispatcherTaskCodes}
          onOpen={onOpenTasks}
        />
      </div>
    </div>
  )
}

function NextActionsPanel({
  row,
  actions,
  onRunNextAction,
}: {
  row: WeldRow
  actions: JointNextAction[]
  onRunNextAction: JointHistoryOverviewProps['onRunNextAction']
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
        <ListTodo className="h-4 w-4 text-sky-700" />
        <h3 className="text-sm font-semibold text-slate-900">Что дальше</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {actions.map((action) => {
          const buttonLabel = action.kind === 'dispatcherTask'
            ? action.taskActionLabel ?? action.buttonLabel
            : action.buttonLabel
          const Icon = action.tone === 'success'
            ? CheckCircle2
            : action.tone === 'warning'
              ? TriangleAlert
              : ArrowRight
          return (
            <div key={action.key} className="flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${getNextActionIconClass(action.tone)}`} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{action.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-600">{action.description}</p>
                </div>
              </div>
              {buttonLabel ? (
                <Button
                  type="button"
                  size="sm"
                  variant={action.tone === 'warning' ? 'outline' : 'default'}
                  className={action.tone === 'warning'
                    ? 'h-8 shrink-0 border-amber-300 bg-amber-50 text-xs font-semibold text-amber-900 hover:bg-amber-100'
                    : 'h-8 shrink-0 gap-1.5 text-xs'}
                  onClick={() => onRunNextAction(row, action)}
                >
                  {buttonLabel}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function getNextActionIconClass(tone: JointNextAction['tone']) {
  if (tone === 'success') return 'text-emerald-600'
  if (tone === 'warning') return 'text-amber-600'
  return 'text-sky-700'
}

function PstoCycleLine({
  row,
  cycle,
  onOpenDocument,
}: {
  row: WeldRow
  cycle: PstoCycleSnapshot
  onOpenDocument: JointHistoryOverviewProps['onOpenDocument']
}) {
  const repeat = cycle.source === 'repeat'
    ? row.pstoRepeatCycles?.find((candidate) => candidate.sequence === cycle.sequence)
    : null
  const documentRow = repeat
    ? buildPstoRepeatSystemDocumentRow(row, repeat)
    : buildPrimaryPstoSystemDocumentRow(row)
  const workflowValue = isPstoNoNeed(row, cycle.pstoResult)
    ? 'нет потребности'
    : text(cycle.tvmtResult)
    ? `ТВМТ: ${text(cycle.tvmtResult)}`
    : text(cycle.pstoResult)
      ? `ПСТО: ${text(cycle.pstoResult)} · ТВМТ ожидается`
      : text(cycle.pstoRequest)
        ? 'ожидает ПСТО'
        : 'ожидает заявку ПСТО'

  return (
    <HistoryLine
      label={`Цикл ${cycle.sequence}`}
      date={cycle.tvmtConclusionDate || cycle.pstoDate || cycle.pstoRequestDate}
      value={workflowValue}
      secondary={text(cycle.pstoNote) || undefined}
      documents={[
        createDocument(cycle.pstoRequest, 'pstoRequest', documentRow),
        createDocument(cycle.heatTreatmentDiagram, 'heatTreatmentDiagram', documentRow),
        createDocument(cycle.tvmtRequest, 'tvmtRequest', documentRow),
        createDocument(cycle.tvmtConclusion, 'tvmtConclusion', documentRow),
      ]}
      onOpenDocument={onOpenDocument}
    />
  )
}

function HistorySection({
  title,
  empty = false,
  children,
}: {
  title: string
  empty?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="py-3">
      <h3 className="text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {empty ? <p className="py-2 text-sm text-slate-400">Нет данных</p> : <div className="mt-1">{children}</div>}
    </section>
  )
}

type DocumentTarget = { name: string; fieldKey: WeldFieldKey; row: WeldRow } | null

function HistoryLine({
  label,
  date,
  value,
  secondary,
  documents = [],
  onOpenDocument,
}: {
  label: string
  date?: unknown
  value: string
  secondary?: string
  documents?: DocumentTarget[]
  onOpenDocument?: JointHistoryOverviewProps['onOpenDocument']
}) {
  const visibleDocuments = documents.filter((document): document is NonNullable<DocumentTarget> => Boolean(document))
  return (
    <div className="grid gap-2 border-b border-slate-100 py-2 last:border-b-0 md:grid-cols-[88px_minmax(0,1fr)]">
      <div className="flex items-start gap-2">
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">{label}</span>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getResultClass(value)}`}>{value}</span>
          {hasValue(date) ? <span className="text-xs text-slate-500">{formatDisplayDate(date)}</span> : null}
        </div>
        {secondary ? <p className="mt-1 text-xs text-slate-500">{secondary}</p> : null}
        {visibleDocuments.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {visibleDocuments.map((document) => (
              <button
                key={`${document.fieldKey}:${document.name}`}
                type="button"
                onClick={() => onOpenDocument?.(document.row, document.fieldKey)}
                className="inline-flex max-w-full items-center gap-1 text-left text-xs font-medium text-sky-700 hover:text-sky-900 hover:underline"
                title={document.name}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{document.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ReportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 bg-white text-xs" onClick={onClick}>
      <ExternalLink className="h-3.5 w-3.5" />
      {label}
    </Button>
  )
}

function createDocument(value: unknown, fieldKey: WeldFieldKey | null, row: WeldRow): DocumentTarget {
  const name = text(value)
  return name && fieldKey ? { name, fieldKey, row } : null
}

function getPreFieldKey(methodCode: string, valueKey: 'requestName' | 'result' | 'conclusionName') {
  return PRE_HEAT_TREATMENT_REPORT_FIELDS.find(
    (field) => field.methodCode === methodCode && field.valueKey === valueKey,
  )?.fieldKey ?? null
}

function getResultClass(value: string) {
  const normalized = value.toLocaleLowerCase('ru-RU')
  if (normalized.includes('не годен') || normalized.includes('ремонт') || normalized.includes('вырез')) {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }
  if (normalized.includes('ожида')) return 'border-amber-200 bg-amber-50 text-amber-800'
  if (normalized.includes('годен') || normalized.includes('проведено')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function hasValue(value: unknown) {
  return text(value).length > 0
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
