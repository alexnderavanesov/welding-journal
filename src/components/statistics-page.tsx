import { useMemo, useState, type ReactNode } from 'react'
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
import { Input } from '@/components/ui/input'
import type { WeldRow } from '@/lib/dispatcher-types'
import { parseJointChainName } from '@/lib/joint-chain'
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
  type PercentageLineStampSummary,
} from '@/lib/percentage-line-summary'
import {
  buildWelderStatisticsSummary,
  type WelderStatisticsJointFilter,
  type WelderStatisticsRow,
} from '@/lib/welder-statistics-summary'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import type { PercentageLineStampFilter } from '@/lib/report-navigation'
import { cn } from '@/lib/utils'

type StatisticsPageProps = {
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
}

type StatisticsTab = 'general' | 'welders' | 'lineSummary' | 'percentageLines'

const jointFilterOptions: Array<[WelderStatisticsJointFilter, string]> = [
  ['all', 'Все'],
  ['f', 'F поле'],
  ['s', 'S база'],
]

export function StatisticsPage({ rows, welderStamps, onOpenPercentageLineStampRows }: StatisticsPageProps) {
  const defaultPeriod = useMemo(() => getDefaultStatisticsPeriod(), [])
  const [activeTab, setActiveTab] = useState<StatisticsTab>('general')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [period, setPeriod] = useState(defaultPeriod)
  const [allPeriod, setAllPeriod] = useState(false)
  const [generalUnit, setGeneralUnit] = useState<StatisticsUnit>('joints')
  const [weldersUnit, setWeldersUnit] = useState<StatisticsUnit>('joints')
  const [lineSummaryUnit, setLineSummaryUnit] = useState<StatisticsUnit>('joints')
  const [generalJointFilter, setGeneralJointFilter] = useState<WelderStatisticsJointFilter>('all')
  const [welderJointFilter, setWelderJointFilter] = useState<WelderStatisticsJointFilter>('all')
  const [periodMode, setPeriodMode] = useState<StatisticsPeriodMode>('events')
  const [projectFilter, setProjectFilter] = useState('')
  const [selectedSubtitles, setSelectedSubtitles] = useState<string[]>([])
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
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-9 rounded-md"
                size="sm"
                variant={activeTab === 'general' ? 'default' : 'outline'}
                onClick={() => setActiveTab('general')}
              >
                Общая
              </Button>
              <Button
                className="h-9 rounded-md"
                size="sm"
                variant={activeTab === 'welders' ? 'default' : 'outline'}
                onClick={() => setActiveTab('welders')}
              >
                Сварщики
              </Button>
              <Button
                className="h-9 rounded-md"
                size="sm"
                variant={activeTab === 'lineSummary' ? 'default' : 'outline'}
                onClick={() => setActiveTab('lineSummary')}
              >
                Полинейная сводка
              </Button>
              <Button
                className="h-9 rounded-md"
                size="sm"
                variant={activeTab === 'percentageLines' ? 'default' : 'outline'}
                onClick={() => setActiveTab('percentageLines')}
              >
                Процентные линии
              </Button>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              {activeTab === 'general'
                ? 'Общий прогресс сварки, заявок, заключений и ПСТО за выбранный период.'
                : activeTab === 'welders'
                  ? 'Вклад сварщиков по фактическим клеймам за выбранный период сварки.'
                  : activeTab === 'lineSummary'
                    ? 'Сводка по линиям с учетом актуальных стыков и текущего остатка.'
                    : 'Контроль процентных линий по официальным клеймам и РК/УЗК.'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {activeTab === 'general'
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
              {activeTab === 'general' ? (
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
              icon={Activity}
              label="Сварено за период"
              value={formatStatisticValue(summary.welded, unit)}
              detail={`${formatPercent(summary.weldedShare)} от общего количества`}
              accent="blue"
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

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1.05fr_1.35fr]">
            <div className="space-y-4">
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
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <StatusLine label="Годен" value={summary.good} unit={unit} />
                  <StatusLine label="Не годен" value={summary.rejected} unit={unit} />
                  <StatusLine label="Ожидает заявку" value={summary.waitingRequest} unit={unit} />
                  <StatusLine label="Ожидает НК" value={summary.waitingControl} unit={unit} />
                  <StatusLine label="Ожидает ремонт" value={summary.waitingRepair} unit={unit} />
                  <StatusLine label="Ожидает сварку" value={summary.waitingWeld} unit={unit} />
                </div>
              </Panel>

              <Panel
                title="Заявки и результат"
                subtitle="Показывает, сколько заявок есть в выбранном периоде и сколько из них уже закрыто результатом/заключением."
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
            </div>

            <Panel
              title="Лаборатория по видам контроля"
              subtitle="По каждому виду НК видно: сколько заявок подано за период, сколько закрыто, сколько еще ожидает результат."
            >
              <div className="space-y-2">
                {orderedMethods.map((method) => (
                  <MethodProgress key={method.code} method={method} unit={unit} />
                ))}
              </div>
            </Panel>
          </div>
        </>
      ) : activeTab === 'welders' ? (
        <WeldersStatisticsPanel
          jointFilter={welderJointFilter}
          summary={welderSummary}
          unit={unit}
        />
      ) : activeTab === 'percentageLines' ? (
        <PercentageLinesPanel
          summary={percentageLineSummary}
          onOpenPercentageLineStampRows={onOpenPercentageLineStampRows}
        />
      ) : (
        <LineSummaryPanel summary={lineSummary} unit={lineSummaryUnit} />
      )}
    </section>
  )
}

