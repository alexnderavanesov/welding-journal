import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FlaskConical,
  Gauge,
  LineChart,
  Percent,
  Settings2,
  TimerReset,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogHeader } from '@/components/dialog-header'
import { Input } from '@/components/ui/input'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import type { WeldRow } from '@/lib/dispatcher-types'
import { formatDisplayDate } from '@/lib/date-format'
import { isUnofficialJoint } from '@/lib/joint-display'
import { parseJointChainName } from '@/lib/joint-chain'
import { getConfiguredBaseJointType } from '@/lib/system-index-settings'
import {
  buildStatisticsSummary,
  formatPercent,
  formatStatisticValue,
  getDefaultStatisticsPeriod,
  type StatisticsMethodSummary,
  type StatisticsPeriodMode,
  type StatisticsUnit,
} from '@/lib/statistics-summary'
import { buildLineSummary, type LineSummaryRow } from '@/lib/line-summary'
import {
  buildPercentageLineSummaries,
  type PercentageControlMethod,
  type PercentageLineStampSummary,
} from '@/lib/percentage-line-summary'
import {
  buildWelderStatisticsSummary,
  type WelderStatisticsJointFilter,
  type WelderStatisticsRow,
} from '@/lib/welder-statistics-summary'
import { buildWeldingDynamics, type WeldingDynamicsSummary } from '@/lib/welding-dynamics'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import type { PercentageLineStampFilter } from '@/lib/report-navigation'
import { isAdditionalControlValue, isCancelledControlValue, isEnabledControlValue } from '@/lib/report-value-utils'
import { cn } from '@/lib/utils'
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'
import { calculateFinalStatus, CONTROL_RESULT_PAIRS, formatFinalStatusDisplay, normalizeResultStatus } from '@/lib/weld-status'

type StatisticsPageProps = {
  fixedTab?: StatisticsTab
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  onAssignPercentageLineMissingControls?: (rowIds: number[], method: PercentageControlMethod) => Promise<void> | void
  onCancelPercentageLineMissingControls?: (rowIds: number[]) => Promise<void> | void
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
  onOpenWeldRowIds?: (rowIds: number[], message?: string) => void
}

type StatisticsTab = 'general' | 'lnk' | 'welders' | 'lineSummary' | 'percentageLines'

const jointFilterOptions: Array<[WelderStatisticsJointFilter, string]> = [
  ['all', 'Все'],
  ['f', 'F поле'],
  ['s', 'S база'],
]

