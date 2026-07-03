import { useMemo, useState, type ReactNode } from 'react'
import { Activity, ClipboardCheck, FlaskConical, Gauge, LineChart, TimerReset, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildStatisticsSummary,
  formatPercent,
  formatStatisticValue,
  getDefaultStatisticsPeriod,
  type StatisticsMethodSummary,
  type StatisticsPeriodMode,
  type StatisticsUnit,
} from '@/lib/statistics-summary'
import { buildWelderStatisticsSummary, type WelderStatisticsRow } from '@/lib/welder-statistics-summary'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import { cn } from '@/lib/utils'

type StatisticsPageProps = {
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
}

type StatisticsTab = 'general' | 'welders'

const disabledTabs = ['Полинейная сводка', 'Процентные линии']

export function StatisticsPage({ rows, welderStamps }: StatisticsPageProps) {
  const defaultPeriod = useMemo(() => getDefaultStatisticsPeriod(), [])
  const [activeTab, setActiveTab] = useState<StatisticsTab>('general')
  const [period, setPeriod] = useState(defaultPeriod)
  const [allPeriod, setAllPeriod] = useState(false)
  const [generalUnit, setGeneralUnit] = useState<StatisticsUnit>('joints')
  const [weldersUnit, setWeldersUnit] = useState<StatisticsUnit>('joints')
  const [periodMode, setPeriodMode] = useState<StatisticsPeriodMode>('events')
  const [projectFilter, setProjectFilter] = useState('')
  const [selectedSubtitles, setSelectedSubtitles] = useState<string[]>([])
  const unit = activeTab === 'welders' ? weldersUnit : generalUnit
  const setUnit = activeTab === 'welders' ? setWeldersUnit : setGeneralUnit

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
  const summary = useMemo(
    () => buildStatisticsSummary(scopedRows, periodFrom, periodTo, unit, periodMode),
    [periodFrom, periodTo, periodMode, scopedRows, unit],
  )
  const welderSummary = useMemo(
    () => buildWelderStatisticsSummary(scopedRows, welderStamps, periodFrom, periodTo, weldersUnit),
    [periodFrom, periodTo, scopedRows, welderStamps, weldersUnit],
  )
  const orderedMethods = useMemo(() => {
    const methodsByCode = new Map([...summary.methods, summary.pstoMethod].map((method) => [method.code, method]))
    return ['ВИК', 'РК', 'ПВК', 'УЗК', 'ПСТО', 'ТВМТ', 'РФА', 'СТЛС', 'МКК']
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
  const segmentButtonClass = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      active ? 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
    )

  return (
    <section className="w-full max-w-full min-w-0 space-y-4 pb-8">
      <div className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
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
              {disabledTabs.map((tab) => (
                <Button key={tab} variant="outline" size="sm" disabled className="h-9 rounded-md text-slate-400">
                  {tab}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-500">
              {activeTab === 'general'
                ? 'Общий прогресс сварки, заявок, заключений и ПСТО за выбранный период.'
                : 'Вклад сварщиков по фактическим клеймам за выбранный период сварки.'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {activeTab === 'general'
                ? periodModeDescription
                : 'Статистика сварщиков считается по дате сварки стыка; распределение идет только по фактическим клеймам.'}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
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
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-end gap-3">
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

            <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              Срез: <span className="font-medium text-slate-700">{scopeLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {activeTab === 'general' ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <MetricCard
              icon={Activity}
              label="Сварено за период"
              value={formatStatisticValue(summary.welded, unit)}
              detail={`${formatPercent(summary.weldedShare)} от общего количества`}
              accent="blue"
            />
            <MetricCard
              icon={Gauge}
              label="Годность"
              value={formatPercent(summary.qualityPercent)}
              detail={`${formatStatisticValue(summary.good, unit)} годен · ${formatStatisticValue(summary.rejected, unit)} не годен`}
              accent="green"
            />
            <MetricCard
              icon={ClipboardCheck}
              label="ЛНК закрыто"
              value={formatPercent(summary.lnkClosurePercent)}
              detail={`${formatStatisticValue(summary.lnkClosed, unit)} из ${formatStatisticValue(summary.lnkRequests, unit)} заявок · всего результатов ${formatStatisticValue(summary.lnkTotalClosed, unit)}`}
              accent="indigo"
            />
            <MetricCard
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
      ) : (
        <WeldersStatisticsPanel summary={welderSummary} unit={unit} />
      )}
    </section>
  )
}

type MetricCardProps = {
  icon: typeof Activity
  label: string
  value: string
  detail: string
  accent: 'blue' | 'green' | 'indigo' | 'amber'
}

function MetricCard({ icon: Icon, label, value, detail, accent }: MetricCardProps) {
  const accentClass = {
    blue: 'bg-sky-50 text-sky-700 border-sky-100',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
  }[accent]

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-md border', accentClass)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm text-slate-500">{label}</div>
          <div className="text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
        </div>
      </div>
      <div className="mt-3 text-sm text-slate-500">{detail}</div>
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

function WeldersStatisticsPanel({ summary, unit }: { summary: ReturnType<typeof buildWelderStatisticsSummary>; unit: StatisticsUnit }) {
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
                    <WelderStatisticsTableRow key={row.stamp} row={row} unit={unit} />
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

function WelderStatisticsTableRow({ row, unit }: { row: WelderStatisticsRow; unit: StatisticsUnit }) {
  const controlled = row.good + row.rejected
  return (
    <tr className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
      <td className="px-4 py-3 font-semibold text-slate-900">{row.stamp}</td>
      <WelderBodyCell>{formatStatisticValue(row.total, unit)}</WelderBodyCell>
      <WelderBodyCell className="text-emerald-700">{formatStatisticValue(row.good, unit)}</WelderBodyCell>
      <WelderBodyCell>{formatStatisticValue(row.waitingRequest, unit)}</WelderBodyCell>
      <WelderBodyCell>{formatStatisticValue(row.waitingControl, unit)}</WelderBodyCell>
      <WelderBodyCell className="text-rose-700">{formatStatisticValue(row.rejected, unit)}</WelderBodyCell>
      <WelderBodyCell>
        <div className="flex items-center justify-end gap-2">
          <span>{formatPercent(row.defectPercent)}</span>
          <span className="text-xs font-normal text-slate-400">из {formatStatisticValue(controlled, unit)}</span>
        </div>
      </WelderBodyCell>
    </tr>
  )
}

function WelderHeaderCell({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('px-4 py-3 font-semibold', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>
}

function WelderBodyCell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 text-right font-medium text-slate-700', className)}>{children}</td>
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