type MetricCardProps = {
  compact?: boolean
  icon: typeof Activity
  label: string
  value: string
  detail: string
  accent: 'blue' | 'green' | 'indigo' | 'amber' | 'slate'
}

function MetricCard({ compact = false, icon: Icon, label, value, detail, accent }: MetricCardProps) {
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
      <div className={cn('truncate text-sm text-slate-500', compact ? 'mt-2' : 'mt-3')} title={detail}>
        {detail}
      </div>
    </div>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <LineChart className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
      </div>
      {children}
    </section>
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
    return summary.rows.filter((row) => row.stamp.toLowerCase().includes(query))
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
            Поиск клейма
            <Input
              value={stampSearch}
              onChange={(event) => setStampSearch(event.target.value)}
              placeholder="Клеймо НАКС или внутреннее"
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
                  По этому клейму ничего не найдено.
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
      <td className="px-4 py-3 font-semibold text-slate-900">{row.stamp}</td>
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
  summary,
  onOpenPercentageLineStampRows,
}: {
  summary: ReturnType<typeof buildPercentageLineSummaries>
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
}) {
  const [search, setSearch] = useState('')
  const [collapsedLineKeys, setCollapsedLineKeys] = useState<Set<string>>(() => new Set())
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
          replacedAssigned: result.replacedAssigned + stamp.replacedAssignedControls,
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
          replacedAssigned: 0,
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
          detail={`Назначено ${totals.assigned}${formatAssignedBreakdown(totals.additionalAssigned, totals.cancelledAssigned, totals.replacedAssigned)} · выполнено ${totals.completed}`}
          accent="green"
        />
        <MetricCard
          icon={TimerReset}
          label="Не хватает"
          value={String(totals.missing)}
          detail="РК/УЗК еще нужно назначить по расчету"
          accent="amber"
        />
        <MetricCard
          icon={Gauge}
          label="100% по клейму"
          value={String(totals.fullControl)}
          detail={totals.excess > 0 ? `Лишних назначений: ${totals.excess}` : 'Без лишних назначений'}
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
                collapsed={collapsedLineKeys.has(line.lineKey)}
                line={line}
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
    </div>
  )
}