export function StatisticsPage({
  fixedTab,
  rows,
  welderStamps,
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  onOpenPercentageLineStampRows,
  onOpenWeldRowIds,
}: StatisticsPageProps) {
  const defaultPeriod = useMemo(() => getDefaultStatisticsPeriod(), [])
  const [selectedTab, setSelectedTab] = useState<StatisticsTab>(fixedTab ?? 'general')
  const activeTab = fixedTab ?? selectedTab
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [period, setPeriod] = useState(defaultPeriod)
  const [allPeriod, setAllPeriod] = useState(false)
  const [generalUnit, setGeneralUnit] = useState<StatisticsUnit>('wdi')
  const [weldersUnit, setWeldersUnit] = useState<StatisticsUnit>('joints')
  const [lineSummaryUnit, setLineSummaryUnit] = useState<StatisticsUnit>('joints')
  const [generalJointFilter, setGeneralJointFilter] = useState<WelderStatisticsJointFilter>('all')
  const [welderJointFilter, setWelderJointFilter] = useState<WelderStatisticsJointFilter>('all')
  const [periodMode, setPeriodMode] = useState<StatisticsPeriodMode>('events')
  const [projectFilter, setProjectFilter] = useState('')
  const [selectedSubtitles, setSelectedSubtitles] = useState<string[]>([])
  const isGeneralLikeTab = activeTab === 'general' || activeTab === 'lnk'
  const unit = activeTab === 'welders' ? weldersUnit : activeTab === 'lineSummary' ? lineSummaryUnit : generalUnit
  const setUnit = activeTab === 'welders' ? setWeldersUnit : activeTab === 'lineSummary' ? setLineSummaryUnit : setGeneralUnit
  const jointFilter = activeTab === 'welders' ? welderJointFilter : generalJointFilter
  const setJointFilter = activeTab === 'welders' ? setWelderJointFilter : setGeneralJointFilter

  const projectOptions = useMemo(() => getUniqueSortedValues(rows.map((row) => row.projectTitle)), [rows])
  const subtitleOptions = useMemo(
    () =>
      getUniqueSortedValues(
        rows
          .filter((row) => !projectFilter || normalizeFilterValue(row.projectTitle) === projectFilter)
          .map((row) => row.subtitleCode),
      ),
    [projectFilter, rows],
  )
  const scopedRows = useMemo(
    () =>
      rows.filter((row) => {
        const project = normalizeFilterValue(row.projectTitle)
        const subtitle = normalizeFilterValue(row.subtitleCode)
        const projectMatches = !projectFilter || project === projectFilter
        const subtitleMatches = selectedSubtitles.length === 0 || selectedSubtitles.includes(subtitle)
        return projectMatches && subtitleMatches
      }),
    [projectFilter, rows, selectedSubtitles],
  )
  const periodFrom = allPeriod ? '' : period.from
  const periodTo = allPeriod ? '' : period.to
  const generalRows = useMemo(
    () => scopedRows.filter((row) => matchesStatisticsJointFilter(row, generalJointFilter)),
    [generalJointFilter, scopedRows],
  )
  const summary = useMemo(
    () => buildStatisticsSummary(generalRows, periodFrom, periodTo, unit, periodMode),
    [generalRows, periodFrom, periodTo, periodMode, unit],
  )
  const weldingDynamics = useMemo(
    () => buildWeldingDynamics(summary.periodRows, periodFrom, periodTo, unit),
    [periodFrom, periodTo, summary.periodRows, unit],
  )
  const welderSummary = useMemo(
    () => buildWelderStatisticsSummary(scopedRows, welderStamps, periodFrom, periodTo, weldersUnit, welderJointFilter),
    [periodFrom, periodTo, scopedRows, welderJointFilter, welderStamps, weldersUnit],
  )
  const lineSummary = useMemo(
    () => buildLineSummary(scopedRows, lineSummaryUnit),
    [lineSummaryUnit, scopedRows],
  )
  const percentageLineSummary = useMemo(() => buildPercentageLineSummaries(scopedRows), [scopedRows])
  const generalProgressSummary = useMemo(
    () => buildLineSummary(generalRows, unit),
    [generalRows, unit],
  )
  const orderedMethods = useMemo(() => {
    const methodsByCode = new Map([...summary.methods, summary.pstoMethod].map((method) => [method.code, method]))
    return ['ВИК', 'РК', 'УЗК', 'ПВК', 'ПСТО', 'ТВМТ', 'РФА', 'СТЛС', 'МКК']
      .map((code) => methodsByCode.get(code))
      .filter((method): method is StatisticsMethodSummary => Boolean(method))
  }, [summary.methods, summary.pstoMethod])
  const lnkMethods = useMemo(() => orderedMethods.filter((method) => method.code !== 'ПСТО'), [orderedMethods])
  const unofficialRows = useMemo(() => summary.periodRows.filter(isUnofficialJoint), [summary.periodRows])
  const unofficialCount = unofficialRows.length
  const unofficialValue = sumStatisticRows(unofficialRows, unit)
  const lnkWaitingRequests = summary.methods.reduce((total, method) => total + method.waitingRequest, 0)
  const unitLabel = unit === 'joints' ? 'стыков' : 'WDI'
  const scopeLabel = getScopeLabel(projectFilter, selectedSubtitles, projectOptions, subtitleOptions)
  const periodModeDescription =
    periodMode === 'events'
      ? 'Заявки считаются по дате создания, ЛНК по дате контроля, ПСТО по дате ПСТО, сварка по дате сварки.'
      : 'Все блоки показывают текущее состояние стыков, сваренных в выбранный период.'
  return (
    <section className="w-full max-w-full min-w-0 space-y-4 pb-8">
      <div className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {!fixedTab ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-9 rounded-md"
                  size="sm"
                  variant={activeTab === 'general' ? 'default' : 'outline'}
                  onClick={() => setSelectedTab('general')}
                >
                  Общая
                </Button>
                <Button
                  className="h-9 rounded-md"
                  size="sm"
                  variant={activeTab === 'lnk' ? 'default' : 'outline'}
                  onClick={() => setSelectedTab('lnk')}
                >
                  ЛНК и ПСТО
                </Button>
                <Button
                  className="h-9 rounded-md"
                  size="sm"
                  variant={activeTab === 'welders' ? 'default' : 'outline'}
                  onClick={() => setSelectedTab('welders')}
                >
                  Сварщики
                </Button>
                <Button
                  className="h-9 rounded-md"
                  size="sm"
                  variant={activeTab === 'lineSummary' ? 'default' : 'outline'}
                  onClick={() => setSelectedTab('lineSummary')}
                >
                  Полинейная сводка
                </Button>
              </div>
            ) : null}
            <p className="mt-3 text-sm text-slate-500">
              {activeTab === 'lnk'
                ? 'Сводка по заявкам, заключениям, результатам ЛНК и ПСТО за выбранный период.'
                : activeTab === 'general'
                  ? 'Общий прогресс сварки, заявок, заключений и ПСТО за выбранный период.'
                : activeTab === 'welders'
                  ? 'Вклад сварщиков по фактическим клеймам за выбранный период сварки.'
                  : activeTab === 'lineSummary'
                    ? 'Сводка по линиям с учетом актуальных стыков и текущего остатка.'
                    : 'Контроль процентных линий по официальным клеймам и РК/УЗК.'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {activeTab === 'lnk'
                ? 'ЛНК и ПСТО разделены по группам: виды НК отдельно, ПСТО отдельно. Неофициальные стыки показаны отдельным счетчиком.'
                : activeTab === 'general'
                  ? periodModeDescription
                : activeTab === 'welders'
                  ? 'Статистика сварщиков считается по дате сварки стыка; распределение идет только по фактическим клеймам.'
                  : activeTab === 'lineSummary'
                    ? 'Неактуальные по изменению строки и исторические стыки цепочки до годного результата не включаются.'
                    : 'Процентная линия определяется как линия с единым % контроля меньше 100; расчет идет отдельно по каждому официальному клейму.'}
            </p>
          </div>

          <div className="flex flex-1 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-2 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Settings2 className="h-4 w-4 text-slate-400" />
              {settingsOpen ? 'Скрыть настройки' : 'Настройки отчета'}
            </Button>
          </div>
        </div>

        {settingsOpen ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 pb-3">
              {activeTab !== 'lineSummary' && activeTab !== 'percentageLines' ? (
                <div className="grid gap-1 text-xs font-medium text-slate-600">
                  Период
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white/80 p-1">
                    <Input
                      aria-label="Период с"
                      type="date"
                      value={period.from}
                      onChange={(event) => {
                        setAllPeriod(false)
                        setPeriod((current) => ({ ...current, from: event.target.value }))
                      }}
                      className="h-8 w-[128px] border-slate-200 text-sm"
                    />
                    <span className="text-slate-400">-</span>
                    <Input
                      aria-label="Период по"
                      type="date"
                      value={period.to}
                      onChange={(event) => {
                        setAllPeriod(false)
                        setPeriod((current) => ({ ...current, to: event.target.value }))
                      }}
                      className="h-8 w-[128px] border-slate-200 text-sm"
                    />
                    <button
                      type="button"
                      className={segmentButtonClass(allPeriod)}
                      onClick={() => {
                        setAllPeriod(true)
                        setPeriod({ from: '', to: '' })
                      }}
                    >
                      За весь период
                    </button>
                  </div>
                </div>
              ) : null}
              {activeTab !== 'percentageLines' ? (
                <div className="grid gap-1 text-xs font-medium text-slate-600">
                  Единица
                  <div className="inline-flex rounded-md border border-slate-200 bg-white/80 p-1">
                    <button
                      type="button"
                      className={segmentButtonClass(unit === 'joints')}
                      onClick={() => setUnit('joints')}
                    >
                      Стыки
                    </button>
                    <button
                      type="button"
                      className={segmentButtonClass(unit === 'wdi')}
                      onClick={() => setUnit('wdi')}
                    >
                      WDI
                    </button>
                  </div>
                </div>
              ) : null}
              {activeTab !== 'lineSummary' && activeTab !== 'percentageLines' ? (
                <div className="grid gap-1 text-xs font-medium text-slate-600">
                  Тип стыка
                  <div className="inline-flex rounded-md border border-slate-200 bg-white/80 p-1">
                    {jointFilterOptions.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={segmentButtonClass(jointFilter === value)}
                        onClick={() => setJointFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {isGeneralLikeTab ? (
                <div className="grid gap-1 text-xs font-medium text-slate-600">
                  Расчет периода
                  <div className="inline-flex rounded-md border border-slate-200 bg-white/80 p-1">
                    <button
                      type="button"
                      className={segmentButtonClass(periodMode === 'events')}
                      onClick={() => setPeriodMode('events')}
                      title="Заявки по дате создания, ЛНК по дате контроля, ПСТО по дате ПСТО, сварка по дате сварки"
                    >
                      События
                    </button>
                    <button
                      type="button"
                      className={segmentButtonClass(periodMode === 'welded-joints')}
                      onClick={() => setPeriodMode('welded-joints')}
                      title="Что происходит со стыками, сваренными в выбранный период"
                    >
                      Стыки периода
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="grid min-w-[220px] gap-1 text-xs font-medium text-slate-600">
                Проект
                <select
                  value={projectFilter}
                  onChange={(event) => {
                    setProjectFilter(event.target.value)
                    setSelectedSubtitles([])
                  }}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">Все проекты</option>
                  {projectOptions.map((project) => (
                    <option key={project.value} value={project.value}>
                      {project.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="min-w-0 flex-1 basis-[420px]">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs font-medium text-slate-600">
                  <span>Шифр/подтитул</span>
                  {selectedSubtitles.length > 0 ? (
                    <button
                      type="button"
                      className="text-sky-700 hover:text-sky-900"
                      onClick={() => setSelectedSubtitles([])}
                    >
                      Сбросить шифры
                    </button>
                  ) : null}
                </div>
                <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                  {subtitleOptions.length > 0 ? (
                    subtitleOptions.map((subtitle) => {
                      const selected = selectedSubtitles.includes(subtitle.value)
                      return (
                        <button
                          key={subtitle.value}
                          type="button"
                          className={cn(
                            'rounded border px-2.5 py-1 text-sm transition-colors',
                            selected
                              ? 'border-sky-300 bg-sky-50 text-sky-800'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                          )}
                          onClick={() =>
                            setSelectedSubtitles((current) =>
                              current.includes(subtitle.value)
                                ? current.filter((value) => value !== subtitle.value)
                                : [...current, subtitle.value],
                            )
                          }
                        >
                          {subtitle.label}
                        </button>
                      )
                    })
                  ) : (
                    <span className="text-sm text-slate-400">Шифры не найдены</span>
                  )}
                </div>
              </div>

              <div className="grid min-w-[220px] gap-1 text-xs font-medium text-slate-600">
                Срез
                <div className="flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-600 shadow-sm">
                  <span className="truncate">{scopeLabel}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {activeTab === 'general' ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              compact
              icon={ClipboardCheck}
              label="Выполнено"
              value={formatPercent(generalProgressSummary.total > 0 ? (generalProgressSummary.completed / generalProgressSummary.total) * 100 : 0)}
              detail={`${formatStatisticValue(generalProgressSummary.completed, unit)} из ${formatStatisticValue(generalProgressSummary.total, unit)}`}
              accent="green"
            />
            <MetricCard
              compact
              icon={Gauge}
              label="Годность"
              value={formatPercent(summary.qualityPercent)}
              detail={`${formatStatisticValue(summary.good, unit)} годен · ${formatStatisticValue(summary.rejected, unit)} не годен`}
              accent="green"
            />
            <MetricCard
              compact
              icon={TimerReset}
              label={`В смену, ${unit === 'wdi' ? 'WDI' : 'стыков'}`}
              value={formatAverageStatisticValue(weldingDynamics.periodDays > 0 ? weldingDynamics.totalValue / weldingDynamics.periodDays : 0)}
              detail={`${formatStatisticValue(weldingDynamics.totalValue, unit)} за ${weldingDynamics.periodDays} дн.`}
              accent="amber"
            />
            <MetricCard
              compact
              icon={Users}
              label="Количество сварщиков"
              value={formatStatisticValue(weldingDynamics.totalWelders, 'joints')}
              detail="Уникальные фактические клейма за период"
              accent="indigo"
            />
            <MetricCard
              compact
              icon={Activity}
              label="Сварено за период"
              value={formatStatisticValue(summary.welded, unit)}
              detail={`${formatPercent(summary.weldedShare)} от общего количества`}
              accent="blue"
            />
          </div>

          <WeldingDynamicsPanel summary={weldingDynamics} unit={unit} />

          <Panel
            title="Состояние стыков"
            subtitle={`В срезе ${formatStatisticValue(summary.totalRows, unit)} ${unitLabel}; сварено всего ${formatStatisticValue(summary.welded, unit)}, из них ремонтов ${formatStatisticValue(summary.completedRepairs, unit)}.`}
          >
            <SegmentedProgress
              unit={unit}
              items={[
                { label: 'Годен', value: summary.good, className: 'bg-emerald-500' },
                { label: 'Не годен', value: summary.rejected, className: 'bg-rose-500' },
                { label: 'Ожидает НК', value: summary.waitingControl, className: 'bg-amber-400' },
                { label: 'Ожидает заявку', value: summary.waitingRequest, className: 'bg-sky-400' },
                { label: 'Ожидает ремонт', value: summary.waitingRepair, className: 'bg-orange-400' },
              ]}
            />
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              <StatusLine label="Годен" value={summary.good} unit={unit} />
              <StatusLine label="Не годен" value={summary.rejected} unit={unit} />
              <StatusLine label="Ожидает заявку" value={summary.waitingRequest} unit={unit} />
              <StatusLine label="Ожидает НК" value={summary.waitingControl} unit={unit} />
              <StatusLine label="Ожидает ремонт" value={summary.waitingRepair} unit={unit} />
              <StatusLine label="Ожидает сварку" value={summary.waitingWeld} unit={unit} />
            </div>
          </Panel>
        </>
      ) : activeTab === 'lnk' ? (
        <LnkPstoStatisticsPanel
          lnkMethods={lnkMethods}
          lnkWaitingRequests={lnkWaitingRequests}
          summary={summary}
          unofficialCount={unofficialCount}
          unofficialValue={unofficialValue}
          unit={unit}
          unitLabel={unitLabel}
        />
      ) : activeTab === 'welders' ? (
        <WeldersStatisticsPanel
          jointFilter={welderJointFilter}
          summary={welderSummary}
          unit={unit}
        />
      ) : activeTab === 'percentageLines' ? (
        <PercentageLinesPanel
          onAssignPercentageLineMissingControls={onAssignPercentageLineMissingControls}
          onCancelPercentageLineMissingControls={onCancelPercentageLineMissingControls}
          rows={scopedRows}
          summary={percentageLineSummary}
          onOpenPercentageLineStampRows={onOpenPercentageLineStampRows}
          onOpenWeldRowIds={onOpenWeldRowIds}
        />
      ) : (
        <LineSummaryPanel summary={lineSummary} unit={lineSummaryUnit} />
      )}
    </section>
  )
}

type MetricCardProps = {
  compact?: boolean
  wrapDetail?: boolean
  icon: typeof Activity
  label: string
  value: string
  detail: string
  accent: 'blue' | 'green' | 'indigo' | 'amber' | 'slate'
}

function MetricCard({ compact = false, wrapDetail = false, icon: Icon, label, value, detail, accent }: MetricCardProps) {
  const accentClass = {
    blue: 'bg-sky-50 text-sky-700 border-sky-100',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  }[accent]

  return (
    <div className={cn('rounded-md border border-slate-200 bg-white', compact ? 'p-3' : 'p-4')}>
      <div className={cn('flex items-center', compact ? 'gap-2.5' : 'gap-3')}>
        <span className={cn('flex items-center justify-center rounded-md border', compact ? 'h-9 w-9' : 'h-10 w-10', accentClass)}>
          <Icon className={cn(compact ? 'h-4 w-4' : 'h-5 w-5')} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm text-slate-500">{label}</div>
          <div className={cn('font-semibold tracking-tight text-slate-900', compact ? 'text-xl' : 'text-2xl')}>{value}</div>
        </div>
      </div>
      <div
        className={cn('text-sm text-slate-500', compact ? 'mt-2' : 'mt-3', wrapDetail ? 'leading-snug' : 'truncate')}
        title={detail}
      >
        {detail}
      </div>
    </div>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        <LineChart className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
      </div>
      {children}
    </section>
  )
}

function WeldingDynamicsPanel({ summary, unit }: { summary: WeldingDynamicsSummary; unit: StatisticsUnit }) {
  const unitLabel = unit === 'wdi' ? 'WDI' : 'стыков'
  const maxValue = Math.max(1, summary.peakValue)
  const maxWelders = Math.max(1, summary.peakWelders)
  const chartMinWidth = Math.max(720, summary.buckets.length * 58)
  const bucketText = getWeldingDynamicsBucketText(summary.bucketUnitLabel)

  return (
    <Panel
      title="Динамика сварки"
      subtitle={`Интервал: ${bucketText}. Столбики показывают ${unitLabel}, точки - количество сварщиков по фактическим клеймам.`}
    >
      {summary.buckets.length > 0 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
            <StatusLine label={`Всего за период, ${unitLabel}`} value={summary.totalValue} unit={unit} />
            <StatusLine label="Сварщиков по факту" value={summary.totalWelders} unit="joints" />
            <StatusLine label={`Пик за ${summary.bucketUnitLabel}, ${unitLabel}`} value={summary.peakValue} unit={unit} />
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-5 rounded-sm bg-sky-500" />
                {unitLabel}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full border border-indigo-200 bg-indigo-600" />
                сварщики по фактическим клеймам
              </span>
            </div>
            <div className="overflow-x-auto pb-3">
              <div
                className="grid min-h-[246px] items-end gap-2"
                style={{ gridTemplateColumns: `repeat(${summary.buckets.length}, minmax(44px, 1fr))`, minWidth: chartMinWidth }}
              >
                {summary.buckets.map((bucket) => {
                  const valuePercent = bucket.value > 0 ? Math.max(6, (bucket.value / maxValue) * 100) : 0
                  const welderPercent = bucket.welderCount > 0 ? Math.max(8, (bucket.welderCount / maxWelders) * 100) : 0
                  const title = `${bucket.label}: ${formatStatisticValue(bucket.value, unit)} ${unitLabel}; сварщиков ${bucket.welderCount}`

                  return (
                    <div key={bucket.key} className="flex min-w-0 flex-col items-center gap-2" title={title}>
                      <div className="relative h-36 w-full rounded-md border border-slate-200 bg-white">
                        <div className="absolute inset-x-0 top-1/3 border-t border-dashed border-slate-100" />
                        <div className="absolute inset-x-0 top-2/3 border-t border-dashed border-slate-100" />
                        <div
                          className="absolute bottom-0 left-1/2 w-7 -translate-x-1/2 rounded-t-md bg-sky-500/80 shadow-sm"
                          style={{ height: `${valuePercent}%` }}
                        />
                        {bucket.welderCount > 0 ? (
                          <span
                            className="absolute left-1/2 z-10 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-indigo-600 shadow"
                            style={{ bottom: `calc(${welderPercent}% - 6px)` }}
                          />
                        ) : null}
                      </div>
                      <div className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-center shadow-sm">
                        <div className="truncate text-[11px] font-semibold text-slate-800">{bucket.shortLabel}</div>
                        <div className="mt-0.5 truncate text-[11px] font-semibold text-sky-700">{formatStatisticValue(bucket.value, unit)}</div>
                        <div className="truncate text-[10px] font-medium text-indigo-600">{bucket.welderCount} св.</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          В выбранном периоде нет строк с датой сварки.
        </div>
      )}
    </Panel>
  )
}

function SegmentedProgress({
  items,
  unit,
}: {
  items: Array<{ label: string; value: number; className: string }>
  unit: StatisticsUnit
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  return (
    <>
      <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
        {items.map((item) => (
          <div
            key={item.label}
            className={item.className}
            style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%` }}
            title={`${item.label}: ${item.value}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
            <span className={cn('h-2 w-2 rounded-full', item.className)} />
            {item.label}: <span className="font-medium text-slate-800">{formatStatisticValue(item.value, unit)}</span>
          </span>
        ))}
      </div>
    </>
  )
}

function StatusLine({ label, value, unit }: { label: string; value: number; unit: StatisticsUnit }) {
  return (
    <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-slate-800">{formatStatisticValue(value, unit)}</div>
    </div>
  )
}

function MethodQueueCard({
  description,
  getValue,
  methods,
  title,
  tone,
  unit,
}: {
  description: string
  getValue: (method: StatisticsMethodSummary) => number
  methods: StatisticsMethodSummary[]
  title: string
  tone: 'amber' | 'sky'
  unit: StatisticsUnit
}) {
  const total = methods.reduce((sum, method) => sum + getValue(method), 0)
  const activeClass =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-sky-200 bg-sky-50 text-sky-900'
  const totalClass =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-100 text-amber-900'
      : 'border-sky-200 bg-sky-100 text-sky-900'

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-800">{title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{description}</div>
        </div>
        <span className={cn('shrink-0 rounded border px-2 py-1 text-xs font-semibold', totalClass)}>
          {formatStatisticValue(total, unit)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {methods.map((method) => {
          const value = getValue(method)
          return (
            <div
              key={method.code}
              className={cn(
                'flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs',
                value > 0 ? activeClass : 'border-slate-100 bg-slate-50 text-slate-400',
              )}
            >
              <span className="font-semibold">{method.code}</span>
              <span className="font-medium">{formatStatisticValue(value, unit)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LnkPstoStatisticsPanel({
  lnkMethods,
  lnkWaitingRequests,
  summary,
  unofficialCount,
  unofficialValue,
  unit,
  unitLabel,
}: {
  lnkMethods: StatisticsMethodSummary[]
  lnkWaitingRequests: number
  summary: ReturnType<typeof buildStatisticsSummary>
  unofficialCount: number
  unofficialValue: number
  unit: StatisticsUnit
  unitLabel: string
}) {
  const unofficialDetail =
    unit === 'wdi'
      ? `Неофициальные стыки: ${unofficialCount} шт. · ${formatStatisticValue(unofficialValue, unit)} WDI`
      : `Неофициальные стыки: ${unofficialCount} шт.`

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard
          compact
          icon={Gauge}
          label="Годность"
          value={formatPercent(summary.qualityPercent)}
          detail={`${formatStatisticValue(summary.good, unit)} годен · ${formatStatisticValue(summary.rejected, unit)} не годен`}
          accent="green"
        />
        <MetricCard
          compact
          icon={ClipboardCheck}
          label="ЛНК закрыто"
          value={formatPercent(summary.lnkClosurePercent)}
          detail={`${formatStatisticValue(summary.lnkClosed, unit)} из ${formatStatisticValue(summary.lnkRequests, unit)} заявок · всего результатов ${formatStatisticValue(summary.lnkTotalClosed, unit)}`}
          accent="indigo"
        />
        <MetricCard
          compact
          icon={TimerReset}
          label="ПСТО закрыто"
          value={formatPercent(summary.pstoClosurePercent)}
          detail={`${formatStatisticValue(summary.pstoClosed, unit)} из ${formatStatisticValue(summary.pstoRequests, unit)} заявок · всего результатов ${formatStatisticValue(summary.pstoTotalClosed, unit)}`}
          accent="amber"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[0.95fr_1.45fr]">
        <div className="space-y-4">
          <Panel
            title="Заявки и результаты"
            subtitle="Сколько заявок уже закрыто заключениями и сколько позиций еще ожидает заявку."
          >
            <ProgressRow
              label="ЛНК"
              closed={summary.lnkClosed}
              total={summary.lnkRequests}
              totalClosed={summary.lnkTotalClosed}
              waitingRequest={lnkWaitingRequests}
              unit={unit}
            />
            <ProgressRow
              label="ПСТО"
              closed={summary.pstoClosed}
              total={summary.pstoRequests}
              totalClosed={summary.pstoTotalClosed}
              waitingRequest={summary.pstoMethod.waitingRequest}
              unit={unit}
            />
          </Panel>

          <Panel
            title="Состояние стыков"
            subtitle={`В срезе ${formatStatisticValue(summary.totalRows, unit)} ${unitLabel}; ${unofficialDetail}.`}
          >
            <SegmentedProgress
              unit={unit}
              items={[
                { label: 'Годен', value: summary.good, className: 'bg-emerald-500' },
                { label: 'Не годен', value: summary.rejected, className: 'bg-rose-500' },
                { label: 'Ожидает НК', value: summary.waitingControl, className: 'bg-amber-400' },
                { label: 'Ожидает заявку', value: summary.waitingRequest, className: 'bg-sky-400' },
                { label: 'Ожидает ремонт', value: summary.waitingRepair, className: 'bg-orange-400' },
              ]}
            />
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <StatusLine label="Годен" value={summary.good} unit={unit} />
              <StatusLine label="Не годен" value={summary.rejected} unit={unit} />
              <StatusLine label="Ожидает заявку" value={summary.waitingRequest} unit={unit} />
              <StatusLine label="Ожидает НК" value={summary.waitingControl} unit={unit} />
              <StatusLine label="Ожидает ремонт" value={summary.waitingRepair} unit={unit} />
              <StatusLine label="Неофициальные" value={unofficialCount} unit="joints" />
            </div>
          </Panel>

          <Panel
            title="ПСТО"
          >
            <MethodProgress method={summary.pstoMethod} unit={unit} />
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel
            title="Очереди ЛНК по видам НК"
            subtitle="Быстрый список, где нужно создать заявку и где заявка уже есть, но заключение еще не внесено."
          >
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <MethodQueueCard
                title="Без заявки, но контроль нужен"
                description="В журнале по виду НК стоит “да” или “дополнительный”, а заявки еще нет."
                getValue={(method) => method.waitingRequest}
                methods={lnkMethods}
                tone="amber"
                unit={unit}
              />
              <MethodQueueCard
                title="Есть заявка, нет заключения"
                description="Заявка уже создана, но результат/заключение по виду НК еще не внесены."
                getValue={(method) => method.waitingControl}
                methods={lnkMethods}
                tone="sky"
                unit={unit}
              />
            </div>
          </Panel>

          <Panel
            title="ЛНК по видам контроля"
            subtitle="По каждому виду НК видно: сколько заявок подано за период, сколько закрыто, сколько еще ожидает результат."
          >
            <div className="space-y-2">
              {lnkMethods.map((method) => (
                <MethodProgress key={method.code} method={method} unit={unit} />
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function ProgressRow({
  label,
  closed,
  total,
  totalClosed,
  waitingRequest,
  unit,
}: {
  label: string
  closed: number
  total: number
  totalClosed: number
  waitingRequest: number
  unit: StatisticsUnit
}) {
  const percent = total > 0 ? (closed / total) * 100 : 0
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">
          заявок: {formatStatisticValue(total, unit)}, в т.ч. закрыто: {formatStatisticValue(closed, unit)} · ожидает:{' '}
          {formatStatisticValue(waitingRequest, unit)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-slate-800" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Всего результатов: {formatStatisticValue(totalClosed, unit)}
      </div>
    </div>
  )
}

function MethodProgress({ method, unit }: { method: StatisticsMethodSummary; unit: StatisticsUnit }) {
  const isPsto = method.code === 'ПСТО'
  const positiveLabel = isPsto ? 'проведено' : 'годен'
  const waitingControlLabel = isPsto ? 'ожидает ПСТО' : 'ожидает НК'
  return (
    <div className="grid grid-cols-1 items-center gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 xl:grid-cols-[72px_1fr_170px]">
      <div className="inline-flex w-fit items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-700">
        <FlaskConical className="h-3.5 w-3.5 text-slate-400" />
        {method.code}
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>Закрыто по заявкам {formatPercent(method.closurePercent)}</span>
          <span>заявок {formatStatisticValue(method.requests, unit)} · закрыто {formatStatisticValue(method.closed, unit)}</span>
        </div>
        <div className="h-2 rounded-full bg-white">
          <div className="h-2 rounded-full bg-sky-500" style={{ width: `${method.closurePercent}%` }} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>Всего результатов: {formatStatisticValue(method.totalClosed, unit)}</span>
          {method.waitingControl > 0 ? (
            <span>{waitingControlLabel}: {formatStatisticValue(method.waitingControl, unit)}</span>
          ) : null}
          {method.waitingRequest > 0 ? (
            <span>ожидает заявку: {formatStatisticValue(method.waitingRequest, unit)}</span>
          ) : null}
        </div>
      </div>
      <div className="text-left text-xs text-slate-500 xl:text-right">
        <div>{positiveLabel}: <span className="font-medium text-emerald-700">{formatStatisticValue(method.good, unit)}</span></div>
        {!isPsto ? (
          <div>не годен: <span className="font-medium text-rose-700">{formatStatisticValue(method.rejected, unit)}</span></div>
        ) : null}
        <div>заявок: <span className="font-medium text-slate-700">{formatStatisticValue(method.requests, unit)}</span></div>
      </div>
    </div>
  )
}

function WeldersStatisticsPanel({
  jointFilter,
  summary,
  unit,
}: {
  jointFilter: WelderStatisticsJointFilter
  summary: ReturnType<typeof buildWelderStatisticsSummary>
  unit: StatisticsUnit
}) {
  const controlled = summary.good + summary.rejected
  const [stampSearch, setStampSearch] = useState('')
  const filteredRows = useMemo(() => {
    const query = stampSearch.trim().toLowerCase()
    if (!query) return summary.rows
    return summary.rows.filter((row) => row.stamp.toLowerCase().includes(query) || row.welderName.toLowerCase().includes(query))
  }, [stampSearch, summary.rows])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
        <MetricCard
          icon={Users}
          label="Сварщиков в срезе"
          value={String(summary.totalWelders)}
          detail={`Всего работ: ${formatStatisticValue(summary.total, unit)} ${unit === 'joints' ? 'стыков' : 'WDI'}`}
          accent="blue"
        />
        <MetricCard
          icon={Activity}
          label="Годные стыки"
          value={formatStatisticValue(summary.good, unit)}
          detail={`Ожидает заявку: ${formatStatisticValue(summary.waitingRequest, unit)} · ожидает НК: ${formatStatisticValue(summary.waitingControl, unit)}`}
          accent="green"
        />
        <MetricCard
          icon={Gauge}
          label="% брака"
          value={formatPercent(summary.defectPercent)}
          detail={`${formatStatisticValue(summary.rejected, unit)} не годен из ${formatStatisticValue(controlled, unit)} проконтролированных`}
          accent="amber"
        />
        <MetricCard
          icon={ClipboardCheck}
          label="Проконтролировано"
          value={formatStatisticValue(controlled, unit)}
          detail="Годные + негодные стыки по фактическим клеймам"
          accent="indigo"
        />
      </div>

      <Panel
        title="Отчет по сварщикам"
        subtitle="Считаются только фактические клейма. Если у внутреннего клейма есть связанное клеймо НАКС, в отчете показывается НАКС."
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <label className="grid w-full max-w-sm gap-1 text-xs font-medium text-slate-600">
            Поиск клейма или ФИО
            <Input
              value={stampSearch}
              onChange={(event) => setStampSearch(event.target.value)}
              placeholder="Клеймо НАКС, внутреннее или ФИО"
              className="h-9 rounded-md border-slate-200 bg-white text-sm"
            />
          </label>
          {stampSearch.trim() ? (
            <Button variant="outline" size="sm" className="h-9 rounded-md" onClick={() => setStampSearch('')}>
              Очистить поиск
            </Button>
          ) : null}
        </div>
        {summary.rows.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
                <colgroup>
                  {Array.from({ length: 7 }).map((_, index) => (
                    <col key={index} className="w-[14.285%]" />
                  ))}
                </colgroup>
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <WelderHeaderCell>Клеймо</WelderHeaderCell>
                    <WelderHeaderCell align="right">Всего</WelderHeaderCell>
                    <WelderHeaderCell align="right">Годен</WelderHeaderCell>
                    <WelderHeaderCell align="right">Ожидает заявку</WelderHeaderCell>
                    <WelderHeaderCell align="right">Ожидает НК</WelderHeaderCell>
                    <WelderHeaderCell align="right">Не годен</WelderHeaderCell>
                    <WelderHeaderCell align="right">% брака</WelderHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <WelderStatisticsTableRow key={row.stamp} jointFilter={jointFilter} row={row} unit={unit} />
                  ))}
                </tbody>
              </table>
              {filteredRows.length === 0 ? (
                <div className="border-t border-slate-100 bg-slate-50 p-5 text-sm text-slate-500">
                  По этому клейму или ФИО ничего не найдено.
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            За выбранный период нет стыков с заполненными фактическими клеймами.
          </div>
        )}
      </Panel>
    </div>
  )
}

function WelderStatisticsTableRow({
  jointFilter,
  row,
  unit,
}: {
  jointFilter: WelderStatisticsJointFilter
  row: WelderStatisticsRow
  unit: StatisticsUnit
}) {
  const controlled = row.good + row.rejected
  return (
    <tr className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
      <td className="px-4 py-3">
        <div className="font-semibold text-slate-900">{row.stamp}</div>
        {row.welderName ? <div className="mt-1 text-xs font-medium leading-4 text-slate-500">{row.welderName}</div> : null}
      </td>
      <WelderBodyCell>
        <WelderValueWithSplit
          f={row.fTotal}
          jointFilter={jointFilter}
          s={row.sTotal}
          total={row.total}
          unit={unit}
        />
      </WelderBodyCell>
      <WelderBodyCell className="text-emerald-700">
        <WelderValueWithSplit
          f={row.fGood}
          jointFilter={jointFilter}
          s={row.sGood}
          total={row.good}
          unit={unit}
        />
      </WelderBodyCell>
      <WelderBodyCell>
        <WelderValueWithSplit
          f={row.fWaitingRequest}
          jointFilter={jointFilter}
          s={row.sWaitingRequest}
          total={row.waitingRequest}
          unit={unit}
        />
      </WelderBodyCell>
      <WelderBodyCell>
        <WelderValueWithSplit
          f={row.fWaitingControl}
          jointFilter={jointFilter}
          s={row.sWaitingControl}
          total={row.waitingControl}
          unit={unit}
        />
      </WelderBodyCell>
      <WelderBodyCell className="text-rose-700">
        <WelderValueWithSplit
          f={row.fRejected}
          jointFilter={jointFilter}
          s={row.sRejected}
          total={row.rejected}
          unit={unit}
        />
      </WelderBodyCell>
      <WelderBodyCell>
        <div className="flex items-center justify-end gap-2">
          <span>{formatPercent(row.defectPercent)}</span>
          <span className="text-xs font-normal text-slate-400">из {formatStatisticValue(controlled, unit)}</span>
        </div>
      </WelderBodyCell>
    </tr>
  )
}

function WelderValueWithSplit({
  f,
  jointFilter,
  s,
  total,
  unit,
}: {
  f: number
  jointFilter: WelderStatisticsJointFilter
  s: number
  total: number
  unit: StatisticsUnit
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span>{formatStatisticValue(total, unit)}</span>
      {jointFilter === 'all' ? (
        <span className="flex flex-wrap justify-end gap-1 text-[11px] font-normal text-slate-500">
          <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5">F: {formatStatisticValue(f, unit)}</span>
          <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5">S: {formatStatisticValue(s, unit)}</span>
        </span>
      ) : null}
    </div>
  )
}

function WelderHeaderCell({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('px-4 py-3 font-semibold', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>
}

function WelderBodyCell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 text-right font-medium text-slate-700', className)}>{children}</td>
}

function PercentageLinesPanel({
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  rows,
  summary,
  onOpenPercentageLineStampRows,
  onOpenWeldRowIds,
}: {
  onAssignPercentageLineMissingControls?: (rowIds: number[], method: PercentageControlMethod) => Promise<void> | void
  onCancelPercentageLineMissingControls?: (rowIds: number[]) => Promise<void> | void
  rows: WeldRow[]
  summary: ReturnType<typeof buildPercentageLineSummaries>
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
  onOpenWeldRowIds?: (rowIds: number[], message?: string) => void
}) {
  const [search, setSearch] = useState('')
  const [collapsedLineKeys, setCollapsedLineKeys] = useState<Set<string>>(() => new Set())
  const [detailDialog, setDetailDialog] = useState<PercentageLineJointDetailDialogState | null>(null)
  const [assignMissingDialog, setAssignMissingDialog] = useState<PercentageLineAssignMissingDialogState | null>(null)
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const detailRows = useMemo(
    () => (detailDialog ? detailDialog.rowIds.map((rowId) => rowsById.get(rowId)).filter((row): row is WeldRow => Boolean(row)) : []),
    [detailDialog, rowsById],
  )
  const flatRows = useMemo(
    () =>
      summary.flatMap((line) =>
        line.stamps.map((stamp) => ({
          line,
          stamp,
        })),
      ),
    [summary],
  )
  const filteredSummary = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return summary

    return summary.flatMap((line) => {
      const lineMatches =
        line.line.toLowerCase().includes(query) ||
        line.projectTitle.toLowerCase().includes(query) ||
        line.subtitleCode.toLowerCase().includes(query)

      if (lineMatches) return [line]

      const stamps = line.stamps.filter((stamp) => stamp.stamp.toLowerCase().includes(query))
      return stamps.length > 0 ? [{ ...line, stamps }] : []
    })
  }, [search, summary])
  const totals = useMemo(
    () =>
      flatRows.reduce(
        (result, { stamp }) => ({
          stamps: result.stamps + 1,
          required: result.required + stamp.requiredControls,
          assigned: result.assigned + stamp.assignedControls,
          additionalAssigned: result.additionalAssigned + stamp.additionalAssignedControls,
          cancelledAssigned: result.cancelledAssigned + stamp.cancelledAssignedControls,
          covered: result.covered + stamp.coveredControls,
          rejectedCovered: result.rejectedCovered + stamp.rejectedCoveredControls,
          completed: result.completed + stamp.completedControls,
          missing: result.missing + stamp.missingControls,
          excess: result.excess + stamp.excessControls,
          fullControl: result.fullControl + (stamp.fullControlRequired ? 1 : 0),
        }),
        {
          stamps: 0,
          required: 0,
          assigned: 0,
          additionalAssigned: 0,
          cancelledAssigned: 0,
          covered: 0,
          rejectedCovered: 0,
          completed: 0,
          missing: 0,
          excess: 0,
          fullControl: 0,
        },
      ),
    [flatRows],
  )
  const toggleLine = (lineKey: string) => {
    setCollapsedLineKeys((current) => {
      const next = new Set(current)
      if (next.has(lineKey)) next.delete(lineKey)
      else next.add(lineKey)
      return next
    })
  }
  const openRowsInWeldingJournal = (rowIds: number[], messageText?: string) => {
    if (rowIds.length === 0) return
    onOpenWeldRowIds?.(rowIds, messageText)
    setDetailDialog(null)
    setAssignMissingDialog(null)
  }
  const assignMissingControls = async (rowIds: number[], method: PercentageControlMethod) => {
    await onAssignPercentageLineMissingControls?.(rowIds, method)
    setAssignMissingDialog(null)
  }
  const closeMissingControlsByCancellation = async (rowIds: number[]) => {
    await onCancelPercentageLineMissingControls?.(rowIds)
    setAssignMissingDialog(null)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Percent}
          label="Процентных линий"
          value={String(summary.length)}
          detail={`${totals.stamps} клейм в расчете`}
          accent="blue"
        />
        <MetricCard
          icon={ClipboardCheck}
          label="Требуется контроля"
          value={String(totals.required)}
          detail={`Всего назначено ${totals.assigned}${formatAssignedBreakdown(totals.additionalAssigned, totals.cancelledAssigned)} · закрыто расчетом ${totals.covered}${totals.rejectedCovered > 0 ? ` · недоступно из-за брака ${totals.rejectedCovered}` : ''}`}
          accent="green"
          wrapDetail
        />
        <MetricCard
          icon={TimerReset}
          label="Осталось закрыть"
          value={String(totals.missing)}
          detail="РК/УЗК еще нужно закрыть по расчету"
          accent="amber"
        />
        <MetricCard
          icon={Gauge}
          label="100% по клейму"
          value={String(totals.fullControl)}
          detail={totals.excess > 0 ? `Лишнее “да”: ${totals.excess}` : 'Без лишних “да”'}
          accent={totals.fullControl > 0 ? 'amber' : 'slate'}
        />
      </div>

      <Panel
        title="Процентные линии"
        subtitle="Расчет идет по официальным клеймам на линиях с единым процентом контроля меньше 100. РК и УЗК считаются взаимозаменяемыми."
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <label className="grid w-full max-w-sm gap-1 text-xs font-medium text-slate-600">
            Поиск по линии или клейму
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Линия, проект, шифр или клеймо"
              className="h-9 rounded-md border-slate-200 bg-white text-sm"
            />
          </label>
          {search.trim() ? (
            <Button variant="outline" size="sm" className="h-9 rounded-md" onClick={() => setSearch('')}>
              Очистить поиск
            </Button>
          ) : null}
        </div>

        {flatRows.length > 0 ? (
          <div className="space-y-3">
            {filteredSummary.map((line) => (
              <PercentageLineGroup
                key={line.lineKey}
                onAssignMissing={
                  onAssignPercentageLineMissingControls || onCancelPercentageLineMissingControls ? setAssignMissingDialog : undefined
                }
                collapsed={collapsedLineKeys.has(line.lineKey)}
                line={line}
                onOpenDetail={setDetailDialog}
                onOpenStamp={onOpenPercentageLineStampRows}
                onToggle={() => toggleLine(line.lineKey)}
              />
            ))}
            {filteredSummary.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                По этому запросу процентные линии не найдены.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            В выбранном срезе нет процентных линий: нужны линии с единым процентом контроля меньше 100.
          </div>
        )}
      </Panel>
      {detailDialog ? (
        <PercentageLineJointDetailDialog
          detail={detailDialog}
          rows={detailRows}
          onClose={() => setDetailDialog(null)}
          onOpenRows={openRowsInWeldingJournal}
        />
      ) : null}
      {assignMissingDialog ? (
        <PercentageLineAssignMissingDialog
          detail={assignMissingDialog}
          assignmentRows={assignMissingDialog.rowIds.map((rowId) => rowsById.get(rowId)).filter((row): row is WeldRow => Boolean(row))}
          cancellationRows={assignMissingDialog.cancellationRowIds
            .map((rowId) => rowsById.get(rowId))
            .filter((row): row is WeldRow => Boolean(row))}
          onClose={() => setAssignMissingDialog(null)}
          onOpenRows={openRowsInWeldingJournal}
          onCancelSave={closeMissingControlsByCancellation}
          onSave={assignMissingControls}
        />
      ) : null}
    </div>
  )
}

type PercentageLineJointDetailDialogState = {
  rowIds: number[]
  subtitle: string
  title: string
}

type PercentageLineAssignMissingDialogState = PercentageLineJointDetailDialogState & {
  cancellationRowIds: number[]
  missingControls: number
}

type PercentageLineMissingControlAction = PercentageControlMethod | 'отмена'

function PercentageLineJointDetailDialog({
  detail,
  onClose,
  onOpenRows,
  rows,
}: {
  detail: PercentageLineJointDetailDialogState
  onClose: () => void
  onOpenRows: (rowIds: number[], message?: string) => void
  rows: WeldRow[]
}) {
  useWindowEscapeKey(
    true,
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    },
    { capture: true },
  )

  const openAll = () => {
    onOpenRows(rows.map((row) => row.id), `Показаны стыки: ${detail.title.toLowerCase()} (${rows.length}).`)
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[720px]" maxHeightClassName="max-h-[86vh]" overlayClassName="z-[80] bg-slate-950/25">
      <DialogHeader
        title={detail.title}
        subtitle={`${detail.subtitle} · стыков: ${rows.length}`}
        onClose={onClose}
        actions={
          rows.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={openAll}>
              Показать все
            </Button>
          ) : null
        }
      />
      <div className="overflow-y-auto p-4">
        {rows.length > 0 ? (
          <div className="space-y-2">
            {rows.map((row) => (
              <PercentageLineJointDetailRow key={row.id} row={row} onOpenRows={onOpenRows} />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            Стыки не найдены. Возможно, данные уже изменились.
          </div>
        )}
      </div>
      <div className="flex justify-end border-t border-slate-200/80 px-4 py-3">
        <Button type="button" variant="outline" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </LargeDialogShell>
  )
}

function PercentageLineAssignMissingDialog({
  assignmentRows,
  cancellationRows,
  detail,
  onClose,
  onCancelSave,
  onOpenRows,
  onSave,
}: {
  assignmentRows: WeldRow[]
  cancellationRows: WeldRow[]
  detail: PercentageLineAssignMissingDialogState
  onClose: () => void
  onCancelSave: (rowIds: number[]) => Promise<void> | void
  onOpenRows: (rowIds: number[], message?: string) => void
  onSave: (rowIds: number[], method: PercentageControlMethod) => Promise<void> | void
}) {
  const selectableCount = Math.max(1, detail.missingControls)
  const [action, setAction] = useState<PercentageLineMissingControlAction>('РК')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const activeRows = action === 'отмена' ? cancellationRows : assignmentRows
  const selectedRows = activeRows.filter((row) => selectedIds.has(row.id))
  const isSelectionFull = selectedIds.size >= selectableCount
  const actionTitle = action === 'отмена' ? 'закрытия недобора отменой РК/УЗК' : `назначения ${action} по процентной линии`
  const actionHintClassName =
    action === 'отмена'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : action === 'РК'
        ? 'border-sky-100 bg-sky-50 text-sky-900'
        : 'border-indigo-100 bg-indigo-50 text-indigo-900'
  const actionHint =
    action === 'отмена' ? (
      <>
        Выберите стыки, по которым расчетный РК/УЗК сознательно не выполняется. Система проставит{' '}
        <span className="font-semibold">РК = отменен</span> и <span className="font-semibold">УЗК = отменен</span>, и эти
        стыки закроют недобор процентной линии.
      </>
    ) : (
      <>
        Выберите актуальные официальные стыки без РК/УЗК, без закрытия расчетом и без негодного результата. Система
        проставит <span className="font-semibold">{action}</span> как назначенный контроль по процентной линии.
      </>
    )

  useWindowEscapeKey(
    true,
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    },
    { capture: true },
  )

  useEffect(() => {
    setSelectedIds(new Set())
    setSaveError('')
  }, [action])

  const toggleRow = (rowId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else if (next.size < selectableCount) {
        next.add(rowId)
      }
      return next
    })
  }
  const openSelected = () => {
    if (selectedRows.length === 0) return
    onOpenRows(
      selectedRows.map((row) => row.id),
      `Показаны стыки для ${actionTitle} (${selectedRows.length}).`,
    )
  }
  const saveSelected = async () => {
    if (selectedIds.size === 0) return
    setIsSaving(true)
    setSaveError('')
    try {
      if (action === 'отмена') {
        await onCancelSave(Array.from(selectedIds))
      } else {
        await onSave(Array.from(selectedIds), action)
      }
    } catch (error) {
      setSaveError((error as Error).message || 'Не удалось сохранить назначение РК/УЗК')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[760px]" maxHeightClassName="max-h-[86vh]" overlayClassName="z-[85] bg-slate-950/25">
      <DialogHeader
        title="Назначить РК/УЗК"
        subtitle={`${detail.subtitle} · нужно закрыть: ${detail.missingControls}`}
        onClose={onClose}
        actions={
          selectedRows.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={openSelected}>
              Показать выбранные
            </Button>
          ) : null
        }
      />
      <div className="space-y-3 overflow-y-auto p-4">
        <div className={cn('rounded-md border px-3 py-2 text-sm transition-colors', actionHintClassName)}>
          {actionHint}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Действие</span>
          {(['РК', 'УЗК', 'отмена'] as PercentageLineMissingControlAction[]).map((option) => (
            <button
              key={option}
              type="button"
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                action === option
                  ? 'border-sky-300 bg-sky-50 text-sky-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50',
              )}
              onClick={() => setAction(option)}
              disabled={isSaving}
            >
              {option === 'отмена' ? 'Отмена' : option}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500">
          Выберите стыки вручную. Можно выбрать не больше {detail.missingControls}.
        </div>
        {saveError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</div>
        ) : null}
        {activeRows.length > 0 ? (
          <div className="space-y-2">
            {activeRows.map((row) => {
              const checked = selectedIds.has(row.id)
              const disabled = !checked && isSelectionFull
              return (
                <label
                  key={row.id}
                  className={cn(
                    'block rounded-md border bg-white p-3 transition-colors',
                    checked ? 'border-sky-200 bg-sky-50' : 'border-slate-200',
                    disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:border-sky-200',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleRow(row.id)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <div className="min-w-0 flex-1">
                      <PercentageLineJointSummary row={row} />
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            Кандидаты для выбранного действия не найдены. Проверьте расчет линии или выберите другое действие.
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200/80 px-4 py-3">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          Отмена
        </Button>
        <Button type="button" onClick={saveSelected} disabled={selectedIds.size === 0 || isSaving}>
          {isSaving ? 'Сохранение...' : action === 'отмена' ? `Проставить отмену (${selectedIds.size})` : `Назначить ${action} (${selectedIds.size})`}
        </Button>
      </div>
    </LargeDialogShell>
  )
}

function PercentageLineJointDetailRow({
  onOpenRows,
  row,
}: {
  onOpenRows: (rowIds: number[], message?: string) => void
  row: WeldRow
}) {
  const badges = getPercentageLineJointBadges(row)
  const finalStatusLabel = formatFinalStatusDisplay(row, calculateFinalStatus(row))

  return (
    <button
      type="button"
      className="w-full rounded-md border border-slate-200 bg-white p-3 text-left transition-colors hover:border-sky-200 hover:bg-sky-50"
      onClick={() =>
        onOpenRows([row.id], `Показан стык ${String(row.joint ?? row.id).trim() || row.id} из расшифровки процентной линии.`)
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">{String(row.joint ?? '').trim() || `#${row.id}`}</span>
        <span className={getPercentageLineFinalStatusBadgeClassName(finalStatusLabel)}>{finalStatusLabel}</span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {String(row.projectTitle ?? '').trim() || '-'} · {String(row.subtitleCode ?? '').trim() || '-'} · {String(row.line ?? '').trim() || '-'}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Спул: {String(row.spool ?? '').trim() || '-'} · Диаметр: {String(row.diameter ?? '').trim() || '-'} · Дата сварки:{' '}
        {formatDisplayDate(row.weldDate) || '-'}
      </div>
      {badges.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <span key={badge.text} className={getPercentageLineJointBadgeClassName(badge.tone)}>
              {badge.text}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  )
}

function PercentageLineJointSummary({ row }: { row: WeldRow }) {
  const badges = getPercentageLineJointBadges(row)
  const finalStatusLabel = formatFinalStatusDisplay(row, calculateFinalStatus(row))

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">{String(row.joint ?? '').trim() || `#${row.id}`}</span>
        <span className={getPercentageLineFinalStatusBadgeClassName(finalStatusLabel)}>{finalStatusLabel}</span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {String(row.projectTitle ?? '').trim() || '-'} · {String(row.subtitleCode ?? '').trim() || '-'} · {String(row.line ?? '').trim() || '-'}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Спул: {String(row.spool ?? '').trim() || '-'} · Диаметр: {String(row.diameter ?? '').trim() || '-'} · Дата сварки:{' '}
        {formatDisplayDate(row.weldDate) || '-'}
      </div>
      {badges.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <span key={badge.text} className={getPercentageLineJointBadgeClassName(badge.tone)}>
              {badge.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PercentageLineGroup({
  collapsed,
  line,
  onAssignMissing,
  onOpenDetail,
  onOpenStamp,
  onToggle,
}: {
  collapsed: boolean
  line: ReturnType<typeof buildPercentageLineSummaries>[number]
  onAssignMissing?: (detail: PercentageLineAssignMissingDialogState) => void
  onOpenDetail?: (detail: PercentageLineJointDetailDialogState) => void
  onOpenStamp?: (filter: PercentageLineStampFilter) => void
  onToggle: () => void
}) {
  const totals = line.stamps.reduce(
    (result, stamp) => ({
      required: result.required + stamp.requiredControls,
      assigned: result.assigned + stamp.assignedControls,
      additionalAssigned: result.additionalAssigned + stamp.additionalAssignedControls,
      cancelledAssigned: result.cancelledAssigned + stamp.cancelledAssignedControls,
      covered: result.covered + stamp.coveredControls,
      rejectedCovered: result.rejectedCovered + stamp.rejectedCoveredControls,
      completed: result.completed + stamp.completedControls,
      missing: result.missing + stamp.missingControls,
      excess: result.excess + stamp.excessControls,
      fullControl: result.fullControl + (stamp.fullControlRequired ? 1 : 0),
    }),
    {
      required: 0,
      assigned: 0,
      additionalAssigned: 0,
      cancelledAssigned: 0,
      covered: 0,
      rejectedCovered: 0,
      completed: 0,
      missing: 0,
      excess: 0,
      fullControl: 0,
    },
  )
  const lineHint =
    `${line.line}: ${line.percent}% контроля считается отдельно по каждому официальному клейму. ` +
    `Расчет по проценту: max(1, округление вверх от количества официальных стыков клейма * ${line.percent}%). ` +
    `Если первичный стык не годен по РК/УЗК, включая дубль РК/УЗК: ${line.percent === 1 ? '+1 стык к РК/УЗК' : '+2 стыка к РК/УЗК'}. ` +
    'После 4-го первичного негодного результата РК/УЗК требуется 100% РК/УЗК по этому клейму.'
  const allAcceptedAndClosed =
    totals.missing === 0 &&
    line.stamps.length > 0 &&
    line.stamps.every((stamp) => stamp.rejectedJoints === 0 && stamp.waitingRequestJoints === 0 && stamp.waitingControlJoints === 0)

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-white transition-colors',
        allAcceptedAndClosed
          ? 'border-emerald-300 bg-emerald-50/10'
          : totals.missing > 0 || totals.excess > 0
            ? 'border-amber-300 bg-amber-50/20'
            : 'border-slate-200',
      )}
    >
      <div className="flex flex-wrap items-stretch gap-3 px-3 py-3">
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
          onClick={onToggle}
          title={collapsed ? 'Раскрыть клейма линии' : 'Свернуть клейма линии'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <div className="min-w-[260px] flex-1" title={lineHint}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-slate-900">{line.line}</span>
            <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
              {line.percent}% РК/УЗК
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {line.projectTitle} · {line.subtitleCode}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            расчет отдельно по каждому официальному клейму
          </div>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <PercentageLineSummaryPill
            label="Клейм"
            value={line.stamps.length}
            title="Количество официальных клейм, которые участвовали в сварке этой процентной линии."
          />
          <PercentageLineSummaryPill
            label="Требуется"
            value={totals.required}
            title="Сколько стыков нужно закрыть РК/УЗК: базовый процент плюс добор после первичных негодных результатов РК/УЗК, включая дубль РК/УЗК."
          />
          <PercentageLineSummaryPill
            label="Закрыто"
            value={totals.covered}
            title="Стыки, которые закрывают обязательный расчет РК/УЗК: обычное «да», выполненный результат РК/УЗК, осознанная отмена РК+УЗК или уже известный негодный результат по любому контролю."
          />
          <PercentageLineSummaryPill
            label="Осталось"
            value={totals.missing}
            tone={totals.missing > 0 ? 'amber' : 'slate'}
            title="Сколько расчетных стыков еще нужно закрыть РК/УЗК."
          />
          <PercentageLineSummaryPill
            label="Лишнее"
            value={totals.excess}
            tone={totals.excess > 0 ? 'rose' : 'slate'}
            title="Обычные назначения «да» сверх расчетной потребности. «Дополнительный» сюда не попадает."
          />
        </div>
      </div>

      {!collapsed ? (
        <div className="border-t border-slate-100 text-sm">
          <div className="hidden grid-cols-[1.1fr_0.7fr_1.2fr_1.2fr_1.2fr_1.1fr] bg-slate-100 text-slate-700 2xl:grid">
            <PercentageLineGridHeader>Клеймо</PercentageLineGridHeader>
            <PercentageLineGridHeader
              align="right"
              title="Сварено = официальные активные стыки этого клейма на процентной линии. Неофициальные, неактуальные по изм. и строки без даты сварки не учитываются."
            >
              Сварено
            </PercentageLineGridHeader>
            <PercentageLineGridHeader align="right">Состояние</PercentageLineGridHeader>
            <PercentageLineGridHeader
              align="right"
              title="Сколько РК/УЗК нужно закрыть по этому клейму: расчет по проценту + добор после первичных негодных результатов РК/УЗК, включая дубль РК/УЗК. После 4-го такого результата требуется 100% РК/УЗК."
            >
              Расчет
            </PercentageLineGridHeader>
            <PercentageLineGridHeader
              align="right"
              title="Всего назначено = все стыки, где РК/УЗК назначены как «да» или «дополнительный», а также стыки с осознанной отменой РК+УЗК. Обычное «да» участвует в проверке лишнего контроля. «Дополнительный» считается назначенным, но не закрывает обязательный расчет и добор."
            >
              Назначение
            </PercentageLineGridHeader>
            <PercentageLineGridHeader align="right" title="Закрыто расчетом и фактически выполненные результаты контроля.">
              Итог
            </PercentageLineGridHeader>
          </div>
          <div className="divide-y divide-slate-100">
            {line.stamps.map((stamp) => (
              <PercentageLineTableRow
                key={stamp.key}
                line={line}
                onAssignMissing={onAssignMissing}
                onOpenDetail={onOpenDetail}
                stamp={stamp}
                onOpenStamp={onOpenStamp}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PercentageLineSummaryPill({
  label,
  value,
  title,
  tone = 'slate',
}: {
  label: string
  value: number
  title: string
  tone?: 'slate' | 'amber' | 'rose'
}) {
  return (
    <div
      className={cn(
        'min-w-[112px] rounded-md border bg-white px-3 py-2 shadow-sm',
        tone === 'amber'
          ? 'border-amber-200 text-amber-800'
          : tone === 'rose'
            ? 'border-rose-200 text-rose-800'
            : 'border-slate-200 text-slate-700',
      )}
      title={title}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold leading-none text-slate-900">{value}</div>
    </div>
  )
}

function PercentageLineTableRow({
  line,
  onAssignMissing,
  onOpenDetail,
  onOpenStamp,
  stamp,
}: {
  line: ReturnType<typeof buildPercentageLineSummaries>[number]
  onAssignMissing?: (detail: PercentageLineAssignMissingDialogState) => void
  onOpenDetail?: (detail: PercentageLineJointDetailDialogState) => void
  onOpenStamp?: (filter: PercentageLineStampFilter) => void
  stamp: PercentageLineStampSummary
}) {
  const detailSubtitle = `${line.line} · клеймо ${stamp.stamp}`
  const createDetail = (title: string, rowIds: number[]) => ({
    rowIds,
    subtitle: detailSubtitle,
    title,
  })

  return (
    <div className="grid grid-cols-1 gap-3 bg-white p-3 odd:bg-white even:bg-slate-50/60 md:grid-cols-2 2xl:grid-cols-[1.1fr_0.7fr_1.2fr_1.2fr_1.2fr_1.1fr] 2xl:gap-0 2xl:p-0">
      <PercentageLineGridCell label="Клеймо" align="left">
        <div className="flex flex-wrap items-center gap-1.5">
          {onOpenStamp ? (
            <button
              type="button"
              className="font-semibold text-sky-800 underline-offset-2 transition-colors hover:text-sky-950 hover:underline"
              onClick={() =>
                onOpenStamp({
                  projectTitle: stamp.projectTitle,
                  subtitleCode: stamp.subtitleCode,
                  line: stamp.line,
                  stamp: stamp.stamp,
                })
              }
              title={`Показать стыки клейма ${stamp.stamp} на линии ${stamp.line}`}
            >
              {stamp.stamp}
            </button>
          ) : (
            <span className="font-semibold text-slate-900">{stamp.stamp}</span>
          )}
          {stamp.fullControlRequired ? (
            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
              100% РК/УЗК
            </span>
          ) : null}
        </div>
      </PercentageLineGridCell>
      <PercentageLineGridCell label="Сварено">{stamp.officialJointCount}</PercentageLineGridCell>
      <PercentageLineGridCell label="Состояние">
        <div className="grid justify-end gap-1 text-[11px] font-normal text-slate-600" title={getPercentageStatusHint(stamp)}>
          <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
            годен: {stamp.goodJoints}
          </span>
          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700">
            ожидает: {stamp.waitingRequestJoints + stamp.waitingControlJoints}
          </span>
          <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-rose-700">
            <span className="block">не годен: {stamp.rejectedJoints}</span>
            {stamp.rejectedJoints > 0 ? (
              <span className="block text-[10px] leading-4 text-rose-600">в т.ч. РК/УЗК: {stamp.rejectedPrimaryControls}</span>
            ) : null}
          </span>
        </div>
      </PercentageLineGridCell>
      <PercentageLineGridCell label="Расчет">
        <PercentageLineCellStack
          main={`требуется ${stamp.requiredControls}`}
          title="Расчетная потребность РК/УЗК"
          details={[
            stamp.availableRequiredControls < stamp.calculatedRequiredControls
              ? `расчетно: ${stamp.calculatedRequiredControls}`
              : '',
            stamp.availableRequiredControls < stamp.calculatedRequiredControls
              ? `доступно: ${stamp.availableRequiredControls}`
              : '',
            `по %: ${stamp.baseRequiredControls}`,
            stamp.additionalRequiredControls > 0 ? `добор: ${stamp.additionalRequiredControls}` : '',
          ]}
        />
      </PercentageLineGridCell>
      <PercentageLineGridCell label="Назначение">
        <PercentageLineCellStack
          main={`назначено ${stamp.assignedControls}`}
          mainDetail={createDetail('Назначенные стыки', stamp.assignedRowIds)}
          title={getAssignedControlsHint(stamp)}
          details={[
            stamp.additionalAssignedControls > 0
              ? {
                  text: `дополнительно: ${stamp.additionalAssignedControls}`,
                  detail: createDetail('Дополнительный РК/УЗК', stamp.additionalAssignedRowIds),
                }
              : '',
            stamp.cancelledAssignedControls > 0
              ? {
                  text: `отменено: ${stamp.cancelledAssignedControls}`,
                  detail: createDetail('Осознанно отменено РК+УЗК', stamp.cancelledAssignedRowIds),
                }
              : '',
          ]}
          onOpenDetail={onOpenDetail}
        />
      </PercentageLineGridCell>
      <PercentageLineGridCell label="Итог">
        <PercentageLineResultStack
          title={`${getJointListHint('Закрыто расчетом', stamp.coveredJointNames)}. ${getJointListHint('Недоступно из-за брака', stamp.rejectedCoveredJointNames)}. ${getJointListHint('Выполнено', stamp.completedJointNames)}. ${getJointListHint('Кандидаты без закрытия расчета', stamp.missingCandidateJointNames)}. ${getJointListHint('Лишнее “да”', stamp.excessCandidateJointNames)}`}
          missing={stamp.missingControls}
          completed={stamp.completedControls}
          rejectedPrimary={stamp.rejectedPrimaryControls}
          excess={stamp.excessControls}
          completedDetail={createDetail('Результаты внесены', stamp.completedRowIds)}
          rejectedCovered={stamp.rejectedCoveredControls}
          rejectedCoveredDetail={createDetail('Недоступно из-за брака', stamp.rejectedCoveredRowIds)}
          excessDetail={createDetail('Лишнее обычное “да”', stamp.excessCandidateRowIds)}
          mainDetail={
            stamp.missingControls > 0
              ? createDetail('Кандидаты без закрытия расчета', stamp.missingCandidateRowIds)
              : createDetail('Закрыто расчетом', stamp.coveredRowIds)
          }
          assignMissingDetail={{
            ...createDetail('Назначить РК/УЗК', stamp.assignmentCandidateRowIds),
            cancellationRowIds: stamp.missingCandidateRowIds,
            missingControls: stamp.missingControls,
          }}
          rejectedPrimaryDetail={createDetail('Первично негодные стыки', stamp.rejectedPrimaryRowIds)}
          onAssignMissing={onAssignMissing}
          onOpenDetail={onOpenDetail}
        />
      </PercentageLineGridCell>
    </div>
  )
}

function PercentageLineGridHeader({
  align = 'left',
  children,
  title,
}: {
  align?: 'left' | 'right'
  children: ReactNode
  title?: string
}) {
  return (
    <div className={cn('px-3 py-3 font-semibold', align === 'right' ? 'text-right' : 'text-left')} title={title}>
      {children}
    </div>
  )
}

function PercentageLineGridCell({
  align = 'right',
  children,
  label,
}: {
  align?: 'left' | 'right'
  children: ReactNode
  label: string
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-slate-100 bg-white px-3 py-2 align-top font-medium text-slate-700 2xl:rounded-none 2xl:border-0 2xl:bg-transparent 2xl:py-3',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 2xl:hidden">{label}</div>
      {children}
    </div>
  )
}

function PercentageLineResultStack({
  assignMissingDetail,
  completed,
  completedDetail,
  excess,
  excessDetail,
  mainDetail,
  missing,
  onAssignMissing,
  onOpenDetail,
  rejectedCovered,
  rejectedCoveredDetail,
  rejectedPrimary,
  rejectedPrimaryDetail,
  title,
}: {
  assignMissingDetail: PercentageLineAssignMissingDialogState
  completed: number
  completedDetail: PercentageLineJointDetailDialogState
  excess: number
  excessDetail: PercentageLineJointDetailDialogState
  mainDetail: PercentageLineJointDetailDialogState
  missing: number
  onAssignMissing?: (detail: PercentageLineAssignMissingDialogState) => void
  onOpenDetail?: (detail: PercentageLineJointDetailDialogState) => void
  rejectedCovered: number
  rejectedCoveredDetail: PercentageLineJointDetailDialogState
  rejectedPrimary: number
  rejectedPrimaryDetail: PercentageLineJointDetailDialogState
  title: string
}) {
  return (
    <div className="flex flex-col items-end gap-1" title={title}>
      <PercentageLineDetailButton
        detail={mainDetail}
        onOpen={onOpenDetail}
        className={cn('text-sm font-semibold', missing > 0 ? 'text-amber-700' : 'text-emerald-700')}
      >
        {missing > 0 ? `Осталось закрыть: ${missing}` : 'Расчет закрыт'}
      </PercentageLineDetailButton>
      {missing > 0 && onAssignMissing && (assignMissingDetail.rowIds.length > 0 || assignMissingDetail.cancellationRowIds.length > 0) ? (
        <button
          type="button"
          className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 transition-colors hover:border-sky-300 hover:bg-sky-100"
          onClick={() => onAssignMissing?.(assignMissingDetail)}
          title="Назначить РК/УЗК или закрыть недобор отменой"
        >
          Назначить РК/УЗК
        </button>
      ) : null}
      {excess > 0 ? (
        <PercentageLineDetailButton
          detail={excessDetail}
          onOpen={onOpenDetail}
          className="font-medium text-rose-700"
        >
          Лишнее “да”: {excess}
        </PercentageLineDetailButton>
      ) : null}
      {completed > 0 ? (
        <PercentageLineDetailButton detail={completedDetail} onOpen={onOpenDetail}>
          Результатов внесено: {completed}
        </PercentageLineDetailButton>
      ) : null}
      {rejectedCovered > 0 ? (
        <PercentageLineDetailButton detail={rejectedCoveredDetail} onOpen={onOpenDetail}>
          Недоступно из-за брака: {rejectedCovered}
        </PercentageLineDetailButton>
      ) : null}
      {rejectedPrimary > 0 ? (
        <PercentageLineDetailButton detail={rejectedPrimaryDetail} onOpen={onOpenDetail}>
          Первично не годен: {rejectedPrimary}
        </PercentageLineDetailButton>
      ) : null}
    </div>
  )
}

type PercentageLineDetailItem =
  | string
  | {
      detail: PercentageLineJointDetailDialogState
      text: string
    }

function PercentageLineCellStack({
  details,
  main,
  mainDetail,
  onOpenDetail,
  title,
  tone = 'slate',
}: {
  details: PercentageLineDetailItem[]
  main: string
  mainDetail?: PercentageLineJointDetailDialogState
  onOpenDetail?: (detail: PercentageLineJointDetailDialogState) => void
  title: string
  tone?: 'slate' | 'amber' | 'rose'
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-end gap-1',
        tone === 'amber' ? 'text-amber-700' : tone === 'rose' ? 'text-rose-700' : undefined,
      )}
      title={title}
    >
      {mainDetail ? (
        <PercentageLineDetailButton
          detail={mainDetail}
          onOpen={onOpenDetail}
          className={cn(
            'text-sm font-semibold',
            tone === 'amber' ? 'text-amber-700' : tone === 'rose' ? 'text-rose-700' : 'text-slate-700',
          )}
        >
          {main}
        </PercentageLineDetailButton>
      ) : (
        <span className="font-semibold">{main}</span>
      )}
      {details.filter(Boolean).map((detail) =>
        typeof detail === 'string' ? (
          <span key={detail} className="whitespace-nowrap text-[11px] font-normal text-slate-500">
            {detail}
          </span>
        ) : (
          <PercentageLineDetailButton key={detail.text} detail={detail.detail} onOpen={onOpenDetail}>
            {detail.text}
          </PercentageLineDetailButton>
        ),
      )}
    </div>
  )
}

function PercentageLineDetailButton({
  children,
  className,
  detail,
  onOpen,
}: {
  children: ReactNode
  className?: string
  detail: PercentageLineJointDetailDialogState
  onOpen?: (detail: PercentageLineJointDetailDialogState) => void
}) {
  if (!onOpen || detail.rowIds.length === 0) {
    return <span className={cn('whitespace-nowrap text-[11px] font-normal text-slate-500', className)}>{children}</span>
  }

  return (
    <button
      type="button"
      className={cn(
        'whitespace-nowrap text-[11px] font-normal text-slate-500 underline decoration-dotted underline-offset-2 transition-colors hover:text-sky-800',
        className,
      )}
      onClick={() => onOpen(detail)}
    >
      {children}
    </button>
  )
}

type PercentageLineJointBadge = {
  text: string
  tone: 'amber' | 'blue' | 'emerald' | 'rose' | 'slate' | 'sky' | 'violet'
}

function getPercentageLineJointBadges(row: WeldRow): PercentageLineJointBadge[] {
  const badges: PercentageLineJointBadge[] = []

  for (const { code, enabledKey, resultKey } of CONTROL_RESULT_PAIRS) {
    const availability = row[enabledKey]
    if (isAdditionalControlValue(availability)) {
      badges.push({ text: `${code}: дополнительный`, tone: 'sky' })
    } else if (isCancelledControlValue(availability)) {
      badges.push({ text: `${code}: отменен`, tone: 'slate' })
    } else if ((code === 'РК' || code === 'УЗК') && isEnabledControlValue(availability)) {
      badges.push({ text: `${code}: да`, tone: 'blue' })
    }

    const result = normalizeResultStatus(row[resultKey])
    if (!result) continue
    if (result === 'годен') badges.push({ text: `${code} результат: годен`, tone: 'emerald' })
    else if (result === 'ремонт' || result === 'вырез') badges.push({ text: `${code} результат: ${result}`, tone: 'rose' })
    else badges.push({ text: `${code} результат: ${result}`, tone: 'amber' })
  }

  return badges
}

function getPercentageLineJointBadgeClassName(tone: PercentageLineJointBadge['tone']) {
  return cn(
    'rounded border px-2 py-0.5 text-[11px] font-medium',
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : tone === 'blue'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : tone === 'emerald'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : tone === 'rose'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : tone === 'sky'
              ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
              : tone === 'violet'
                ? 'border-violet-200 bg-violet-50 text-violet-700'
                : 'border-slate-200 bg-slate-50 text-slate-600',
  )
}

function getPercentageLineFinalStatusBadgeClassName(statusLabel: string) {
  const status = statusLabel.trim().toLowerCase()
  const isRejected = status === 'не годен' || status.startsWith('не годен по дублю')

  return cn(
    'rounded border px-2 py-0.5 text-xs font-medium',
    isRejected ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-600',
  )
}

function getPercentageStatusHint(stamp: PercentageLineStampSummary) {
  return [
    `Годен: ${stamp.goodJoints}`,
    `Ожидает заявку: ${stamp.waitingRequestJoints}`,
    `Ожидает результат НК: ${stamp.waitingControlJoints}`,
    `Не годен всего: ${stamp.rejectedJoints}`,
    `В том числе по РК/УЗК: ${stamp.rejectedPrimaryControls}. Эти стыки влияют на добор контроля процентной линии`,
  ].join('. ')
}

function getAssignedControlsHint(stamp: PercentageLineStampSummary) {
  return [
    `${getJointListHint('Всего назначено', stamp.assignedJointNames)}. Это общее число назначений: РК/УЗК и осознанные отмены РК+УЗК`,
    stamp.additionalAssignedControls > 0 ? getJointListHint('В т.ч. дополнительно', stamp.additionalAssignedJointNames) : '',
    stamp.cancelledAssignedControls > 0 ? getJointListHint('В т.ч. отменено РК и УЗК', stamp.cancelledAssignedJointNames) : '',
    stamp.cancelledAssignedControls > 0
      ? 'Отмена РК+УЗК закрывает одно расчетное место РК/УЗК и не считается лишним контролем'
      : '',
    stamp.additionalAssignedControls > 0 ? 'Дополнительный РК/УЗК не закрывает обязательный расчет и добор' : '',
  ].filter(Boolean).join('. ')
}

function formatAssignedBreakdown(additional: number, cancelled: number) {
  const parts = [
    additional > 0 ? `дополнительно: ${additional}` : '',
    cancelled > 0 ? `отменено: ${cancelled}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? ` (${parts.join(' · ')})` : ''
}

function getJointListHint(title: string, joints: string[]) {
  return joints.length > 0 ? `${title}: ${joints.join(', ')}` : `${title}: нет стыков`
}

function LineSummaryPanel({
  summary,
  unit,
}: {
  summary: ReturnType<typeof buildLineSummary>
  unit: StatisticsUnit
}) {
  const [lineSearch, setLineSearch] = useState('')
  const [showLineDetails, setShowLineDetails] = useState(false)
  const unitColumnLabel = unit === 'wdi' ? 'WDI' : 'стыков'
  const filteredRows = useMemo(() => {
    const query = lineSearch.trim().toLowerCase()
    if (!query) return summary.rows
    return summary.rows.filter((row) => row.line.toLowerCase().includes(query))
  }, [lineSearch, summary.rows])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Gauge}
          label="Линий всего"
          value={summary.rows.length}
          detail="Количество линий в выбранном срезе"
          accent="slate"
        />
        <MetricCard
          icon={LineChart}
          label="Всего по линиям"
          value={formatStatisticValue(summary.total, unit)}
          detail={`Выполнено ${formatStatisticValue(summary.completed, unit)} · остаток ${formatStatisticValue(summary.remaining, unit)}`}
          accent="blue"
        />
        <MetricCard
          icon={ClipboardCheck}
          label="Выполнено"
          value={formatPercent(summary.total > 0 ? (summary.completed / summary.total) * 100 : 0)}
          detail={`${formatStatisticValue(summary.completed, unit)} из ${formatStatisticValue(summary.total, unit)}`}
          accent="green"
        />
        <MetricCard
          icon={TimerReset}
          label="Остаток"
          value={formatStatisticValue(summary.remaining, unit)}
          detail="Стыки без даты сварки в актуальном срезе"
          accent="amber"
        />
      </div>

      <Panel
        title="Полинейная сводка"
        subtitle="Список линий по проекту/шифру. История цепочки до годного результата и строки «не актуален» по изм. не учитываются."
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <label className="grid w-full max-w-sm gap-1 text-xs font-medium text-slate-600">
            Поиск по линии
            <Input
              value={lineSearch}
              onChange={(event) => setLineSearch(event.target.value)}
              placeholder="Например: 330-FL-02-016"
              className="h-9 rounded-md border-slate-200 bg-white text-sm"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-md border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              onClick={() => setShowLineDetails((current) => !current)}
            >
              {showLineDetails ? 'Скрыть параметры линии' : 'Показать параметры линии'}
            </Button>
            {lineSearch.trim() ? (
              <Button variant="outline" size="sm" className="h-9 rounded-md" onClick={() => setLineSearch('')}>
                Очистить поиск
              </Button>
            ) : null}
          </div>
        </div>

        {summary.rows.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-slate-200">
            <div className="overflow-x-auto">
              <table className={cn('w-full table-fixed border-collapse text-sm', showLineDetails ? 'min-w-[1160px]' : 'min-w-[860px]')}>
                <colgroup>
                  {showLineDetails ? (
                    <>
                      <col className="w-[11%]" />
                      <col className="w-[12%]" />
                      <col className="w-[14%]" />
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[9%]" />
                      <col className="w-[13%]" />
                      <col className="w-[13%]" />
                      <col className="w-[12%]" />
                    </>
                  ) : (
                    <>
                      <col className="w-[15%]" />
                      <col className="w-[16%]" />
                      <col className="w-[21%]" />
                      <col className="w-[16%]" />
                      <col className="w-[16%]" />
                      <col className="w-[16%]" />
                    </>
                  )}
                </colgroup>
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <LineHeaderCell>Проект</LineHeaderCell>
                    <LineHeaderCell>Шифр</LineHeaderCell>
                    <LineHeaderCell>Линия</LineHeaderCell>
                    {showLineDetails ? (
                      <>
                        <LineHeaderCell>Группа трубопровода</LineHeaderCell>
                        <LineHeaderCell>Категория трубопровода</LineHeaderCell>
                        <LineHeaderCell align="right">Контроль швов, (%)</LineHeaderCell>
                      </>
                    ) : null}
                    <LineHeaderCell align="right">Всего {unitColumnLabel}</LineHeaderCell>
                    <LineHeaderCell align="right">Выполнено {unitColumnLabel}</LineHeaderCell>
                    <LineHeaderCell align="right">Остаток {unitColumnLabel}</LineHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <LineSummaryTableRow key={row.key} row={row} showLineDetails={showLineDetails} unit={unit} />
                  ))}
                </tbody>
              </table>
              {filteredRows.length === 0 ? (
                <div className="border-t border-slate-100 bg-slate-50 p-5 text-sm text-slate-500">
                  По этой линии ничего не найдено.
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            В выбранном срезе нет актуальных линий для сводки.
          </div>
        )}
      </Panel>
    </div>
  )
}

function LineSummaryTableRow({
  row,
  showLineDetails,
  unit,
}: {
  row: LineSummaryRow
  showLineDetails: boolean
  unit: StatisticsUnit
}) {
  return (
    <tr className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
      <LineBodyCell align="left">{row.projectTitle}</LineBodyCell>
      <LineBodyCell align="left">{row.subtitleCode}</LineBodyCell>
      <LineBodyCell align="left" className="font-semibold text-slate-900">{row.line}</LineBodyCell>
      {showLineDetails ? (
        <>
          <LineBodyCell align="left">{row.groupName}</LineBodyCell>
          <LineBodyCell align="left">{row.category}</LineBodyCell>
          <LineBodyCell>{row.weldControlPercent}</LineBodyCell>
        </>
      ) : null}
      <LineBodyCell>
        <LineValueWithSplit total={row.total} f={row.totalF} s={row.totalS} unit={unit} />
      </LineBodyCell>
      <LineBodyCell>
        <LineValueWithSplit total={row.completed} f={row.completedF} s={row.completedS} unit={unit} />
      </LineBodyCell>
      <LineBodyCell>
        <LineValueWithSplit total={row.remaining} f={row.remainingF} s={row.remainingS} unit={unit} />
      </LineBodyCell>
    </tr>
  )
}

function LineValueWithSplit({ total, f, s, unit }: { total: number; f: number; s: number; unit: StatisticsUnit }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span>{formatStatisticValue(total, unit)}</span>
      <span className="flex flex-wrap justify-end gap-1 text-[11px] font-normal text-slate-500">
        <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5">F: {formatStatisticValue(f, unit)}</span>
        <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5">S: {formatStatisticValue(s, unit)}</span>
      </span>
    </div>
  )
}

function LineHeaderCell({
  children,
  align = 'left',
  title,
}: {
  children: ReactNode
  align?: 'left' | 'right'
  title?: string
}) {
  return (
    <th className={cn('px-3 py-3 font-semibold', align === 'right' ? 'text-right' : 'text-left')} title={title}>
      {children}
    </th>
  )
}

function LineBodyCell({
  children,
  align = 'right',
  className,
}: {
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <td className={cn('px-3 py-3 align-top font-medium text-slate-700', align === 'right' ? 'text-right' : 'text-left', className)}>
      {children}
    </td>
  )
}

function segmentButtonClass(active: boolean) {
  return cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    active ? 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
  )
}

function matchesStatisticsJointFilter(row: WeldRow, filter: WelderStatisticsJointFilter) {
  if (filter === 'all') return true
  const baseJoint = parseJointChainName(String(row.joint ?? '')).base.trim().toUpperCase()
  return getConfiguredBaseJointType(baseJoint) === filter
}

function getUniqueSortedValues(values: unknown[]): Array<{ value: string; label: string }> {
  return Array.from(
    values.reduce((map, value) => {
      const normalized = normalizeFilterValue(value)
      if (normalized && !map.has(normalized)) {
        map.set(normalized, String(value ?? '').trim())
      }
      return map
    }, new Map<string, string>()),
  )
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'ru', { numeric: true }))
}

function normalizeFilterValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function sumStatisticRows(rows: readonly WeldRow[], unit: StatisticsUnit) {
  if (unit === 'joints') return rows.length
  return rows.reduce((total, row) => {
    const value = Number(String(row.wdi ?? '').replace(',', '.'))
    return total + (Number.isFinite(value) && value > 0 ? value : 0)
  }, 0)
}

function getWeldingDynamicsBucketText(bucketUnitLabel: string) {
  if (bucketUnitLabel === 'день') return 'по дням'
  if (bucketUnitLabel === 'неделя') return 'по неделям'
  if (bucketUnitLabel === 'месяц') return 'по месяцам'
  if (bucketUnitLabel === 'квартал') return 'по кварталам'
  return 'по годам'
}

function formatAverageStatisticValue(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0)
}

function getScopeLabel(
  projectFilter: string,
  selectedSubtitles: string[],
  projectOptions: Array<{ value: string; label: string }>,
  subtitleOptions: Array<{ value: string; label: string }>,
) {
  if (!projectFilter && selectedSubtitles.length === 0) return 'все проекты и шифры'
  const parts = []
  const projectLabel = projectOptions.find((option) => option.value === projectFilter)?.label ?? projectFilter
  const subtitleLabels = selectedSubtitles.map(
    (subtitle) => subtitleOptions.find((option) => option.value === subtitle)?.label ?? subtitle,
  )
  if (projectFilter) parts.push(`проект ${projectLabel}`)
  if (selectedSubtitles.length > 0) parts.push(`шифры ${subtitleLabels.join(', ')}`)
  return parts.join(' · ')
}