function PercentageLineGroup({
  collapsed,
  line,
  onOpenStamp,
  onToggle,
}: {
  collapsed: boolean
  line: ReturnType<typeof buildPercentageLineSummaries>[number]
  onOpenStamp?: (filter: PercentageLineStampFilter) => void
  onToggle: () => void
}) {
  const totals = line.stamps.reduce(
    (result, stamp) => ({
      required: result.required + stamp.requiredControls,
      assigned: result.assigned + stamp.assignedControls,
      additionalAssigned: result.additionalAssigned + stamp.additionalAssignedControls,
      cancelledAssigned: result.cancelledAssigned + stamp.cancelledAssignedControls,
      replacedAssigned: result.replacedAssigned + stamp.replacedAssignedControls,
      covered: result.covered + stamp.coveredControls,
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
      replacedAssigned: 0,
      covered: 0,
      completed: 0,
      missing: 0,
      excess: 0,
      fullControl: 0,
    },
  )
  const lineHint =
    `${line.line}: ${line.percent}% контроля считается отдельно по каждому официальному клейму. ` +
    `Расчет по проценту: max(1, округление вверх от количества официальных стыков клейма * ${line.percent}%). ` +
    `Если первичный стык не годен по любому виду контроля: ${line.percent === 1 ? '+1 стык к РК/УЗК' : '+2 стыка к РК/УЗК'}. ` +
    'После 4-го первичного негодного результата по любому виду контроля требуется 100% РК/УЗК по этому клейму.'

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-white transition-colors',
        totals.missing > 0 || totals.excess > 0 ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200',
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
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <PercentageLineMiniStat
            label="Клейм"
            value={line.stamps.length}
            title="Количество официальных клейм, которые участвовали в сварке этой процентной линии."
          />
          <PercentageLineMiniStat
            label="Требуется"
            value={totals.required}
            title="Сколько стыков нужно закрыть РК/УЗК: базовый процент плюс добор после первичных негодных результатов по любому виду контроля."
          />
          <PercentageLineMiniStat
            label="Назначено"
            value={totals.assigned}
            title={`Все стыки, где по РК/УЗК стоит «да» или «дополнительный», РК+УЗК осознанно отменены, либо другой вид НК отмечен как «замена РК/УЗК». Дополнительно: ${totals.additionalAssigned}. Отменено: ${totals.cancelledAssigned}. Заменено: ${totals.replacedAssigned}. «Дополнительный» учитывается как назначенный контроль, но не закрывает обязательный расчет и добор.`}
          />
          <PercentageLineMiniStat
            label="Покрыто"
            value={totals.covered}
            title="Стыки, которые закрывают обязательный расчет РК/УЗК: обычное «да», выполненный результат РК/УЗК, одновременная отмена РК+УЗК или статус «замена РК/УЗК» на другом виде НК. «Дополнительный» сам по себе расчет не закрывает."
          />
          <PercentageLineMiniStat
            label="Не хватает"
            value={totals.missing}
            tone={totals.missing > 0 ? 'amber' : 'slate'}
            title="Сколько расчетных стыков еще нужно назначить к РК/УЗК."
          />
          <PercentageLineMiniStat
            label="Лишнее"
            value={totals.excess}
            tone={totals.excess > 0 ? 'rose' : 'slate'}
            title="Обычные назначения «да» сверх расчетной потребности. «Дополнительный» сюда не попадает."
          />
        </div>
      </div>

      {!collapsed ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[16%]" />
              <col className="w-[9%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <LineHeaderCell>Клеймо</LineHeaderCell>
                <LineHeaderCell
                  align="right"
                  title="Сварено = официальные активные стыки этого клейма на процентной линии. Неофициальные, неактуальные по изм. и строки без даты сварки не учитываются."
                >
                  Сварено
                </LineHeaderCell>
                <LineHeaderCell align="right">Состояние</LineHeaderCell>
                <LineHeaderCell
                  align="right"
                  title="Сколько РК/УЗК нужно закрыть по этому клейму: расчет по проценту + добор после первичных негодных результатов по любому виду контроля. После 4-го первичного негодного требуется 100% РК/УЗК."
                >
                  Требуется РК/УЗК
                </LineHeaderCell>
                <LineHeaderCell
                  align="right"
                  title="Назначено = все стыки, где РК/УЗК назначены как «да» или «дополнительный», стыки с осознанной отменой РК+УЗК и стыки со статусом «замена РК/УЗК» на другом виде НК. Обычное «да» участвует в проверке лишнего контроля. «Дополнительный» считается назначенным, но не закрывает обязательный расчет и добор. «Заменено» закрывает одно расчетное место РК/УЗК и не считается лишним контролем."
                >
                  Назначено
                </LineHeaderCell>
                <LineHeaderCell
                  align="right"
                  title="Покрыто = то, что закрывает обязательный расчет РК/УЗК: обычное «да», результат РК/УЗК, одновременная отмена РК+УЗК или статус «замена РК/УЗК» на другом виде НК. «Дополнительный» РК/УЗК сюда не входит."
                >
                  Покрыто
                </LineHeaderCell>
                <LineHeaderCell align="right" title="Выполнено = есть результат РК/УЗК либо любой негодный результат по другому виду контроля. Такой негодный результат тоже запускает добор РК/УЗК.">
                  Выполнено
                </LineHeaderCell>
                <LineHeaderCell
                  align="right"
                  title="Первично не годен = негодный результат любого вида контроля на первичном стыке без системных индексов R/W/Y."
                >
                  Первично не годен
                </LineHeaderCell>
                <LineHeaderCell align="right" title="Сколько стыков этого клейма еще нужно назначить к РК/УЗК.">
                  Не хватает
                </LineHeaderCell>
                <LineHeaderCell align="right" title="Назначено обычным «да» больше, чем требует расчет.">
                  Лишнее
                </LineHeaderCell>
              </tr>
            </thead>
            <tbody>
              {line.stamps.map((stamp) => (
                <PercentageLineTableRow
                  key={stamp.key}
                  stamp={stamp}
                  onOpenStamp={onOpenStamp}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function PercentageLineMiniStat({
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
        'rounded-md border bg-white px-3 py-2 shadow-sm',
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
  onOpenStamp,
  stamp,
}: {
  onOpenStamp?: (filter: PercentageLineStampFilter) => void
  stamp: PercentageLineStampSummary
}) {
  return (
    <tr className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
      <LineBodyCell align="left">
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
      </LineBodyCell>
      <LineBodyCell>{stamp.officialJointCount}</LineBodyCell>
      <LineBodyCell>
        <div className="grid justify-end gap-1 text-[11px] font-normal text-slate-600" title={getPercentageStatusHint(stamp)}>
          <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
            годен: {stamp.goodJoints}
          </span>
          <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-rose-700">
            не годен: {stamp.rejectedJoints}
          </span>
          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700">
            ожидает: {stamp.waitingRequestJoints + stamp.waitingControlJoints}
          </span>
        </div>
      </LineBodyCell>
      <LineBodyCell>
        <div className="flex flex-col items-end gap-1">
          <span>{stamp.requiredControls}</span>
          <span className="text-[11px] font-normal text-slate-500">
            по %: {stamp.baseRequiredControls}
            {stamp.additionalRequiredControls > 0 ? ` · добор: ${stamp.additionalRequiredControls}` : ''}
          </span>
        </div>
      </LineBodyCell>
      <LineBodyCell>
        <div className="flex flex-col items-end gap-1" title={getAssignedControlsHint(stamp)}>
          <span>{stamp.assignedControls}</span>
          {stamp.additionalAssignedControls > 0 ? (
            <span className="whitespace-nowrap text-[11px] font-normal text-slate-500">дополнительно: {stamp.additionalAssignedControls}</span>
          ) : null}
          {stamp.cancelledAssignedControls > 0 ? (
            <span className="whitespace-nowrap text-[11px] font-normal text-slate-500">отменено: {stamp.cancelledAssignedControls}</span>
          ) : null}
          {stamp.replacedAssignedControls > 0 ? (
            <span className="whitespace-nowrap text-[11px] font-normal text-slate-500">заменено: {stamp.replacedAssignedControls}</span>
          ) : null}
        </div>
      </LineBodyCell>
      <LineBodyCell>
        <div className="flex flex-col items-end gap-1" title={getJointListHint('Покрыто', stamp.coveredJointNames)}>
          <span>{stamp.coveredControls}</span>
        </div>
      </LineBodyCell>
      <LineBodyCell>
        <div className="flex flex-col items-end gap-1" title={getJointListHint('Выполнено', stamp.completedJointNames)}>
          <span>{stamp.completedControls}</span>
        </div>
      </LineBodyCell>
      <LineBodyCell className={stamp.rejectedPrimaryControls > 0 ? 'text-rose-700' : undefined}>
        {stamp.rejectedPrimaryControls}
      </LineBodyCell>
      <LineBodyCell className={stamp.missingControls > 0 ? 'text-amber-700' : undefined}>
        <span title={getJointListHint('Кандидаты без покрытия', stamp.missingCandidateJointNames)}>
          {stamp.missingControls}
        </span>
      </LineBodyCell>
      <LineBodyCell className={stamp.excessControls > 0 ? 'text-rose-700' : undefined}>
        <span title={getJointListHint('Назначено обычным да сверх расчета', stamp.excessCandidateJointNames)}>
          {stamp.excessControls}
        </span>
      </LineBodyCell>
    </tr>
  )
}

function getPercentageStatusHint(stamp: PercentageLineStampSummary) {
  return [
    `Годен: ${stamp.goodJoints}`,
    `Не годен: ${stamp.rejectedJoints}`,
    `Ожидает заявку: ${stamp.waitingRequestJoints}`,
    `Ожидает результат НК: ${stamp.waitingControlJoints}`,
  ].join('. ')
}

function getAssignedControlsHint(stamp: PercentageLineStampSummary) {
  return [
    `${getJointListHint('Назначено', stamp.assignedJointNames)}. Это общее число назначений: РК/УЗК, осознанные отмены РК+УЗК и замены РК/УЗК другим видом НК`,
    stamp.additionalAssignedControls > 0 ? getJointListHint('В т.ч. дополнительно РК/УЗК', stamp.additionalAssignedJointNames) : '',
    stamp.cancelledAssignedControls > 0 ? getJointListHint('В т.ч. отменено РК и УЗК', stamp.cancelledAssignedJointNames) : '',
    stamp.additionalAssignedControls > 0 ? 'Дополнительный РК/УЗК не закрывает обязательный расчет и добор' : '',
    stamp.replacedAssignedControls > 0
      ? `${getJointListHint('В т.ч. замена РК/УЗК', stamp.replacedAssignedJointNames)}. Эти стыки покрывают расчет РК/УЗК и не считаются лишним контролем`
      : '',
  ].filter(Boolean).join('. ')
}

function formatAssignedBreakdown(additional: number, cancelled: number, replaced: number) {
  const parts = [
    additional > 0 ? `дополнительно: ${additional}` : '',
    cancelled > 0 ? `отменено: ${cancelled}` : '',
    replaced > 0 ? `заменено: ${replaced}` : '',
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
                    <LineHeaderCell>Проект/Титул</LineHeaderCell>
                    <LineHeaderCell>Шифр/Подтитул</LineHeaderCell>
                    <LineHeaderCell>Линия</LineHeaderCell>
                    {showLineDetails ? (
                      <>
                        <LineHeaderCell>Группа</LineHeaderCell>
                        <LineHeaderCell>Категория</LineHeaderCell>
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
  if (filter === 'f') return baseJoint.startsWith('F')
  return baseJoint.startsWith('S')
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
