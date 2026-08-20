import { useEffect, useMemo, useState, type CSSProperties, type ReactNode, type RefCallback } from 'react'
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Download,
  FlaskConical,
  Gauge,
  LineChart,
  Minus,
  Plus,
  Search,
  Settings2,
  TimerReset,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogHeader } from '@/components/dialog-header'
import { Input } from '@/components/ui/input'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { isModalDialogOpen } from '@/lib/modal-layer'
import type { WeldRow } from '@/lib/dispatcher-types'
import { formatDisplayDate } from '@/lib/date-format'
import { formatJointDiameterLabel } from '@/lib/joint-display'
import {
  formatPercent,
  formatStatisticValue,
  getCurrentStatisticsWeek,
  getDefaultStatisticsPeriod,
  type StatisticsControlDynamicsScale,
  type StatisticsControlDynamicsScaleSetting,
  type StatisticsMethodSummary,
  type StatisticsStateRowIds,
  type StatisticsSummary,
  type StatisticsUnit,
} from '@/lib/statistics-summary'
import type { LineSummary, LineSummaryRow } from '@/lib/line-summary'
import {
  isPercentageControlMethodAvailableForRow,
  type PercentageControlMethod,
  type PercentageLineSummary,
  type PercentageLineStampSummary,
} from '@/lib/percentage-line-summary'
import {
  type WelderStatisticsJointFilter,
  type WelderStatisticsRow,
  type WelderStatisticsSummary,
} from '@/lib/welder-statistics-summary'
import {
  WELDING_DYNAMICS_MISSING_MATERIAL_GROUP_KEY,
  WELDING_DYNAMICS_MISSING_PROJECT_GROUP_KEY,
  WELDING_DYNAMICS_OTHER_MATERIAL_GROUP_KEY,
  WELDING_DYNAMICS_OTHER_PROJECT_GROUP_KEY,
  formatWeldingDynamicsBucketHeaderLabel,
  getStableWeldingDynamicsColorIndex,
  type WeldingDynamicsBucket,
  type WeldingDynamicsJointType,
  type WeldingDynamicsMaterialGroup,
  type WeldingDynamicsProjectGroup,
  type WeldingDynamicsScaleSetting,
  type WeldingDynamicsSummary,
} from '@/lib/welding-dynamics'
import type { PercentageLineStampFilter } from '@/lib/report-navigation'
import { openPrintableReport, type PrintableReport } from '@/lib/printable-report'
import { buildWeldingDynamicsJointTypeTable } from '@/lib/statistics-welding-dynamics-report'
import { isAdditionalControlValue, isCancelledControlValue, isEnabledControlValue } from '@/lib/report-value-utils'
import { cn } from '@/lib/utils'
import { useStatisticsServerQuery } from '@/lib/use-statistics-server-query'
import { useWeldRowsByIdsQuery } from '@/lib/use-weld-rows-by-ids-query'
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'
import { useWindowTableVirtualization } from '@/lib/use-window-table-virtualization'
import { calculateFinalStatus, CONTROL_RESULT_PAIRS, formatFinalStatusDisplay, normalizeResultStatus } from '@/lib/weld-status'

type StatisticsPageProps = {
  fixedTab?: StatisticsTab
  onAssignPercentageLineMissingControls?: (rowIds: number[], method: PercentageControlMethod) => Promise<void> | void
  onCancelPercentageLineMissingControls?: (rowIds: number[]) => Promise<void> | void
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
  onOpenWeldRowIds?: (rowIds: number[], message?: string) => void
  onOpenReportRowIds?: (
    rowIds: number[],
    targetReport: 'weldingJournal' | 'lnk' | 'heatTreatment',
    message?: string,
  ) => void
}

type StatisticsTargetReport = 'weldingJournal' | 'lnk' | 'heatTreatment'
type StatisticsRowsOpenHandler = (rowIds: number[], message?: string) => void

type StatisticsTab = 'general' | 'lnk' | 'psto' | 'welders' | 'lineSummary' | 'percentageLines'

type StatisticsTimeSettings = {
  period: ReturnType<typeof getDefaultStatisticsPeriod>
  allPeriod: boolean
}

const EMPTY_METHOD_SUMMARY: StatisticsMethodSummary = {
  code: '',
  requiredRequests: 0,
  createdRequests: 0,
  requestCoveragePercent: 0,
  requests: 0,
  closed: 0,
  totalClosed: 0,
  closedWithoutRequest: 0,
  pending: 0,
  waitingRequest: 0,
  waitingControl: 0,
  good: 0,
  rejected: 0,
  closurePercent: 0,
  rowIds: {
    requiredRequests: [],
    createdRequests: [],
    requests: [],
    closed: [],
    totalClosed: [],
    closedWithoutRequest: [],
    waitingRequest: [],
    waitingControl: [],
    good: [],
    rejected: [],
  },
}

const EMPTY_STATISTICS_SUMMARY: StatisticsSummary = {
  periodRows: [],
  backlogTotal: 0,
  backlogWaitingWeld: 0,
  backlogWaitingRepair: 0,
  totalRows: 0,
  welded: 0,
  weldedShare: 0,
  good: 0,
  rejected: 0,
  duplicateGood: 0,
  duplicateRejected: 0,
  waitingWeld: 0,
  waitingRequest: 0,
  waitingControl: 0,
  waitingRepair: 0,
  completedRepairs: 0,
  qualityPercent: 0,
  lnkRequiredRequests: 0,
  lnkCreatedRequests: 0,
  lnkRequestCoveragePercent: 0,
  lnkRequests: 0,
  lnkClosed: 0,
  lnkTotalClosed: 0,
  lnkClosurePercent: 0,
  pstoRequiredRequests: 0,
  pstoCreatedRequests: 0,
  pstoRequestCoveragePercent: 0,
  pstoRequests: 0,
  pstoClosed: 0,
  pstoTotalClosed: 0,
  pstoClosurePercent: 0,
  methods: [],
  pstoMethod: { ...EMPTY_METHOD_SUMMARY, code: 'ПСТО' },
  controlDynamicsScale: 'day',
  controlDynamics: [],
}

const EMPTY_STATISTICS_STATE_ROW_IDS: StatisticsStateRowIds = {
  good: [],
  rejected: [],
  duplicateGood: [],
  duplicateRejected: [],
  waitingWeld: [],
  waitingRequest: [],
  waitingControl: [],
  waitingRepair: [],
  backlog: [],
  backlogWaitingWeld: [],
  backlogWaitingRepair: [],
}

const EMPTY_WELDING_DYNAMICS: WeldingDynamicsSummary = {
  bucketUnit: 'day',
  bucketUnitLabel: 'день',
  buckets: [],
  periodDays: 0,
  totalValue: 0,
  totalWelders: 0,
  welderShiftCount: 0,
  averageWeldersPerShift: 0,
  averageValuePerWelderShift: 0,
  peakValue: 0,
  peakWelders: 0,
  materialGroups: [],
  projectGroups: [],
  jointTypes: [],
  materialJointTypes: [],
  projectJointTypes: [],
}

const EMPTY_WELDER_SUMMARY: WelderStatisticsSummary = {
  rows: [],
  totalWelders: 0,
  total: 0,
  good: 0,
  waitingRequest: 0,
  waitingControl: 0,
  rejected: 0,
  defectPercent: 0,
  fTotal: 0,
  sTotal: 0,
  fGood: 0,
  sGood: 0,
  fWaitingRequest: 0,
  sWaitingRequest: 0,
  fWaitingControl: 0,
  sWaitingControl: 0,
  fRejected: 0,
  sRejected: 0,
}

const EMPTY_LINE_SUMMARY: LineSummary = {
  rows: [],
  total: 0,
  completed: 0,
  remaining: 0,
}

const EMPTY_PERCENTAGE_LINE_SUMMARY: PercentageLineSummary[] = []

const jointFilterOptions: Array<[WelderStatisticsJointFilter, string]> = [
  ['all', 'Все'],
  ['f', 'F поле'],
  ['s', 'S база'],
]

function createDefaultStatisticsTimeSettings(): Record<StatisticsTab, StatisticsTimeSettings> {
  const currentPeriod = getDefaultStatisticsPeriod()
  const currentWeek = getCurrentStatisticsWeek()
  const currentPeriodSettings = (): StatisticsTimeSettings => ({
    period: { ...currentPeriod },
    allPeriod: false,
  })
  const currentWeekSettings = (): StatisticsTimeSettings => ({
    period: { ...currentWeek },
    allPeriod: false,
  })

  return {
    general: currentPeriodSettings(),
    lnk: currentWeekSettings(),
    psto: currentWeekSettings(),
    welders: currentPeriodSettings(),
    lineSummary: currentPeriodSettings(),
    percentageLines: currentPeriodSettings(),
  }
}

export function StatisticsPage({
  fixedTab,
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  onOpenPercentageLineStampRows,
  onOpenReportRowIds,
  onOpenWeldRowIds,
}: StatisticsPageProps) {
  const [selectedTab, setSelectedTab] = useState<StatisticsTab>(fixedTab ?? 'general')
  const activeTab = fixedTab ?? selectedTab
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [timeSettingsByTab, setTimeSettingsByTab] = useState<Record<StatisticsTab, StatisticsTimeSettings>>(
    createDefaultStatisticsTimeSettings,
  )
  const { period, allPeriod } = timeSettingsByTab[activeTab]
  const currentWeek = getCurrentStatisticsWeek()
  const isCurrentWeek =
    !allPeriod && period.from === currentWeek.from && period.to === currentWeek.to
  const [generalUnit, setGeneralUnit] = useState<StatisticsUnit>('wdi')
  const [lnkUnit, setLnkUnit] = useState<StatisticsUnit>('joints')
  const [pstoUnit, setPstoUnit] = useState<StatisticsUnit>('joints')
  const [weldersUnit, setWeldersUnit] = useState<StatisticsUnit>('joints')
  const [lineSummaryUnit, setLineSummaryUnit] = useState<StatisticsUnit>('joints')
  const [generalJointFilter, setGeneralJointFilter] = useState<WelderStatisticsJointFilter>('all')
  const [weldingDynamicsScaleSetting, setWeldingDynamicsScaleSetting] = useState<WeldingDynamicsScaleSetting>('auto')
  const [welderJointFilter, setWelderJointFilter] = useState<WelderStatisticsJointFilter>('all')
  const [projectFilter, setProjectFilter] = useState('')
  const [selectedSubtitles, setSelectedSubtitles] = useState<string[]>([])
  const [percentageLineSearch, setPercentageLineSearch] = useState('')
  const [controlDynamicsScaleByTab, setControlDynamicsScaleByTab] = useState<{
    lnk: StatisticsControlDynamicsScaleSetting
    psto: StatisticsControlDynamicsScaleSetting
  }>({ lnk: 'auto', psto: 'auto' })
  const controlDynamicsScaleSetting = activeTab === 'lnk' || activeTab === 'psto'
    ? controlDynamicsScaleByTab[activeTab]
    : 'auto'
  const openLnkRows = onOpenReportRowIds
    ? (rowIds: number[], message?: string) => onOpenReportRowIds(rowIds, 'lnk', message)
    : undefined
  const openHeatTreatmentRows = onOpenReportRowIds
    ? (rowIds: number[], message?: string) => onOpenReportRowIds(rowIds, 'heatTreatment', message)
    : undefined
  const unit =
    activeTab === 'lnk'
      ? lnkUnit
      : activeTab === 'psto'
        ? pstoUnit
      : activeTab === 'welders'
        ? weldersUnit
        : activeTab === 'lineSummary'
          ? lineSummaryUnit
          : generalUnit
  const setUnit =
    activeTab === 'lnk'
      ? setLnkUnit
      : activeTab === 'psto'
        ? setPstoUnit
      : activeTab === 'welders'
        ? setWeldersUnit
        : activeTab === 'lineSummary'
          ? setLineSummaryUnit
          : setGeneralUnit
  const jointFilter = activeTab === 'welders' ? welderJointFilter : generalJointFilter
  const setJointFilter = activeTab === 'welders' ? setWelderJointFilter : setGeneralJointFilter
  const updateActiveTimeSettings = (update: (current: StatisticsTimeSettings) => StatisticsTimeSettings) => {
    setTimeSettingsByTab((current) => ({
      ...current,
      [activeTab]: update(current[activeTab]),
    }))
  }

  const periodFrom = allPeriod ? '' : period.from
  const periodTo = allPeriod ? '' : period.to
  const statisticsQuery = useStatisticsServerQuery({
    tab: activeTab,
    projectFilter,
    selectedSubtitles,
    from: periodFrom,
    to: periodTo,
    unit,
    jointFilter,
    controlDynamicsScale: controlDynamicsScaleSetting,
    weldingDynamicsScale: activeTab === 'general' ? weldingDynamicsScaleSetting : 'auto',
  })
  const projectOptions = statisticsQuery.data?.projectOptions ?? []
  const subtitleOptions = statisticsQuery.data?.subtitleOptions ?? []
  const summary = statisticsQuery.data?.summary ?? EMPTY_STATISTICS_SUMMARY
  const weldingDynamics = statisticsQuery.data?.weldingDynamics ?? EMPTY_WELDING_DYNAMICS
  const welderSummary = statisticsQuery.data?.welderSummary ?? EMPTY_WELDER_SUMMARY
  const lineSummary = statisticsQuery.data?.lineSummary ?? EMPTY_LINE_SUMMARY
  const percentageLineSummary = statisticsQuery.data?.percentageLineSummary ?? EMPTY_PERCENTAGE_LINE_SUMMARY
  const generalProgressSummary = statisticsQuery.data?.generalProgressSummary ?? EMPTY_LINE_SUMMARY
  const generalStateRowIds = statisticsQuery.data?.generalStateRowIds ?? EMPTY_STATISTICS_STATE_ROW_IDS
  const orderedMethods = useMemo(() => {
    const methodsByCode = new Map([...summary.methods, summary.pstoMethod].map((method) => [method.code, method]))
    return ['ВИК', 'РК', 'УЗК', 'ПВК', 'ПСТО', 'ТВМТ', 'РФА', 'СТЛС', 'МКК']
      .map((code) => methodsByCode.get(code))
      .filter((method): method is StatisticsMethodSummary => Boolean(method))
  }, [summary.methods, summary.pstoMethod])
  const lnkMethods = useMemo(() => orderedMethods.filter((method) => method.code !== 'ПСТО'), [orderedMethods])
  const unofficialCount = statisticsQuery.data?.unofficialCount ?? 0
  const unofficialRowIds = statisticsQuery.data?.unofficialRowIds ?? []
  const unofficialValue = statisticsQuery.data?.unofficialValue ?? 0
  const lnkWaitingRequests = summary.methods.reduce((total, method) => total + method.waitingRequest, 0)
  const unitLabel = unit === 'joints' ? 'стыков' : 'WDI'
  const scopeLabel = getScopeLabel(projectFilter, selectedSubtitles, projectOptions, subtitleOptions)
  const periodDescription =
    activeTab === 'general'
      ? 'Стыки отбираются по дате сварки, а их годность и состояние показываются на текущий момент.'
      : activeTab === 'lnk'
        ? 'Заявки считаются по дате создания, заключения ЛНК — по дате заключения; потребность и состояния без заявки — по дате сварки.'
        : activeTab === 'psto'
          ? 'Заявки считаются по дате создания, заключения ПСТО — по дате проведения; потребность и состояния без заявки — по дате сварки.'
          : 'Стыки отбираются по дате сварки.'
  const printableReport = useMemo(
    () =>
      buildStatisticsPrintableReport({
        activeTab,
        dynamics: weldingDynamics,
        jointFilter,
        lineSummary,
        lnkMethods,
        percentageLines: filterPercentageLineSummaries(percentageLineSummary, percentageLineSearch),
        periodLabel: allPeriod || !periodFrom || !periodTo ? 'За весь период' : `${formatDisplayDate(periodFrom)} - ${formatDisplayDate(periodTo)}`,
        periodDescription,
        scopeLabel,
        summary,
        unofficialCount,
        unofficialValue,
        unit,
        welderSummary,
      }),
    [
      activeTab,
      allPeriod,
      jointFilter,
      lineSummary,
      lnkMethods,
      percentageLineSearch,
      percentageLineSummary,
      periodFrom,
      periodDescription,
      periodTo,
      scopeLabel,
      summary,
      unofficialCount,
      unofficialValue,
      unit,
      welderSummary,
      weldingDynamics,
    ],
  )
  return (
    <section className="w-full max-w-full min-w-0 space-y-4 pb-8">
      <div className="sticky top-0 z-30 rounded-md border border-slate-200 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
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
                  ЛНК
                </Button>
                <Button
                  className="h-9 rounded-md"
                  size="sm"
                  variant={activeTab === 'psto' ? 'default' : 'outline'}
                  onClick={() => setSelectedTab('psto')}
                >
                  ПСТО
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
            <p className={cn('truncate text-xs text-slate-500', fixedTab ? 'mt-0' : 'mt-2')} title={activeTab === 'general' ? `${periodDescription} ${scopeLabel}` : undefined}>
              {activeTab === 'lnk'
                ? 'Заявки, заключения, результаты и очереди лабораторного неразрушающего контроля.'
                : activeTab === 'psto'
                  ? 'Заявки, проведение и текущая очередь послесварочной термообработки.'
                : activeTab === 'general'
                  ? `${allPeriod || !periodFrom || !periodTo ? 'За весь период' : `${formatDisplayDate(periodFrom)} - ${formatDisplayDate(periodTo)}`} · ${scopeLabel} · ${getJointFilterLabel(generalJointFilter)} · ${generalUnit === 'wdi' ? 'WDI' : 'стыки'}`
                : activeTab === 'welders'
                  ? 'Вклад сварщиков по фактическим клеймам за выбранный период сварки.'
                  : activeTab === 'lineSummary'
                    ? 'Сводка по линиям с учетом актуальных стыков и текущего остатка.'
                    : 'Контроль процентных линий по официальным клеймам; для У-стыков учитывается ПВК.'}
            </p>
            {activeTab !== 'general' ? <p className="mt-1 text-xs text-slate-500">
              {activeTab === 'lnk'
                ? 'Каждый вид НК показан отдельно; значения и диаграмма открывают соответствующие строки отчета ЛНК.'
                : activeTab === 'psto'
                  ? 'Показатели и диаграмма открывают соответствующие строки отчета ПСТО. Неофициальные стыки вынесены отдельно.'
                : activeTab === 'welders'
                  ? 'Статистика сварщиков считается по дате сварки стыка; распределение идет только по фактическим клеймам.'
                  : activeTab === 'lineSummary'
                    ? 'Неактуальные по изменению строки и исторические стыки цепочки до годного результата не включаются.'
                    : 'Процентная линия определяется как линия с единым % контроля меньше 100; расчет идет отдельно по каждому официальному клейму.'}
            </p> : null}
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-2 rounded-md border-sky-200 bg-white text-sky-800 hover:bg-sky-50"
              onClick={() => openPrintableReport(printableReport)}
              title="Открыть печатный отчет в новой вкладке"
            >
              <Download className="h-4 w-4" />
              Отчет PDF
            </Button>
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
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
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
                        updateActiveTimeSettings((current) => ({
                          ...current,
                          allPeriod: false,
                          period: { ...current.period, from: event.target.value },
                        }))
                      }}
                      className="h-8 w-[128px] border-slate-200 text-sm"
                    />
                    <span className="text-slate-400">-</span>
                    <Input
                      aria-label="Период по"
                      type="date"
                      value={period.to}
                      onChange={(event) => {
                        updateActiveTimeSettings((current) => ({
                          ...current,
                          allPeriod: false,
                          period: { ...current.period, to: event.target.value },
                        }))
                      }}
                      className="h-8 w-[128px] border-slate-200 text-sm"
                    />
                    {activeTab === 'lnk' || activeTab === 'psto' ? (
                      <button
                        type="button"
                        className={segmentButtonClass(isCurrentWeek)}
                        onClick={() => {
                          const week = getCurrentStatisticsWeek()
                          updateActiveTimeSettings((current) => ({
                            ...current,
                            allPeriod: false,
                            period: week,
                          }))
                        }}
                      >
                        Текущая неделя
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={segmentButtonClass(allPeriod)}
                      onClick={() => {
                        updateActiveTimeSettings((current) => ({
                          ...current,
                          allPeriod: true,
                          period: { from: '', to: '' },
                        }))
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

      {statisticsQuery.isLoading ? (
        <div className="rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          Рассчитываем статистику по всей базе...
        </div>
      ) : statisticsQuery.error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Не удалось рассчитать статистику: {(statisticsQuery.error as Error).message}
        </div>
      ) : null}

      {activeTab === 'general' ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
              icon={TimerReset}
              label={`Среднее в смену, ${unit === 'wdi' ? 'WDI' : 'стыков'}`}
              value={formatAverageStatisticValue(weldingDynamics.periodDays > 0 ? weldingDynamics.totalValue / weldingDynamics.periodDays : 0)}
              detail={`${formatStatisticValue(weldingDynamics.totalValue, unit)} за ${weldingDynamics.periodDays} дн.`}
              accent="amber"
            />
            <MetricCard
              compact
              icon={Users}
              label="Сварщиков по факту"
              value={formatStatisticValue(weldingDynamics.totalWelders, 'joints')}
              detail={`В среднем в смену: ${formatAverageStatisticValue(weldingDynamics.averageWeldersPerShift)}`}
              accent="indigo"
            />
            <MetricCard
              compact
              wrapDetail
              wrapLabel
              icon={UserRound}
              label={getAveragePerWelderShiftLabel(unit)}
              value={formatValuePerWelderShift(weldingDynamics.averageValuePerWelderShift, weldingDynamics.welderShiftCount)}
              detail="Средняя фактическая выработка одного сварщика"
              accent="slate"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <ProgressMetricCard
              label="Выполнение сварки"
              value={generalProgressSummary.total > 0
                ? formatPercent((generalProgressSummary.completed / generalProgressSummary.total) * 100)
                : '—'}
              detail={generalProgressSummary.total > 0
                ? `${formatStatisticValue(generalProgressSummary.completed, unit)} выполнено из ${formatStatisticValue(generalProgressSummary.total, unit)}`
                : 'Нет стыков для расчета прогресса'}
              percent={generalProgressSummary.total > 0
                ? (generalProgressSummary.completed / generalProgressSummary.total) * 100
                : null}
              tone="sky"
            />
            <ProgressMetricCard
              label="Годность сварки"
              value={summary.good + summary.rejected > 0 ? formatPercent(summary.qualityPercent) : '—'}
              detail={summary.good + summary.rejected > 0
                ? `${formatStatisticValue(summary.good, unit)} годен · ${formatStatisticValue(summary.rejected, unit)} не годен`
                : 'Нет результатов для расчета годности'}
              percent={summary.good + summary.rejected > 0 ? summary.qualityPercent : null}
              tone="emerald"
            />
          </div>

          <WeldingDynamicsPanel
            jointFilter={generalJointFilter}
            scaleSetting={weldingDynamicsScaleSetting}
            summary={weldingDynamics}
            unit={unit}
            onScaleChange={setWeldingDynamicsScaleSetting}
          />

          <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <Panel
              title="Состояние стыков"
              subtitle={`За выбранный период: ${formatStatisticValue(summary.totalRows, unit)} ${unitLabel}; сварено ${formatStatisticValue(summary.welded, unit)}, из них ремонтов ${formatStatisticValue(summary.completedRepairs, unit)}.`}
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
                <StatusLine label="Годен" value={summary.good} unit={unit} rowIds={generalStateRowIds.good} onOpenRows={onOpenWeldRowIds} />
                <StatusLine label="Не годен" value={summary.rejected} unit={unit} rowIds={generalStateRowIds.rejected} onOpenRows={onOpenWeldRowIds} />
                <StatusLine label="Ожидает заявку" value={summary.waitingRequest} unit={unit} rowIds={generalStateRowIds.waitingRequest} onOpenRows={onOpenWeldRowIds} />
                <StatusLine label="Ожидает НК" value={summary.waitingControl} unit={unit} rowIds={generalStateRowIds.waitingControl} onOpenRows={onOpenWeldRowIds} />
                <StatusLine label="Ожидает ремонт" value={summary.waitingRepair} unit={unit} rowIds={generalStateRowIds.waitingRepair} onOpenRows={onOpenWeldRowIds} />
                <StatusLine label="Ожидает сварку" value={summary.waitingWeld} unit={unit} rowIds={generalStateRowIds.waitingWeld} onOpenRows={onOpenWeldRowIds} />
              </div>
            </Panel>

            <CurrentBacklogPanel summary={summary} stateRowIds={generalStateRowIds} unit={unit} onOpenRows={onOpenWeldRowIds} />
          </div>
        </>
      ) : activeTab === 'lnk' || activeTab === 'psto' ? (
        <ControlStatisticsPanel
          control={activeTab}
          controlDynamicsScale={summary.controlDynamicsScale}
          controlDynamicsScaleSetting={controlDynamicsScaleSetting}
          onControlDynamicsScaleChange={(scale) => {
            setControlDynamicsScaleByTab((current) => ({ ...current, [activeTab]: scale }))
          }}
          periodFrom={periodFrom}
          periodTo={periodTo}
          stateRowIds={generalStateRowIds}
          lnkMethods={lnkMethods}
          lnkWaitingRequests={lnkWaitingRequests}
          summary={summary}
          unofficialCount={unofficialCount}
          unofficialRowIds={unofficialRowIds}
          onOpenControlRows={activeTab === 'lnk' ? openLnkRows : openHeatTreatmentRows}
          onOpenStateRows={onOpenWeldRowIds}
          unit={unit}
        />
      ) : activeTab === 'welders' ? (
        <WeldersStatisticsPanel
          jointFilter={welderJointFilter}
          onOpenRows={onOpenWeldRowIds}
          summary={welderSummary}
          unit={unit}
        />
      ) : activeTab === 'percentageLines' ? (
        <PercentageLinesPanel
          onAssignPercentageLineMissingControls={onAssignPercentageLineMissingControls}
          onCancelPercentageLineMissingControls={onCancelPercentageLineMissingControls}
          summary={percentageLineSummary}
          onOpenPercentageLineStampRows={onOpenPercentageLineStampRows}
          onOpenWeldRowIds={onOpenWeldRowIds}
          search={percentageLineSearch}
          onSearchChange={setPercentageLineSearch}
        />
      ) : (
        <LineSummaryPanel onOpenRows={onOpenWeldRowIds} summary={lineSummary} unit={lineSummaryUnit} />
      )}
    </section>
  )
}

type MetricCardProps = {
  compact?: boolean
  wrapDetail?: boolean
  wrapLabel?: boolean
  icon: typeof Activity
  label: string
  value: string
  detail: string
  accent: 'blue' | 'green' | 'indigo' | 'amber' | 'slate'
  onClick?: () => void
  actionTitle?: string
}

function MetricCard({ compact = false, wrapDetail = false, wrapLabel = false, icon: Icon, label, value, detail, accent, onClick, actionTitle }: MetricCardProps) {
  const accentClass = {
    blue: 'bg-sky-50 text-sky-700 border-sky-100',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  }[accent]

  const content = (
    <>
      <div className={cn('flex items-center', compact ? 'gap-2.5' : 'gap-3')}>
        <span className={cn('flex items-center justify-center rounded-md border', compact ? 'h-9 w-9' : 'h-10 w-10', accentClass)}>
          <Icon className={cn(compact ? 'h-4 w-4' : 'h-5 w-5')} />
        </span>
        <div className="min-w-0">
          <div className={cn('flex items-center gap-1.5 text-sm text-slate-500', wrapLabel ? 'leading-snug' : 'truncate')} title={label}>{label}{onClick ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-sky-600" /> : null}</div>
          <div className={cn('font-semibold tracking-tight text-slate-900', compact ? 'text-xl' : 'text-2xl')}>{value}</div>
        </div>
      </div>
      <div
        className={cn('text-sm text-slate-500', compact ? 'mt-2' : 'mt-3', wrapDetail ? 'leading-snug' : 'truncate')}
        title={detail}
      >
        {detail}
      </div>
    </>
  )
  const className = cn('rounded-md border border-slate-200 bg-white text-left', compact ? 'p-3' : 'p-4')
  return onClick ? (
    <button type="button" className={cn(className, 'w-full transition-colors hover:border-sky-200 hover:bg-sky-50/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300')} title={actionTitle} onClick={onClick}>{content}</button>
  ) : <div className={className}>{content}</div>
}

function ProgressMetricCard({
  detail,
  label,
  percent,
  tone,
  value,
}: {
  detail: string
  label: string
  percent: number | null
  tone: 'emerald' | 'sky'
  value: string
}) {
  const toneClasses = tone === 'emerald'
    ? { bar: 'bg-emerald-500', value: 'text-emerald-700' }
    : { bar: 'bg-sky-500', value: 'text-sky-700' }

  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-600">{label}</div>
          <div className="mt-0.5 truncate text-sm text-slate-500" title={detail}>{detail}</div>
        </div>
        <div className={cn('shrink-0 text-2xl font-semibold tabular-nums', toneClasses.value)}>{value}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        {percent !== null ? (
          <div
            className={cn('h-full rounded-full transition-[width] duration-300', toneClasses.bar)}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        ) : null}
      </div>
    </div>
  )
}

function Panel({
  title,
  subtitle,
  headerAction,
  children,
}: {
  title: string
  subtitle?: string
  headerAction?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {headerAction ?? <LineChart className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />}
      </div>
      {children}
    </section>
  )
}

function WeldingDynamicsPanel({
  jointFilter,
  onScaleChange,
  scaleSetting,
  summary,
  unit,
}: {
  jointFilter: WelderStatisticsJointFilter
  onScaleChange: (scale: WeldingDynamicsScaleSetting) => void
  scaleSetting: WeldingDynamicsScaleSetting
  summary: WeldingDynamicsSummary
  unit: StatisticsUnit
}) {
  const unitLabel = unit === 'wdi' ? 'WDI' : 'стыков'
  const maxValue = Math.max(1, summary.peakValue)
  const maxWelders = Math.max(1, summary.peakWelders)
  const chartMinWidth = Math.max(720, summary.buckets.length * 112)
  const bucketText = getWeldingDynamicsBucketText(summary.bucketUnitLabel)
  const materialGroups = summary.materialGroups ?? []
  const projectGroups = summary.projectGroups ?? []
  const jointTypes = summary.jointTypes ?? []
  const [colorMode, setColorMode] = useState<'joint-types' | 'materials' | 'projects'>('joint-types')
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null)
  const [hoveredBucketKey, setHoveredBucketKey] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const activeColorMode = jointFilter === 'all' ? colorMode : 'materials'
  const showJointTypeColors = jointFilter === 'all' && colorMode === 'joint-types'
  const materialGroupColors = useMemo(
    () => new Map(materialGroups.map((group) => [group.key, getWeldingDynamicsMaterialGroupColor(group)])),
    [materialGroups],
  )
  const projectGroupColors = useMemo(
    () => new Map(projectGroups.map((group) => [group.key, getWeldingDynamicsProjectGroupColor(group)])),
    [projectGroups],
  )

  useEffect(() => {
    if (jointFilter === 'all') setColorMode('joint-types')
  }, [jointFilter])

  useEffect(() => {
    setSelectedBucketKey(null)
  }, [summary])

  const selectedBucket = summary.buckets.find((bucket) => bucket.key === selectedBucketKey) ?? null
  const detailLabel = selectedBucket?.label ?? 'За выбранный период'
  const detailValue = selectedBucket?.value ?? summary.totalValue
  const detailWelderCount = selectedBucket?.welderCount ?? summary.totalWelders
  const detailWelderShiftCount = selectedBucket?.welderShiftCount ?? summary.welderShiftCount
  const detailValuePerWelder = selectedBucket?.valuePerWelderShift ?? summary.averageValuePerWelderShift
  const detailColumnCount = jointTypes.length + 4
  const detailTableMinWidth = Math.max(960, detailColumnCount * 160)
  const detailJointTypes = jointTypes.map((jointType) => ({
    ...jointType,
    value: selectedBucket
      ? selectedBucket.jointTypes.find((candidate) => candidate.key === jointType.key)?.value ?? 0
      : jointType.value,
  }))
  const detailDimensionJointTypes = activeColorMode === 'projects'
    ? selectedBucket?.projectJointTypes ?? summary.projectJointTypes ?? []
    : selectedBucket?.materialJointTypes ?? summary.materialJointTypes ?? []
  const detailDimensionLabel = activeColorMode === 'projects' ? 'Проект' : 'Группа материала'
  const detailDimensionColors = activeColorMode === 'projects' ? projectGroupColors : materialGroupColors
  const tooltipBucket = summary.buckets.find((bucket) => bucket.key === hoveredBucketKey) ?? null
  const welderLinePoints = getWeldingDynamicsLinePoints(
    summary.buckets.map((bucket) => bucket.welderCount),
    maxWelders,
    WELDING_DYNAMICS_WELDER_PLOT_PERCENT,
    0.5,
  )

  useWindowEscapeKey(
    Boolean(selectedBucket),
    (event) => {
      if (isModalDialogOpen()) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement) activeElement.blur()
      setSelectedBucketKey(null)
    },
    { capture: true },
  )

  const selectBucket = (bucketKey: string) => {
    setDetailsOpen(true)
    setSelectedBucketKey((current) => current === bucketKey ? null : bucketKey)
  }

  const closeDetails = () => {
    setDetailsOpen(false)
    setSelectedBucketKey(null)
  }

  return (
    <Panel
      title="Динамика сварки"
      subtitle={`Интервал: ${bucketText}. Число над столбиком показывает общий объем в ${unitLabel}, графитовая линия и точки - количество сварщиков.`}
    >
      {summary.buckets.length > 0 ? (
        <div>
          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2.5 flex min-h-9 flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0 w-5 border-t border-dashed border-slate-600" />
                  Сварщики
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <DynamicsScaleControl
                  scale={summary.bucketUnit}
                  scaleSetting={scaleSetting}
                  onScaleChange={onScaleChange}
                />
                {jointFilter === 'all' ? (
                  <div className="inline-flex shrink-0 rounded-md border border-slate-200 bg-white p-0.5" aria-label="Расцветка диаграммы">
                  <button
                    type="button"
                    className={cn(
                      'rounded px-2 py-1 text-xs font-medium transition-colors sm:rounded-md sm:px-3 sm:py-1.5 sm:text-sm',
                      colorMode === 'joint-types'
                        ? 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                    )}
                    onClick={() => setColorMode('joint-types')}
                  >
                    <span className="sm:hidden">F/S</span>
                    <span className="hidden sm:inline">Тип стыка</span>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded px-2 py-1 text-xs font-medium transition-colors sm:rounded-md sm:px-3 sm:py-1.5 sm:text-sm',
                      colorMode === 'materials'
                        ? 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                    )}
                    onClick={() => setColorMode('materials')}
                  >
                    Материал
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded px-2 py-1 text-xs font-medium transition-colors sm:rounded-md sm:px-3 sm:py-1.5 sm:text-sm',
                      colorMode === 'projects'
                        ? 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                    )}
                    onClick={() => setColorMode('projects')}
                  >
                    Проект
                  </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="relative">
              {tooltipBucket ? (
                <WeldingDynamicsTooltip
                  bucket={tooltipBucket}
                  unit={unit}
                />
              ) : null}
            <div className="overflow-x-auto pb-3">
              <div
                className="relative grid items-end gap-2 pt-1"
                style={{ gridTemplateColumns: `repeat(${summary.buckets.length}, minmax(44px, 1fr))`, minWidth: chartMinWidth }}
              >
                <svg
                  className="pointer-events-none absolute inset-x-0 top-9 z-20 h-[calc(16rem-2.25rem)] w-full overflow-visible"
                  style={{ transform: 'translateX(20px)' }}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {welderLinePoints ? (
                    <polyline
                      points={welderLinePoints}
                      fill="none"
                      stroke="#334155"
                      strokeDasharray="3 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeOpacity="0.7"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </svg>
                {summary.peakWelders > 0 ? (
                  <div className="pointer-events-none absolute right-1 top-10 z-20 flex h-[calc(16rem-3rem)] flex-col justify-between rounded bg-white/85 px-1 py-0.5 text-[10px] font-medium tabular-nums text-slate-400 shadow-sm ring-1 ring-slate-100">
                    <span>{maxWelders}</span>
                    <span>{Math.round(maxWelders / 2)}</span>
                    <span>0 св.</span>
                  </div>
                ) : null}
                {summary.buckets.map((bucket) => {
                  const bucketHeaderLabel = formatWeldingDynamicsBucketHeaderLabel(bucket, summary.bucketUnit)
                  const valuePercent =
                    bucket.value > 0
                      ? Math.max(6, (bucket.value / maxValue) * WELDING_DYNAMICS_VALUE_PLOT_PERCENT)
                      : 0
                  const welderPercent =
                    bucket.welderCount > 0
                      ? Math.max(8, (bucket.welderCount / maxWelders) * WELDING_DYNAMICS_WELDER_PLOT_PERCENT)
                      : 0
                  const materialGroupLines = bucket.materialGroups.map((group) =>
                    `${group.label}: ${formatStatisticValue(group.value, unit)} ${unitLabel}`,
                  )
                  const bucketJointTypes = bucket.jointTypes ?? []
                  const bucketMaterialJointTypes = bucket.materialJointTypes ?? []
                  const bucketProjectJointTypes = bucket.projectJointTypes ?? []
                  const jointTypeLines = bucketJointTypes.map((jointType) =>
                    `${jointType.label}: ${formatStatisticValue(jointType.value, unit)} ${unitLabel}`,
                  )
                  const materialJointTypeLines = bucketMaterialJointTypes.flatMap((group) => [
                    `${group.label}: ${formatStatisticValue(group.value, unit)} ${unitLabel}`,
                    ...group.jointTypes.map((jointType) => `  ${jointType.label}: ${formatStatisticValue(jointType.value, unit)} ${unitLabel}`),
                  ])
                  const projectJointTypeLines = bucketProjectJointTypes.flatMap((group) => [
                    `${group.label}: ${formatStatisticValue(group.value, unit)} ${unitLabel}`,
                    ...group.jointTypes.map((jointType) => `  ${jointType.label}: ${formatStatisticValue(jointType.value, unit)} ${unitLabel}`),
                  ])
                  const title = [
                    `${bucket.label}: ${formatStatisticValue(bucket.value, unit)} ${unitLabel}; сварщиков ${bucket.welderCount}; на сварщика в смену ${formatValuePerWelderShift(bucket.valuePerWelderShift, bucket.welderShiftCount)} ${unitLabel}`,
                    'Типы стыков:',
                    ...jointTypeLines,
                    'Группы материалов:',
                    ...(materialJointTypeLines.length > 0 ? materialJointTypeLines : materialGroupLines),
                    'Проекты:',
                    ...projectJointTypeLines,
                  ].join('\n')
                  const segments = showJointTypeColors
                    ? bucketJointTypes.map((jointType) => ({
                        key: jointType.key,
                        value: jointType.value,
                        color: getWeldingDynamicsJointTypeColor(jointType),
                      }))
                    : activeColorMode === 'projects'
                      ? bucket.projectGroups.map((group) => ({
                          key: group.key,
                          value: group.value,
                          color: projectGroupColors.get(group.key),
                        }))
                      : bucket.materialGroups.map((group) => ({
                          key: group.key,
                          value: group.value,
                          color: materialGroupColors.get(group.key),
                        }))

                  return (
                    <div
                      key={bucket.key}
                      role="button"
                      tabIndex={0}
                      aria-label={`${title}. ${selectedBucketKey === bucket.key ? 'Показать весь период' : 'Открыть подробности'}`}
                      aria-pressed={selectedBucketKey === bucket.key}
                      className={cn(
                        "relative flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300",
                        selectedBucketKey === bucket.key && "bg-sky-50/40 after:pointer-events-none after:absolute after:inset-0 after:z-30 after:rounded-md after:border-2 after:border-sky-400 after:content-['']",
                      )}
                      onMouseEnter={() => setHoveredBucketKey(bucket.key)}
                      onMouseLeave={() => setHoveredBucketKey((current) => current === bucket.key ? null : current)}
                      onFocus={() => setHoveredBucketKey(bucket.key)}
                      onBlur={() => setHoveredBucketKey((current) => current === bucket.key ? null : current)}
                      onClick={() => selectBucket(bucket.key)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        selectBucket(bucket.key)
                      }}
                    >
                      <div className="flex h-64 w-full flex-col overflow-hidden rounded-md border border-slate-200 bg-white">
                        <div className="flex h-8 shrink-0 items-center justify-center border-b border-slate-100 bg-slate-50/80 px-1.5 text-center text-xs font-semibold tabular-nums text-slate-700">
                          {bucketHeaderLabel}
                        </div>
                        <div className="relative min-h-0 flex-1 overflow-hidden">
                          <div
                            className="absolute inset-x-0 border-t border-dashed border-slate-100"
                            style={{ bottom: `${WELDING_DYNAMICS_VALUE_PLOT_PERCENT / 3}%` }}
                          />
                          <div
                            className="absolute inset-x-0 border-t border-dashed border-slate-100"
                            style={{ bottom: `${(WELDING_DYNAMICS_VALUE_PLOT_PERCENT * 2) / 3}%` }}
                          />
                          <div
                            className="absolute bottom-0 left-1/2 flex w-10 -translate-x-1/2 flex-col-reverse overflow-hidden rounded-t-md bg-slate-100 shadow-sm ring-1 ring-inset ring-slate-200"
                            style={{ height: `${valuePercent}%` }}
                          >
                            {segments.length > 0
                              ? segments.map((segment) => (
                                  <span
                                    key={segment.key}
                                    className="block w-full shrink-0 border-t border-white/60 first:border-t-0"
                                    style={{
                                      backgroundColor: segment.color,
                                      height: `${bucket.value > 0 ? (segment.value / bucket.value) * 100 : 0}%`,
                                    }}
                                  />
                                ))
                              : bucket.value > 0
                                ? <span className="block h-full w-full bg-sky-400/70" />
                                : null}
                          </div>
                          {bucket.value > 0 ? (
                            <span
                              className="absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-white/90 px-1.5 text-[11px] font-bold leading-5 text-slate-800 shadow-sm"
                              style={{ bottom: `calc(${valuePercent}% + 3px)` }}
                            >
                              {formatStatisticValue(bucket.value, unit)}
                            </span>
                          ) : null}
                          {bucket.welderCount > 0 ? (
                            <span
                              className="absolute z-30 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-slate-800 shadow ring-1 ring-slate-300"
                              title={`${bucket.welderCount} сварщиков`}
                              style={{
                                bottom: `calc(${welderPercent}% - 6px)`,
                                left: 'clamp(12px, calc(50% + 20px), calc(100% - 12px))',
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                      <div className="flex h-[72px] w-full flex-col justify-center gap-0.5 overflow-hidden rounded-md border border-slate-200 bg-white px-2 py-2 text-left tabular-nums shadow-sm">
                        <div className="truncate text-sm font-bold leading-4 text-sky-700">
                          {formatStatisticValue(bucket.value, unit)} <span className="text-[11px] font-semibold text-slate-500">{unit === 'wdi' ? 'WDI' : 'ст.'}</span>
                        </div>
                        <div className="truncate text-xs font-medium leading-4 text-slate-500">{bucket.welderCount} св.</div>
                        <div className="truncate text-xs font-semibold leading-4 text-slate-700" title={`${bucket.welderCount} сварщиков; ${formatValuePerWelderShift(bucket.valuePerWelderShift, bucket.welderShiftCount)} ${unitLabel} на сварщика в смену`}>
                          {bucket.welderShiftCount > 0
                            ? `${formatAverageStatisticValue(bucket.valuePerWelderShift)} ${unit === 'wdi' ? 'WDI' : 'ст.'}/св.`
                            : `— ${unit === 'wdi' ? 'WDI' : 'ст.'}/св.`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            </div>
            {detailsOpen ? (
              <div className="relative mt-3 overflow-hidden rounded-md border border-slate-200 bg-white">
                <button
                  type="button"
                  className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="Закрыть подробности"
                  aria-label="Закрыть подробности"
                  onClick={closeDetails}
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="overflow-x-auto">
                  <table
                    className="w-full table-fixed border-collapse text-sm leading-5 text-slate-700"
                    style={{ minWidth: detailTableMinWidth }}
                  >
                    <colgroup>
                      {Array.from({ length: detailColumnCount }, (_, index) => (
                        <col key={index} style={{ width: `${100 / detailColumnCount}%` }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80">
                        <th className="sticky left-0 z-20 h-[62px] bg-slate-50 px-3 py-2.5 text-left align-middle font-semibold text-slate-700 shadow-[1px_0_0_0_#e2e8f0]">{detailLabel}</th>
                        {detailJointTypes.map((jointType) => (
                          <th key={jointType.key} className="h-[62px] px-3 py-2.5 text-right align-middle font-normal tabular-nums">
                            <span className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: getWeldingDynamicsJointTypeColor(jointType) }} />
                              <span className="text-slate-500">{jointType.label}</span>
                            </span>
                            <span className="mt-0.5 block font-semibold text-slate-800">{formatStatisticValue(jointType.value, unit)}</span>
                          </th>
                        ))}
                        <th className="h-[62px] bg-slate-100/70 px-3 py-2.5 text-right align-middle font-normal tabular-nums">
                          <span className="block text-slate-500">Всего</span>
                          <span className="mt-0.5 block font-semibold text-slate-800">{formatStatisticValue(detailValue, unit)} {unitLabel}</span>
                        </th>
                        <th className="h-[62px] px-3 py-2.5 text-right align-middle font-normal tabular-nums">
                          <span className="block text-slate-500">Сварщики</span>
                          <span className="mt-0.5 block font-semibold text-slate-800">{detailWelderCount}</span>
                        </th>
                        <th className="h-[62px] py-2.5 pl-3 pr-10 text-right align-middle font-normal tabular-nums">
                          <span className="block whitespace-nowrap text-slate-500">На сварщика</span>
                          <span className="mt-0.5 block font-semibold text-slate-800">
                            {formatValuePerWelderShift(detailValuePerWelder, detailWelderShiftCount)} {unitLabel}
                          </span>
                        </th>
                      </tr>
                      <tr className="border-b border-slate-200 bg-white text-slate-500">
                        <th className="sticky left-0 z-20 bg-white px-3 py-2.5 text-left font-medium shadow-[1px_0_0_0_#e2e8f0]">{detailDimensionLabel}</th>
                        {jointTypes.map((jointType) => (
                          <th key={jointType.key} className="px-3 py-2.5 text-right font-medium">{jointType.code}</th>
                        ))}
                        <th className="bg-slate-50 px-3 py-2.5 text-right font-semibold text-slate-700">Всего</th>
                        <th className="px-3 py-2.5 text-right font-medium">Сварщики</th>
                        <th className="px-3 py-2.5 text-right font-medium">На сварщика в смену</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailDimensionJointTypes.map((group) => (
                        <tr key={group.key} className="border-b border-slate-100 last:border-b-0 even:bg-slate-50/40">
                          <td className="sticky left-0 z-10 bg-white px-3 py-3 font-medium text-slate-800 shadow-[1px_0_0_0_#f1f5f9] even:bg-slate-50">
                            <span className="inline-flex items-center gap-2">
                              {!showJointTypeColors ? (
                                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: detailDimensionColors.get(group.key) }} />
                              ) : null}
                              {group.label}
                            </span>
                          </td>
                          {jointTypes.map((jointType) => (
                            <td key={jointType.key} className="px-3 py-3 text-right font-medium tabular-nums">
                              {formatStatisticValue(group.jointTypes.find((candidate) => candidate.key === jointType.key)?.value ?? 0, unit)}
                            </td>
                          ))}
                          <td className="bg-slate-50/80 px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{formatStatisticValue(group.value, unit)}</td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums">{group.welderCount}</td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums">
                            {formatValuePerWelderShift(group.valuePerWelderShift, group.welderShiftCount)} {group.welderShiftCount > 0 ? unitLabel : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
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

function WeldingDynamicsTooltip({
  bucket,
  unit,
}: {
  bucket: WeldingDynamicsBucket
  unit: StatisticsUnit
}) {
  const unitLabel = unit === 'wdi' ? 'WDI' : 'стыков'

  return (
    <div className="pointer-events-none absolute right-4 top-2 z-50 w-[min(320px,calc(100%-2rem))] rounded-md border border-slate-200 bg-white/95 p-3 text-xs text-slate-600 shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
        <div className="font-semibold text-slate-900">{bucket.label}</div>
        <div className="font-semibold tabular-nums text-sky-700">
          {formatStatisticValue(bucket.value, unit)} {unitLabel}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-2">
        <span>Сварщики</span>
        <span className="text-right font-medium tabular-nums text-slate-800">{bucket.welderCount}</span>
        <span>На сварщика</span>
        <span className="text-right font-medium tabular-nums text-slate-800">
          {formatValuePerWelderShift(bucket.valuePerWelderShift, bucket.welderShiftCount)} {unitLabel}
        </span>
      </div>
      <div className="space-y-2 border-t border-slate-100 pt-2">
        <WeldingDynamicsTooltipSection label="Типы стыков" items={bucket.jointTypes} unit={unit} />
        <WeldingDynamicsTooltipSection label="Материалы" items={bucket.materialGroups} unit={unit} />
        <WeldingDynamicsTooltipSection label="Проекты" items={bucket.projectGroups} unit={unit} />
      </div>
    </div>
  )
}

function WeldingDynamicsTooltipSection({
  items,
  label,
  unit,
}: {
  items: Array<{ key: string; label: string; value: number }>
  label: string
  unit: StatisticsUnit
}) {
  const visibleItems = items.filter((item) => item.value > 0)
  const displayedItems = visibleItems.slice(0, 3)
  const hiddenCount = visibleItems.length - displayedItems.length

  return (
    <div>
      <div className="mb-0.5 font-medium text-slate-500">{label}</div>
      {displayedItems.length > 0 ? (
        <div className="space-y-0.5">
          {displayedItems.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3">
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 font-medium tabular-nums text-slate-800">
                {formatStatisticValue(item.value, unit)}
              </span>
            </div>
          ))}
          {hiddenCount > 0 ? <div className="text-slate-400">ещё {hiddenCount}</div> : null}
        </div>
      ) : (
        <div className="text-slate-400">Нет данных</div>
      )}
    </div>
  )
}

function getWeldingDynamicsLinePoints(
  values: number[],
  maxValue: number,
  plotPercent: number,
  xOffset: number,
) {
  const visiblePoints = values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value > 0)
  if (visiblePoints.length < 2) return ''
  return visiblePoints
    .map(({ value, index }) => {
      const x = ((index + xOffset) / values.length) * 100
      const y = 100 - (value / Math.max(1, maxValue)) * plotPercent
      return `${x.toFixed(3)},${y.toFixed(3)}`
    })
    .join(' ')
}

const WELDING_DYNAMICS_MATERIAL_GROUP_COLORS = [
  '#69b9dd',
  '#66c2a0',
  '#e6b85c',
  '#a78bd4',
  '#e68b9b',
  '#61bbc1',
] as const

const WELDING_DYNAMICS_PROJECT_GROUP_COLORS = [
  '#7ba6d8',
  '#75b89b',
  '#d0a968',
  '#9b91c9',
  '#d58e9b',
  '#70b6bc',
] as const

const WELDING_DYNAMICS_VALUE_PLOT_PERCENT = 78
const WELDING_DYNAMICS_WELDER_PLOT_PERCENT = 72

const WELDING_DYNAMICS_JOINT_TYPE_COLORS = {
  s: '#f0bd62',
  unknown: '#a7b3c2',
  f: '#6f9ee8',
} as const

function getWeldingDynamicsJointTypeColor(jointType: WeldingDynamicsJointType) {
  return WELDING_DYNAMICS_JOINT_TYPE_COLORS[jointType.key]
}

function getWeldingDynamicsMaterialGroupColor(group: WeldingDynamicsMaterialGroup) {
  if (group.key === WELDING_DYNAMICS_MISSING_MATERIAL_GROUP_KEY) return '#a7b3c2'
  if (group.key === WELDING_DYNAMICS_OTHER_MATERIAL_GROUP_KEY) return '#b58ad0'
  return WELDING_DYNAMICS_MATERIAL_GROUP_COLORS[
    getStableWeldingDynamicsColorIndex(group.key, WELDING_DYNAMICS_MATERIAL_GROUP_COLORS.length)
  ]
}

function getWeldingDynamicsProjectGroupColor(group: WeldingDynamicsProjectGroup) {
  if (group.key === WELDING_DYNAMICS_MISSING_PROJECT_GROUP_KEY) return '#a7b3c2'
  if (group.key === WELDING_DYNAMICS_OTHER_PROJECT_GROUP_KEY) return '#b58ad0'
  return WELDING_DYNAMICS_PROJECT_GROUP_COLORS[
    getStableWeldingDynamicsColorIndex(group.key, WELDING_DYNAMICS_PROJECT_GROUP_COLORS.length)
  ]
}

function SegmentedProgress({
  items,
  onOpenRows,
  unit,
}: {
  items: Array<{ label: string; value: number; className: string; rowIds?: number[] }>
  onOpenRows?: (rowIds: number[], message?: string) => void
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
        {items.map((item) => {
          const content = <>
            <span className={cn('h-2 w-2 rounded-full', item.className)} />
            {item.label}: <span className="font-medium text-slate-800">{formatStatisticValue(item.value, unit)}</span>
            {item.rowIds && item.rowIds.length > 0 ? <ArrowUpRight className="h-3 w-3 text-sky-600" /> : null}
          </>
          return onOpenRows && item.rowIds && item.rowIds.length > 0 ? (
            <button
              key={item.label}
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-colors hover:border-sky-200 hover:bg-sky-50"
              title={`Открыть стыки: ${item.label.toLowerCase()}`}
              onClick={() => onOpenRows(item.rowIds ?? [], `Показаны стыки статистики «${item.label}»: ${item.rowIds?.length ?? 0}.`)}
            >
              {content}
            </button>
          ) : (
            <span key={item.label} className="inline-flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
              {content}
            </span>
          )
        })}
      </div>
    </>
  )
}

function StatusLine({
  compact = false,
  label,
  onOpenRows,
  rowIds,
  unit,
  value,
}: {
  compact?: boolean
  label: string
  onOpenRows?: (rowIds: number[], message?: string) => void
  rowIds?: number[]
  unit: StatisticsUnit | 'average'
  value: number | string
}) {
  const canOpen = Boolean(onOpenRows && rowIds && rowIds.length > 0)
  const content = (
    <>
      <div className={cn(compact ? 'text-[13px] leading-4' : 'text-xs', 'text-slate-500')}>{label}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className={cn('font-semibold tabular-nums text-slate-800', compact && 'text-base')}>
          {typeof value === 'string'
            ? value
            : unit === 'average'
              ? formatAverageStatisticValue(value)
              : formatStatisticValue(value, unit)}
        </span>
        {canOpen ? <ArrowUpRight className="h-3.5 w-3.5 text-sky-600" /> : null}
      </div>
    </>
  )

  if (!canOpen) {
    return <div className={cn('rounded border border-slate-100 bg-slate-50', compact ? 'px-2.5 py-1.5' : 'px-3 py-2')}>{content}</div>
  }

  return (
    <button
      type="button"
      className={cn(
        'rounded border border-slate-200 bg-slate-50 text-left transition-colors hover:border-sky-200 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
        compact ? 'px-2.5 py-1.5' : 'px-3 py-2',
      )}
      title={`Открыть стыки: ${label.toLowerCase()}`}
      onClick={() => onOpenRows?.(rowIds ?? [], `Показаны стыки статистики «${label}»: ${rowIds?.length ?? 0}.`)}
    >
      {content}
    </button>
  )
}

function CurrentBacklogPanel({
  onOpenRows,
  stateRowIds,
  summary,
  unit,
}: {
  onOpenRows?: (rowIds: number[], message?: string) => void
  stateRowIds?: StatisticsStateRowIds
  summary: StatisticsSummary
  unit: StatisticsUnit
}) {
  return (
    <Panel
      title="Текущий остаток"
      subtitle="Актуальные незаваренные стыки показаны отдельно и не прибавляются к показателям выбранного периода."
    >
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3 xl:grid-cols-1">
        <StatusLine label="Всего в остатке" value={summary.backlogTotal} unit={unit} rowIds={stateRowIds?.backlog} onOpenRows={onOpenRows} />
        <StatusLine label="Ожидает сварку" value={summary.backlogWaitingWeld} unit={unit} rowIds={stateRowIds?.backlogWaitingWeld} onOpenRows={onOpenRows} />
        <StatusLine label="Ожидает ремонт" value={summary.backlogWaitingRepair} unit={unit} rowIds={stateRowIds?.backlogWaitingRepair} onOpenRows={onOpenRows} />
      </div>
    </Panel>
  )
}

function ControlStatisticsPanel({
  control,
  controlDynamicsScale,
  controlDynamicsScaleSetting,
  lnkMethods,
  lnkWaitingRequests,
  onControlDynamicsScaleChange,
  onOpenControlRows,
  onOpenStateRows,
  periodFrom,
  periodTo,
  stateRowIds,
  summary,
  unofficialCount,
  unofficialRowIds,
  unit,
}: {
  control: 'lnk' | 'psto'
  controlDynamicsScale: StatisticsControlDynamicsScale
  controlDynamicsScaleSetting: StatisticsControlDynamicsScaleSetting
  lnkMethods: StatisticsMethodSummary[]
  lnkWaitingRequests: number
  onControlDynamicsScaleChange: (scale: StatisticsControlDynamicsScaleSetting) => void
  onOpenControlRows?: StatisticsRowsOpenHandler
  onOpenStateRows?: StatisticsRowsOpenHandler
  periodFrom: string
  periodTo: string
  stateRowIds: StatisticsStateRowIds
  summary: StatisticsSummary
  unofficialCount: number
  unofficialRowIds: number[]
  unit: StatisticsUnit
}) {
  const isLnk = control === 'lnk'
  const lnkWaitingControl = lnkMethods.reduce((total, method) => total + method.waitingControl, 0)
  const lnkGood = lnkMethods.reduce((total, method) => total + method.good, 0)
  const lnkRejected = lnkMethods.reduce((total, method) => total + method.rejected, 0)
  const lnkRequiredRowIds = mergeStatisticRowIds(lnkMethods.map((method) => method.rowIds.requiredRequests))
  const lnkCreatedRowIds = mergeStatisticRowIds(lnkMethods.map((method) => method.rowIds.createdRequests))
  const lnkRequestRowIds = mergeStatisticRowIds(lnkMethods.map((method) => method.rowIds.requests))
  const lnkClosedRowIds = mergeStatisticRowIds(lnkMethods.map((method) => method.rowIds.closed))
  const lnkWaitingRequestRowIds = mergeStatisticRowIds(lnkMethods.map((method) => method.rowIds.waitingRequest))
  const lnkWaitingControlRowIds = mergeStatisticRowIds(lnkMethods.map((method) => method.rowIds.waitingControl))
  const lnkGoodRowIds = mergeStatisticRowIds(lnkMethods.map((method) => method.rowIds.good))
  const lnkRejectedRowIds = mergeStatisticRowIds(lnkMethods.map((method) => method.rowIds.rejected))
  const jointStateStatuses: ControlJointStateStatus[] = [
    { label: 'Годен', value: summary.good, unit, rowIds: stateRowIds.good },
    { label: 'Не годен', value: summary.rejected, unit, rowIds: stateRowIds.rejected },
    { label: 'Ожидает заявку', value: summary.waitingRequest, unit, rowIds: stateRowIds.waitingRequest },
    { label: 'Ожидает НК', value: summary.waitingControl, unit, rowIds: stateRowIds.waitingControl },
    { label: 'Ожидает ремонт', value: summary.waitingRepair, unit, rowIds: stateRowIds.waitingRepair },
    { label: 'Неофициальные', value: unofficialCount, unit: 'joints', rowIds: unofficialRowIds },
    { label: 'Годен по дублю', value: summary.duplicateGood, unit, rowIds: stateRowIds.duplicateGood },
    { label: 'Не годен по дублю', value: summary.duplicateRejected, unit, rowIds: stateRowIds.duplicateRejected },
  ]

  return (
    <div className="space-y-4">
      {isLnk ? (
        <ControlWorkflowCard
          control="lnk"
          title="ЛНК"
          subtitle="Виды неразрушающего контроля"
          coverage={{
            percent: summary.lnkRequestCoveragePercent,
            completed: summary.lnkCreatedRequests,
            total: summary.lnkRequiredRequests,
            completedRowIds: lnkCreatedRowIds,
            totalRowIds: lnkRequiredRowIds,
          }}
          closure={{
            percent: summary.lnkClosurePercent,
            completed: summary.lnkClosed,
            total: summary.lnkRequests,
            completedRowIds: lnkClosedRowIds,
            totalRowIds: lnkRequestRowIds,
          }}
          statuses={[
            { label: 'Без заявки', value: lnkWaitingRequests, rowIds: lnkWaitingRequestRowIds, tone: 'amber' },
            { label: 'Ожидает заключение', value: lnkWaitingControl, rowIds: lnkWaitingControlRowIds, tone: 'sky' },
            { label: 'Годные', value: lnkGood, rowIds: lnkGoodRowIds, tone: 'green' },
            { label: 'Не годен', value: lnkRejected, rowIds: lnkRejectedRowIds, tone: 'rose' },
          ]}
          jointStateTotal={summary.totalRows}
          jointStateStatuses={jointStateStatuses}
          onOpenRows={onOpenControlRows}
          onOpenStateRows={onOpenStateRows}
          unit={unit}
        />
      ) : (
        <ControlWorkflowCard
          control="psto"
          title="ПСТО"
          subtitle="Послесварочная термообработка"
          coverage={{
            percent: summary.pstoRequestCoveragePercent,
            completed: summary.pstoCreatedRequests,
            total: summary.pstoRequiredRequests,
            completedRowIds: summary.pstoMethod.rowIds.createdRequests,
            totalRowIds: summary.pstoMethod.rowIds.requiredRequests,
          }}
          closure={{
            percent: summary.pstoClosurePercent,
            completed: summary.pstoClosed,
            total: summary.pstoRequests,
            completedRowIds: summary.pstoMethod.rowIds.closed,
            totalRowIds: summary.pstoMethod.rowIds.requests,
          }}
          statuses={[
            { label: 'Без заявки', value: summary.pstoMethod.waitingRequest, rowIds: summary.pstoMethod.rowIds.waitingRequest, tone: 'amber' },
            { label: 'Ожидает ПСТО', value: summary.pstoMethod.waitingControl, rowIds: summary.pstoMethod.rowIds.waitingControl, tone: 'sky' },
            { label: 'Проведено', value: summary.pstoMethod.good, rowIds: summary.pstoMethod.rowIds.good, tone: 'green' },
          ]}
          jointStateTotal={summary.totalRows}
          jointStateStatuses={jointStateStatuses}
          onOpenRows={onOpenControlRows}
          onOpenStateRows={onOpenStateRows}
          unit={unit}
        />
      )}

      <ControlDynamicsPanel
        buckets={summary.controlDynamics}
        control={control}
        scale={controlDynamicsScale}
        scaleSetting={controlDynamicsScaleSetting}
        onScaleChange={onControlDynamicsScaleChange}
        onOpenRows={onOpenControlRows}
        periodFrom={periodFrom}
        periodTo={periodTo}
        unit={unit}
      />

      {isLnk ? (
        <Panel
          title="ЛНК по видам контроля"
          subtitle="Все этапы по каждому виду НК. Нажмите на значение, чтобы открыть соответствующие стыки в отчете ЛНК."
        >
          <div className="overflow-hidden rounded-md border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1090px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[100px]" />
                  <col className="w-[210px]" />
                  <col className="w-[135px]" />
                  <col className="w-[200px]" />
                  <col className="w-[185px]" />
                  <col className="w-[125px]" />
                  <col className="w-[135px]" />
                </colgroup>
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-3 text-left font-semibold">Вид НК</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Потребность / заявлено</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Без заявки</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Заявок / закрыто</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Ожидает заключение</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Годен</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Не годен</th>
                  </tr>
                </thead>
                <tbody>
                  {lnkMethods.map((method) => (
                    <tr key={method.code} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                      <td className="px-3 py-3 font-semibold text-slate-900">{method.code}</td>
                      <td className="px-3 py-3"><MethodCoverageCell method={method} onOpenRows={onOpenControlRows} /></td>
                      <MethodValueCell label={`${method.code}: без заявки`} onOpenRows={onOpenControlRows} rowIds={method.rowIds.waitingRequest} tone="amber" unit={unit} value={method.waitingRequest} />
                      <td className="px-3 py-3"><MethodClosureCell method={method} onOpenRows={onOpenControlRows} unit={unit} /></td>
                      <MethodValueCell label={`${method.code}: ожидает заключение`} onOpenRows={onOpenControlRows} rowIds={method.rowIds.waitingControl} tone="sky" unit={unit} value={method.waitingControl} />
                      <MethodValueCell label={`${method.code}: годен`} onOpenRows={onOpenControlRows} rowIds={method.rowIds.good} tone="green" unit={unit} value={method.good} />
                      <MethodValueCell label={`${method.code}: не годен`} onOpenRows={onOpenControlRows} rowIds={method.rowIds.rejected} tone="rose" unit={unit} value={method.rejected} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      ) : (
        <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-sm font-semibold text-slate-800">Дополнительно по ПСТО</h2>
            <p className="text-xs text-slate-500">Показатели открывают соответствующие строки отчета</p>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <StatusLine compact label="Всего заключений" value={summary.pstoMethod.totalClosed} unit={unit} rowIds={summary.pstoMethod.rowIds.totalClosed} onOpenRows={onOpenControlRows} />
            <StatusLine compact label="Заключения без заявки" value={summary.pstoMethod.closedWithoutRequest} unit={unit} rowIds={summary.pstoMethod.rowIds.closedWithoutRequest} onOpenRows={onOpenControlRows} />
          </div>
        </section>
      )}

    </div>
  )
}

type ControlWorkflowStatus = {
  label: string
  value: number
  rowIds: number[]
  tone: 'amber' | 'sky' | 'rose' | 'green'
}

type ControlJointStateStatus = {
  label: string
  value: number
  rowIds: number[]
  unit: StatisticsUnit
}

function ControlDynamicsPanel({
  buckets,
  control,
  onOpenRows,
  onScaleChange,
  periodFrom,
  periodTo,
  scale,
  scaleSetting,
  unit,
}: {
  buckets: StatisticsSummary['controlDynamics']
  control: 'lnk' | 'psto'
  onOpenRows?: StatisticsRowsOpenHandler
  onScaleChange: (scale: StatisticsControlDynamicsScaleSetting) => void
  periodFrom: string
  periodTo: string
  scale: StatisticsControlDynamicsScale
  scaleSetting: StatisticsControlDynamicsScaleSetting
  unit: StatisticsUnit
}) {
  const visibleBuckets = getVisibleControlDynamicsBuckets(buckets, control, periodFrom, periodTo, scale)
  const maxValue = Math.max(
    1,
    ...visibleBuckets.flatMap((bucket) =>
      control === 'lnk'
        ? [bucket.lnkRequests, bucket.lnkClosed]
        : [bucket.pstoRequests, bucket.pstoClosed],
    ),
  )
  const minWidth = Math.max(640, visibleBuckets.length * 88)
  const isLnk = control === 'lnk'
  return (
    <Panel
      title={`Динамика заявок и заключений ${isLnk ? 'ЛНК' : 'ПСТО'}`}
      subtitle="Масштаб подбирается по длине периода. Нажмите на столбик, чтобы открыть строки выбранного интервала."
      headerAction={(
        <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-400" />Заявки</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />Заключения</span>
          </div>
          <DynamicsScaleControl
            scale={scale}
            scaleSetting={scaleSetting}
            onScaleChange={onScaleChange}
          />
        </div>
      )}
    >
      {visibleBuckets.length > 0 ? (
        <div className="overflow-x-auto pb-1">
          <div className="grid gap-x-2 gap-y-2" style={{ gridTemplateColumns: `repeat(${visibleBuckets.length}, minmax(80px, 1fr))`, minWidth }}>
            {visibleBuckets.map((bucket) => <div key={bucket.date} className="text-center text-xs font-semibold tabular-nums text-slate-500">{formatControlDynamicsBucketLabel(bucket, scale)}</div>)}
            {visibleBuckets.map((bucket) => (
              <ControlDynamicsCell
                key={`${control}-${bucket.date}`}
                closed={isLnk ? bucket.lnkClosed : bucket.pstoClosed}
                closedRowIds={isLnk ? bucket.lnkClosedRowIds : bucket.pstoClosedRowIds}
                dateLabel={formatControlDynamicsBucketLabel(bucket, scale)}
                maxValue={maxValue}
                onOpenRows={onOpenRows}
                requests={isLnk ? bucket.lnkRequests : bucket.pstoRequests}
                requestRowIds={isLnk ? bucket.lnkRequestRowIds : bucket.pstoRequestRowIds}
                unit={unit}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[200px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          В выбранном периоде нет датированных заявок и заключений {isLnk ? 'ЛНК' : 'ПСТО'}.
        </div>
      )}
    </Panel>
  )
}

function getVisibleControlDynamicsBuckets(
  buckets: StatisticsSummary['controlDynamics'],
  control: 'lnk' | 'psto',
  periodFrom: string,
  periodTo: string,
  scale: StatisticsControlDynamicsScale,
) {
  const relevantBuckets = buckets.filter((bucket) =>
    control === 'lnk'
      ? bucket.lnkRequests > 0 || bucket.lnkClosed > 0
      : bucket.pstoRequests > 0 || bucket.pstoClosed > 0,
  )
  const weekDates = scale === 'day' ? getSevenDayIsoRange(periodFrom, periodTo) : []
  if (weekDates.length === 0) return relevantBuckets
  const bucketsByDate = new Map(relevantBuckets.map((bucket) => [bucket.date, bucket]))
  return weekDates.map((date) => bucketsByDate.get(date) ?? {
    date,
    dateTo: date,
    lnkRequests: 0,
    lnkClosed: 0,
    pstoRequests: 0,
    pstoClosed: 0,
    lnkRequestRowIds: [],
    lnkClosedRowIds: [],
    pstoRequestRowIds: [],
    pstoClosedRowIds: [],
  })
}

function getSevenDayIsoRange(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  const dayMs = 24 * 60 * 60 * 1000
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 6 * dayMs) return []
  return Array.from({ length: 7 }, (_, index) => new Date(start + index * dayMs).toISOString().slice(0, 10))
}

const CONTROL_DYNAMICS_SCALE_ORDER: StatisticsControlDynamicsScale[] = ['day', 'week', 'month', 'quarter', 'year']
const CONTROL_DYNAMICS_SCALE_LABELS: Record<StatisticsControlDynamicsScale, string> = {
  day: 'День',
  week: 'Неделя',
  month: 'Месяц',
  quarter: 'Квартал',
  year: 'Год',
}

function DynamicsScaleControl({
  onScaleChange,
  scale,
  scaleSetting,
}: {
  onScaleChange: (scale: StatisticsControlDynamicsScaleSetting) => void
  scale: StatisticsControlDynamicsScale
  scaleSetting: StatisticsControlDynamicsScaleSetting
}) {
  const scaleIndex = CONTROL_DYNAMICS_SCALE_ORDER.indexOf(scale)
  const coarserScale = CONTROL_DYNAMICS_SCALE_ORDER[scaleIndex + 1]
  const finerScale = CONTROL_DYNAMICS_SCALE_ORDER[scaleIndex - 1]
  return (
    <div className="inline-flex h-8 items-center overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" aria-label="Масштаб диаграммы">
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center border-r border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        disabled={!coarserScale}
        title="Укрупнить масштаб"
        aria-label="Укрупнить масштаб"
        onClick={() => coarserScale && onScaleChange(coarserScale)}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="h-8 min-w-[112px] px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
        title="Вернуть автоматический масштаб"
        onClick={() => onScaleChange('auto')}
      >
        {CONTROL_DYNAMICS_SCALE_LABELS[scale]}{scaleSetting === 'auto' ? ' · авто' : ''}
      </button>
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center border-l border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        disabled={!finerScale}
        title="Детализировать масштаб"
        aria-label="Детализировать масштаб"
        onClick={() => finerScale && onScaleChange(finerScale)}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function formatControlDynamicsBucketLabel(
  bucket: StatisticsSummary['controlDynamics'][number],
  scale: StatisticsControlDynamicsScale,
) {
  if (scale === 'day') return formatDisplayDate(bucket.date).slice(0, 5)
  if (scale === 'week') return `${formatDisplayDate(bucket.date).slice(0, 5)}–${formatDisplayDate(bucket.dateTo).slice(0, 5)}`
  const date = new Date(`${bucket.date}T00:00:00Z`)
  if (scale === 'month') {
    const label = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
    return label.replace('.', '')
  }
  if (scale === 'quarter') return `${Math.floor(date.getUTCMonth() / 3) + 1} кв. ${date.getUTCFullYear()}`
  return String(date.getUTCFullYear())
}

function ControlDynamicsCell({
  closed,
  closedRowIds,
  dateLabel,
  maxValue,
  onOpenRows,
  requests,
  requestRowIds,
  unit,
}: {
  closed: number
  closedRowIds: number[]
  dateLabel: string
  maxValue: number
  onOpenRows?: StatisticsRowsOpenHandler
  requests: number
  requestRowIds: number[]
  unit: StatisticsUnit
}) {
  const open = (rowIds: number[], label: string) => onOpenRows?.(rowIds, `${label} за ${dateLabel}: ${rowIds.length} стыков.`)
  return (
    <div className="grid min-h-[200px] grid-rows-[1fr_auto] rounded-md border border-slate-100 bg-slate-50/60 px-2 pb-2 pt-3">
      <div className="flex h-40 items-end justify-center gap-2">
        <ControlDynamicsBar color="bg-sky-400" label="Заявки" onClick={() => open(requestRowIds, 'Заявки')} rowIds={requestRowIds} value={requests} maxValue={maxValue} unit={unit} />
        <ControlDynamicsBar color="bg-emerald-400" label="Заключения" onClick={() => open(closedRowIds, 'Заключения')} rowIds={closedRowIds} value={closed} maxValue={maxValue} unit={unit} />
      </div>
      <div className="mt-1 text-center text-[10px] tabular-nums text-slate-500">{formatStatisticValue(requests, unit)} / {formatStatisticValue(closed, unit)}</div>
    </div>
  )
}

function ControlDynamicsBar({ color, label, maxValue, onClick, rowIds, unit, value }: { color: string; label: string; maxValue: number; onClick: () => void; rowIds: number[]; unit: StatisticsUnit; value: number }) {
  const height = value > 0 ? Math.max(8, (value / maxValue) * 152) : 2
  const bar = <span className={cn('block w-4 rounded-t-sm transition-opacity', value > 0 ? color : 'bg-slate-200')} style={{ height }} />
  return rowIds.length > 0 ? (
    <button type="button" className="flex h-40 items-end hover:opacity-75" title={`${label}: ${formatStatisticValue(value, unit)}`} onClick={onClick}>{bar}</button>
  ) : <span className="flex h-40 items-end" title={`${label}: ${formatStatisticValue(value, unit)}`}>{bar}</span>
}

function ControlWorkflowCard({
  closure,
  control,
  coverage,
  jointStateStatuses,
  jointStateTotal,
  onOpenRows,
  onOpenStateRows,
  statuses,
  subtitle,
  title,
  unit,
}: {
  closure: { percent: number; completed: number; total: number; completedRowIds: number[]; totalRowIds: number[] }
  control: 'lnk' | 'psto'
  coverage: { percent: number; completed: number; total: number; completedRowIds: number[]; totalRowIds: number[] }
  jointStateStatuses: ControlJointStateStatus[]
  jointStateTotal: number
  onOpenRows?: StatisticsRowsOpenHandler
  onOpenStateRows?: (rowIds: number[], message?: string) => void
  statuses: ControlWorkflowStatus[]
  subtitle: string
  title: string
  unit: StatisticsUnit
}) {
  const WorkflowIcon = control === 'psto' ? TimerReset : FlaskConical
  const openRows = onOpenRows
    ? (rowIds: number[], label: string) =>
        onOpenRows(rowIds, `Показаны стыки статистики «${title}: ${label}»: ${rowIds.length}.`)
    : undefined

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md border',
              control === 'psto'
                ? 'border-amber-100 bg-amber-50 text-amber-700'
                : 'border-sky-100 bg-sky-50 text-sky-700',
            )}>
              <WorkflowIcon className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              <p className="text-xs text-slate-500">{subtitle}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <WorkflowProgress
          completed={coverage.completed}
          completedLabel="Заявлено"
          completedRowIds={coverage.completedRowIds}
          label="Покрытие потребности"
          onOpenRows={openRows}
          percent={coverage.percent}
          tone="sky"
          total={coverage.total}
          totalLabel="Требуется"
          totalRowIds={coverage.totalRowIds}
          unit="positions"
        />
        <WorkflowProgress
          completed={closure.completed}
          completedLabel="Закрыто"
          completedRowIds={closure.completedRowIds}
          label="Закрытие заявок"
          onOpenRows={openRows}
          percent={closure.percent}
          tone="emerald"
          total={closure.total}
          totalLabel="Заявок"
          totalRowIds={closure.totalRowIds}
          unit={unit}
        />
      </div>
      <div className={cn(
        'mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3',
        statuses.length >= 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3',
      )}>
        {statuses.map((status) => (
          <WorkflowStatusButton
            key={status.label}
            {...status}
            onOpen={openRows ? () => openRows(status.rowIds, status.label) : undefined}
            unit={unit}
          />
        ))}
      </div>
      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-semibold text-slate-800">Состояние стыков по дате сварки</h3>
          <p className="text-xs text-slate-500">
            За выбранный период: {formatStatisticValue(jointStateTotal, unit)} {unit === 'wdi' ? 'WDI' : 'стыков'}
          </p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8">
          {jointStateStatuses.map((status) => (
            <StatusLine
              key={status.label}
              compact
              label={status.label}
              onOpenRows={onOpenStateRows}
              rowIds={status.rowIds}
              unit={status.unit}
              value={status.value}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function WorkflowProgress({
  completed,
  completedLabel,
  completedRowIds,
  label,
  onOpenRows,
  percent,
  tone,
  total,
  totalLabel,
  totalRowIds,
  unit,
}: {
  completed: number
  completedLabel: string
  completedRowIds: number[]
  label: string
  onOpenRows?: (rowIds: number[], label: string) => void
  percent: number
  tone: 'sky' | 'emerald'
  total: number
  totalLabel: string
  totalRowIds: number[]
  unit: StatisticsUnit | 'positions'
}) {
  const barClass = tone === 'emerald' ? 'bg-emerald-500' : 'bg-sky-500'
  const valueClass = tone === 'emerald' ? 'text-emerald-700' : 'text-sky-700'
  const formatValue = (value: number) => unit === 'positions' ? String(Math.round(value)) : formatStatisticValue(value, unit)
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50/70 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[15px] font-semibold text-slate-700">{label}</div>
        <div className={cn('text-2xl font-semibold tabular-nums leading-none', valueClass)}>{formatPercent(percent)}</div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-100">
        <div className={cn('h-full rounded-full', barClass)} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 text-sm text-slate-500">
        <WorkflowInlineLink label={totalLabel} onClick={onOpenRows ? () => onOpenRows(totalRowIds, totalLabel) : undefined} rowIds={totalRowIds} value={formatValue(total)} />
        <WorkflowInlineLink label={completedLabel} onClick={onOpenRows ? () => onOpenRows(completedRowIds, completedLabel) : undefined} rowIds={completedRowIds} value={formatValue(completed)} />
      </div>
    </div>
  )
}

function WorkflowInlineLink({ label, onClick, rowIds, value }: { label: string; onClick?: () => void; rowIds: number[]; value: string }) {
  if (!onClick || rowIds.length === 0) return <span>{label}: <strong className="text-slate-700">{value}</strong></span>
  return (
    <button type="button" className="inline-flex items-center gap-1 hover:text-sky-700" onClick={onClick}>
      {label}: <strong className="text-slate-700">{value}</strong><ArrowUpRight className="h-3 w-3" />
    </button>
  )
}

function WorkflowStatusButton({ label, onOpen, rowIds, tone, unit, value }: ControlWorkflowStatus & { onOpen?: () => void; unit: StatisticsUnit }) {
  const toneClass = {
    amber: 'border-amber-100 bg-amber-50/65 text-amber-800',
    sky: 'border-sky-100 bg-sky-50/65 text-sky-800',
    rose: 'border-rose-100 bg-rose-50/65 text-rose-800',
    green: 'border-emerald-100 bg-emerald-50/65 text-emerald-800',
  }[tone]
  const content = <><span className="min-w-0 font-medium leading-5">{label}</span><strong className="text-base tabular-nums">{formatStatisticValue(value, unit)}</strong>{rowIds.length > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}</>
  return onOpen && rowIds.length > 0 ? (
    <button type="button" className={cn('grid min-h-12 grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:brightness-95', toneClass)} onClick={onOpen}>{content}</button>
  ) : (
    <div className={cn('grid min-h-12 grid-cols-[1fr_auto] items-center gap-2 rounded-md border px-3 py-2.5 text-sm', toneClass)}>{content}</div>
  )
}

function MethodCoverageCell({ method, onOpenRows }: { method: StatisticsMethodSummary; onOpenRows?: StatisticsRowsOpenHandler }) {
  return (
    <div className="ml-auto w-44">
      <div className="flex items-center justify-end gap-2 text-xs">
        <MethodInlineLink label="требуется" onOpenRows={onOpenRows} rowIds={method.rowIds.requiredRequests} value={String(method.requiredRequests)} />
        <span className="text-slate-300">/</span>
        <MethodInlineLink label="заявлено" onOpenRows={onOpenRows} rowIds={method.rowIds.createdRequests} value={String(method.createdRequests)} />
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-400" style={{ width: `${method.requestCoveragePercent}%` }} /></div>
    </div>
  )
}

function MethodClosureCell({ method, onOpenRows, unit }: { method: StatisticsMethodSummary; onOpenRows?: StatisticsRowsOpenHandler; unit: StatisticsUnit }) {
  return (
    <div className="ml-auto w-44">
      <div className="flex items-center justify-end gap-2 text-xs">
        <MethodInlineLink label="заявок" onOpenRows={onOpenRows} rowIds={method.rowIds.requests} value={formatStatisticValue(method.requests, unit)} />
        <span className="text-slate-300">/</span>
        <MethodInlineLink label="закрыто" onOpenRows={onOpenRows} rowIds={method.rowIds.closed} value={formatStatisticValue(method.closed, unit)} />
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${method.closurePercent}%` }} /></div>
    </div>
  )
}

function MethodInlineLink({ label, onOpenRows, rowIds, value }: { label: string; onOpenRows?: StatisticsRowsOpenHandler; rowIds: number[]; value: string }) {
  if (!onOpenRows || rowIds.length === 0) return <span title={label}>{value}</span>
  return <button type="button" className="font-medium text-slate-700 hover:text-sky-700" title={`${label}: открыть в ЛНК`} onClick={() => onOpenRows(rowIds, `Показаны стыки статистики «${label}»: ${rowIds.length}.`)}>{value}</button>
}

function MethodValueCell({ label, onOpenRows, rowIds, tone, unit, value }: { label: string; onOpenRows?: StatisticsRowsOpenHandler; rowIds: number[]; tone: 'amber' | 'sky' | 'green' | 'rose'; unit: StatisticsUnit; value: number }) {
  const toneClass = { amber: 'text-amber-700', sky: 'text-sky-700', green: 'text-emerald-700', rose: 'text-rose-700' }[tone]
  const content = <span className={cn('inline-flex items-center justify-end gap-1.5 font-semibold tabular-nums', toneClass)}>{formatStatisticValue(value, unit)}{rowIds.length > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}</span>
  return <td className="px-3 py-3 text-right">{onOpenRows && rowIds.length > 0 ? <button type="button" title={`Открыть: ${label}`} onClick={() => onOpenRows(rowIds, `Показаны стыки статистики «${label}»: ${rowIds.length}.`)}>{content}</button> : content}</td>
}

function mergeStatisticRowIds(groups: number[][]) {
  return Array.from(new Set(groups.flat())).sort((left, right) => left - right)
}

const WELDER_GROUP_BREAKDOWN_TOOLTIP =
  'Разбивка по группам материалов показывает расчетную долю работы этого фактического клейма в выбранной единице отчета. Если стык варили несколько сварщиков, система распределяет вклад по слоям: для одного комплекта Корень/Заполнение/Облицовка = 40% / 30% / 30%, для двух комплектов = 20% / 15% / 15% на каждый комплект.'

function WeldersStatisticsPanel({
  jointFilter,
  onOpenRows,
  summary,
  unit,
}: {
  jointFilter: WelderStatisticsJointFilter
  onOpenRows?: StatisticsPageProps['onOpenWeldRowIds']
  summary: WelderStatisticsSummary
  unit: StatisticsUnit
}) {
  const controlled = summary.good + summary.rejected
  const [stampSearch, setStampSearch] = useState('')
  const [quickFilter, setQuickFilter] = useState<'all' | 'rejected' | 'waitingRequest' | 'waitingControl'>('all')
  const [sortMode, setSortMode] = useState<'total' | 'average' | 'defect' | 'stamp'>('total')
  const [expandedStamps, setExpandedStamps] = useState<Set<string>>(() => new Set())
  const welderShiftCount = summary.rows.reduce((total, row) => total + row.daily.length, 0)
  const averagePerWelderShift = welderShiftCount > 0 ? summary.total / welderShiftCount : 0
  const allRowIds = mergeStatisticRowIds(summary.rows.map((row) => row.rowIds))
  const controlledRowIds = mergeStatisticRowIds(summary.rows.flatMap((row) => [row.goodRowIds, row.rejectedRowIds]))
  const rejectedRowIds = mergeStatisticRowIds(summary.rows.map((row) => row.rejectedRowIds))
  const filteredRows = useMemo(() => {
    const query = stampSearch.trim().toLowerCase()
    return summary.rows
      .filter(
        (row) =>
          !query ||
          row.searchStamps.some((stamp) => stamp.toLowerCase().includes(query)) ||
          row.welderName.toLowerCase().includes(query),
      )
      .filter((row) => {
        if (quickFilter === 'rejected') return row.rejected > 0
        if (quickFilter === 'waitingRequest') return row.waitingRequest > 0
        if (quickFilter === 'waitingControl') return row.waitingControl > 0
        return true
      })
      .sort((left, right) => {
        if (sortMode === 'stamp') return left.stamp.localeCompare(right.stamp, 'ru', { numeric: true })
        if (sortMode === 'defect') return right.defectPercent - left.defectPercent || right.rejected - left.rejected || right.total - left.total
        if (sortMode === 'average') {
          const leftAverage = left.daily.length > 0 ? left.total / left.daily.length : 0
          const rightAverage = right.daily.length > 0 ? right.total / right.daily.length : 0
          return rightAverage - leftAverage || right.total - left.total
        }
        return right.total - left.total || left.stamp.localeCompare(right.stamp, 'ru', { numeric: true })
      })
  }, [quickFilter, sortMode, stampSearch, summary.rows])
  const toggleExpandedStamp = (stamp: string) => {
    setExpandedStamps((current) => {
      const next = new Set(current)
      if (next.has(stamp)) next.delete(stamp)
      else next.add(stamp)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={Users}
          label="Сварщиков в срезе"
          value={String(summary.totalWelders)}
          detail="Уникальные фактические клейма"
          accent="blue"
        />
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={Activity}
          label="Объем работ"
          value={formatStatisticValue(summary.total, unit)}
          detail={unit === 'joints' ? 'Расчетный вклад в стыках' : 'Расчетный вклад в WDI'}
          accent="blue"
          actionTitle="Открыть стыки сварщиков в журнале"
          onClick={onOpenRows && allRowIds.length > 0 ? () => onOpenRows(allRowIds, `Показаны стыки сварщиков: ${allRowIds.length}.`) : undefined}
        />
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={UserRound}
          label={`Среднее на сварщика в смену, ${unit === 'joints' ? 'стыков' : 'WDI'}`}
          value={formatAverageStatisticValue(averagePerWelderShift)}
          detail={`${welderShiftCount} выходов сварщиков`}
          accent="slate"
        />
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={ClipboardCheck}
          label="Проконтролировано"
          value={formatStatisticValue(controlled, unit)}
          detail={`${formatStatisticValue(summary.good, unit)} годен · ${formatStatisticValue(summary.rejected, unit)} не годен`}
          accent="green"
          actionTitle="Открыть проконтролированные стыки"
          onClick={onOpenRows && controlledRowIds.length > 0 ? () => onOpenRows(controlledRowIds, `Показаны проконтролированные стыки сварщиков: ${controlledRowIds.length}.`) : undefined}
        />
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={Gauge}
          label="% брака"
          value={formatPercent(summary.defectPercent)}
          detail={`${formatStatisticValue(summary.rejected, unit)} не годен из ${formatStatisticValue(controlled, unit)} проконтролированных`}
          accent="amber"
          actionTitle="Открыть негодные стыки"
          onClick={onOpenRows && rejectedRowIds.length > 0 ? () => onOpenRows(rejectedRowIds, `Показаны негодные стыки сварщиков: ${rejectedRowIds.length}.`) : undefined}
        />
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="relative min-w-[260px] flex-1">
            <span className="sr-only">Поиск клейма или ФИО</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={stampSearch} onChange={(event) => setStampSearch(event.target.value)} placeholder="Клеймо НАКС, внутреннее или ФИО" className="h-10 rounded-md border-slate-200 bg-white pl-9 text-sm" />
            {stampSearch.trim() ? <button type="button" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Очистить поиск" onClick={() => setStampSearch('')}><X className="h-4 w-4" /></button> : null}
          </label>
          <WelderToolbarSegments
            label="Показать"
            options={[
              ['all', 'Все'],
              ['rejected', 'Есть брак'],
              ['waitingRequest', 'Без заявки'],
              ['waitingControl', 'Ожидает НК'],
            ]}
            value={quickFilter}
            onChange={(value) => setQuickFilter(value as typeof quickFilter)}
          />
          <WelderToolbarSegments
            label="Сортировка"
            options={[
              ['total', 'Объем'],
              ['average', 'В смену'],
              ['defect', '% брака'],
              ['stamp', 'Клеймо'],
            ]}
            value={sortMode}
            onChange={(value) => setSortMode(value as typeof sortMode)}
          />
        </div>
      </div>

      <WelderRankingPanel onOpenRows={onOpenRows} rows={filteredRows} sortMode={sortMode} unit={unit} />

      <Panel
        title="Отчет по сварщикам"
        subtitle="Считаются только фактические клейма. Если у внутреннего клейма есть связанное клеймо НАКС, в отчете показывается НАКС."
      >
        {summary.rows.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[19%]" /><col className="w-[13.5%]" /><col className="w-[13.5%]" /><col className="w-[14%]" /><col className="w-[13.5%]" /><col className="w-[13.5%]" /><col className="w-[13%]" />
                </colgroup>
                <thead className="sticky top-0 z-20 bg-slate-100 text-slate-700">
                  <tr>
                    <WelderHeaderCell className="sticky left-0 z-30 bg-slate-100">Клеймо</WelderHeaderCell>
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
                    <WelderStatisticsTableRow
                      key={row.stamp}
                      expanded={expandedStamps.has(row.stamp)}
                      jointFilter={jointFilter}
                      onOpenRows={onOpenRows}
                      onToggle={() => toggleExpandedStamp(row.stamp)}
                      row={row}
                      unit={unit}
                    />
                  ))}
                </tbody>
              </table>
              {filteredRows.length === 0 ? (
                <div className="border-t border-slate-100 bg-slate-50 p-5 text-sm text-slate-500">
                  По текущему поиску и фильтрам ничего не найдено.
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

function WelderToolbarSegments({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: Array<[string, string]>; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-slate-500">{label}</div>
      <div className="inline-flex flex-wrap rounded-md border border-slate-200 bg-slate-50 p-0.5">
        {options.map(([optionValue, optionLabel]) => (
          <button key={optionValue} type="button" className={cn('rounded px-2.5 py-1.5 text-xs font-medium transition-colors', value === optionValue ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')} onClick={() => onChange(optionValue)}>{optionLabel}</button>
        ))}
      </div>
    </div>
  )
}

function WelderRankingPanel({ onOpenRows, rows, sortMode, unit }: { onOpenRows?: StatisticsPageProps['onOpenWeldRowIds']; rows: WelderStatisticsRow[]; sortMode: 'total' | 'average' | 'defect' | 'stamp'; unit: StatisticsUnit }) {
  const visibleRows = rows.slice(0, 12)
  const rankingMode = sortMode === 'average' || sortMode === 'defect' ? sortMode : 'total'
  const maxValue = Math.max(1, ...visibleRows.map((row) => getWelderRankingValue(row, rankingMode)))
  const metricLabel = rankingMode === 'defect' ? '% брака' : rankingMode === 'average' ? `${unit === 'joints' ? 'стыков' : 'WDI'} в смену` : unit === 'joints' ? 'стыков' : 'WDI'
  return (
    <Panel
      title="Сравнение сварщиков"
      subtitle={`Первые ${visibleRows.length} по текущей сортировке. Процент брака всегда показан вместе с количеством проконтролированных работ.`}
      headerAction={<span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">{metricLabel}</span>}
    >
      {visibleRows.length > 0 ? (
        <div className="space-y-2">
          {visibleRows.map((row, index) => {
            const value = getWelderRankingValue(row, rankingMode)
            const controlled = row.good + row.rejected
            const rowIds = rankingMode === 'defect' ? row.rejectedRowIds : row.rowIds
            const content = (
              <>
                <span className="w-6 shrink-0 text-center text-xs font-medium tabular-nums text-slate-400">{index + 1}</span>
                <span className="w-28 shrink-0 truncate text-sm font-semibold text-slate-800" title={`${row.stamp}${row.welderName ? ` · ${row.welderName}` : ''}`}>{row.stamp}</span>
                <span className="relative h-7 min-w-0 flex-1 overflow-hidden rounded bg-slate-100">
                  <span className={cn('absolute inset-y-0 left-0 rounded', rankingMode === 'defect' ? 'bg-rose-200' : rankingMode === 'average' ? 'bg-indigo-200' : 'bg-sky-200')} style={{ width: `${value > 0 ? Math.max(2, (value / maxValue) * 100) : 0}%` }} />
                  <span className="relative flex h-full items-center justify-end px-2 text-xs font-semibold tabular-nums text-slate-800">{rankingMode === 'defect' ? formatPercent(value) : formatAverageStatisticValue(value)}</span>
                </span>
                <span className="hidden w-32 shrink-0 text-right text-xs text-slate-500 sm:block">{rankingMode === 'defect' ? `из ${formatStatisticValue(controlled, unit)}` : `${formatPercent(row.defectPercent)} брака`}</span>
                {rowIds.length > 0 ? <ArrowUpRight className="h-4 w-4 shrink-0 text-sky-600" /> : null}
              </>
            )
            return onOpenRows && rowIds.length > 0 ? (
              <button key={row.stamp} type="button" className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-sky-100 hover:bg-sky-50/55" title={`Открыть стыки сварщика ${row.stamp}`} onClick={() => onOpenRows(rowIds, `Показаны стыки сварщика ${row.stamp}: ${rowIds.length}.`)}>{content}</button>
            ) : <div key={row.stamp} className="flex items-center gap-2 px-2 py-1.5">{content}</div>
          })}
        </div>
      ) : <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">Нет сварщиков по текущему поиску и фильтрам.</div>}
    </Panel>
  )
}

function getWelderRankingValue(row: WelderStatisticsRow, mode: 'total' | 'average' | 'defect') {
  if (mode === 'defect') return row.defectPercent
  if (mode === 'average') return row.daily.length > 0 ? row.total / row.daily.length : 0
  return row.total
}

function WelderStatisticsTableRow({
  expanded,
  jointFilter,
  onOpenRows,
  onToggle,
  row,
  unit,
}: {
  expanded: boolean
  jointFilter: WelderStatisticsJointFilter
  onOpenRows?: StatisticsPageProps['onOpenWeldRowIds']
  onToggle: () => void
  row: WelderStatisticsRow
  unit: StatisticsUnit
}) {
  const controlled = row.good + row.rejected
  const expandedCellClass = expanded ? 'border-t-2 border-sky-200 bg-sky-50/60' : ''
  return (
    <>
      <tr
        className={cn(
          'cursor-pointer border-t border-slate-100 transition-colors odd:bg-white even:bg-slate-50/60 hover:bg-sky-50',
          expanded ? 'bg-sky-50/70 hover:bg-sky-50/70' : '',
        )}
        onClick={onToggle}
      >
        <td className={cn('sticky left-0 z-10 px-4 py-3', expanded ? 'border-l-2 bg-sky-50' : 'bg-inherit', expandedCellClass)}>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900">{row.stamp}</div>
              {row.welderName ? <div className="mt-1 text-xs font-medium leading-4 text-slate-500">{row.welderName}</div> : null}
            </div>
            {onOpenRows && row.rowIds.length > 0 ? (
              <button type="button" className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded text-sky-600 hover:bg-sky-100" title={`Открыть стыки сварщика ${row.stamp}`} onClick={(event) => { event.stopPropagation(); onOpenRows(row.rowIds, `Показаны стыки сварщика ${row.stamp}: ${row.rowIds.length}.`) }}><ArrowUpRight className="h-4 w-4" /></button>
            ) : null}
          </div>
        </td>
        <>
            <WelderBodyCell className={expandedCellClass}>
              <WelderValueWithSplit
                f={row.fTotal}
                jointFilter={jointFilter}
                s={row.sTotal}
                total={row.total}
                unit={unit}
              />
            </WelderBodyCell>
            <WelderBodyCell className={cn(expandedCellClass, 'text-emerald-700')}>
              <WelderValueWithSplit
                f={row.fGood}
                jointFilter={jointFilter}
                s={row.sGood}
                total={row.good}
                unit={unit}
              />
            </WelderBodyCell>
            <WelderBodyCell className={expandedCellClass}>
              <WelderValueWithSplit
                f={row.fWaitingRequest}
                jointFilter={jointFilter}
                s={row.sWaitingRequest}
                total={row.waitingRequest}
                unit={unit}
              />
            </WelderBodyCell>
            <WelderBodyCell className={expandedCellClass}>
              <WelderValueWithSplit
                f={row.fWaitingControl}
                jointFilter={jointFilter}
                s={row.sWaitingControl}
                total={row.waitingControl}
                unit={unit}
              />
            </WelderBodyCell>
            <WelderBodyCell className={cn(expandedCellClass, 'text-rose-700')}>
              <WelderValueWithSplit
                f={row.fRejected}
                jointFilter={jointFilter}
                s={row.sRejected}
                total={row.rejected}
                unit={unit}
              />
            </WelderBodyCell>
            <WelderBodyCell className={cn(expandedCellClass, expanded ? 'border-r-2' : '')}>
              <div className="flex items-center justify-end gap-2">
                <span>{formatPercent(row.defectPercent)}</span>
                <span className="text-xs font-normal text-slate-400">из {formatStatisticValue(controlled, unit)}</span>
              </div>
            </WelderBodyCell>
          </>
      </tr>
      {expanded ? (
        <tr className="bg-sky-50/60">
          <td colSpan={7} className="border-x-2 border-b-2 border-sky-200 p-2.5">
            <WelderStatisticsDetails jointFilter={jointFilter} onOpenRows={onOpenRows} row={row} unit={unit} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function WelderStatisticsDetails({ jointFilter, onOpenRows, row, unit }: { jointFilter: WelderStatisticsJointFilter; onOpenRows?: StatisticsPageProps['onOpenWeldRowIds']; row: WelderStatisticsRow; unit: StatisticsUnit }) {
  const unitLabel = unit === 'joints' ? 'стыков' : 'WDI'
  const unitDescription = unit === 'joints' ? 'в стыках' : 'в дюймах (WDI)'
  const maxDaily = Math.max(1, ...row.daily.map((bucket) => bucket.total))
  const activeDays = row.daily.length
  const averagePerActiveDay = activeDays > 0 ? row.total / activeDays : 0
  const controlled = row.good + row.rejected

  return (
    <div className="rounded-md border border-sky-200 bg-white shadow-sm">
      <div className="grid gap-3 border-b border-slate-100 p-3 xl:grid-cols-[0.72fr_1.28fr]">
        <section>
          <div className="mb-2 text-xs font-semibold uppercase text-slate-400">Выработка</div>
          <div className="grid grid-cols-2 gap-2">
            <WelderSummaryCard label={`В смену, ${unitLabel}`} value={formatStatisticValue(averagePerActiveDay, unit)} detail={activeDays > 0 ? `${activeDays} дн. работы` : 'нет дней работы'} />
            <WelderSummaryCard label="Всего" value={formatStatisticValue(row.total, unit)} f={row.fTotal} groupMetric="total" groups={row.materialGroups} s={row.sTotal} jointFilter={jointFilter} unit={unit} />
          </div>
        </section>
        <section>
          <div className="mb-2 text-xs font-semibold uppercase text-slate-400">Качество и очередь</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <WelderSummaryCard accent="green" label="Годен" value={formatStatisticValue(row.good, unit)} f={row.fGood} groupMetric="good" groups={row.materialGroups} s={row.sGood} jointFilter={jointFilter} unit={unit} />
            <WelderSummaryCard accent="blue" label="Без заявки" value={formatStatisticValue(row.waitingRequest, unit)} f={row.fWaitingRequest} groupMetric="waitingRequest" groups={row.materialGroups} s={row.sWaitingRequest} jointFilter={jointFilter} unit={unit} />
            <WelderSummaryCard accent="indigo" label="Ожидает НК" value={formatStatisticValue(row.waitingControl, unit)} f={row.fWaitingControl} groupMetric="waitingControl" groups={row.materialGroups} s={row.sWaitingControl} jointFilter={jointFilter} unit={unit} />
            <WelderSummaryCard accent="rose" label="Не годен" value={formatStatisticValue(row.rejected, unit)} f={row.fRejected} groupMetric="rejected" groups={row.materialGroups} s={row.sRejected} jointFilter={jointFilter} unit={unit} />
            <WelderSummaryCard align="center" label="% брака" value={formatPercent(row.defectPercent)} detail={`из ${formatStatisticValue(controlled, unit)}`} style={getDefectCardStyle(row.defectPercent)} />
          </div>
        </section>
      </div>
      <div className="bg-sky-50/25 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div><div className="text-sm font-semibold text-slate-900">Динамика по дням</div><div className="text-xs text-slate-500">Фактическое клеймо {row.stamp}, {unitDescription}. Нажмите на день, чтобы открыть стыки.</div></div>
          <span className="rounded-md border border-sky-100 bg-white px-2 py-1 text-xs font-medium text-sky-800">{formatStatisticValue(row.total, unit)} {unitLabel}</span>
        </div>
        {row.daily.length > 0 ? (
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-end gap-2 rounded-md border border-slate-100 bg-white/80 px-3 py-3">
              {row.daily.map((bucket) => {
                const height = Math.max(12, (bucket.total / maxDaily) * 92)
                const title = `${formatDisplayDate(bucket.date)}: ${formatStatisticValue(bucket.total, unit)} ${unitLabel}; стыков ${bucket.joints}`
                const content = <><div className="flex h-24 w-8 items-end rounded-md border border-sky-100 bg-white px-1"><div className="w-full rounded-t bg-sky-300 shadow-sm" style={{ height }} /></div><div className="text-[11px] font-semibold leading-3 text-slate-700">{formatDisplayDate(bucket.date).slice(0, 5)}</div><div className="text-[11px] leading-3 text-sky-700">{formatStatisticValue(bucket.total, unit)}</div></>
                return onOpenRows && bucket.rowIds.length > 0 ? (
                  <button type="button" key={bucket.date} className="grid w-12 justify-items-center gap-1 rounded py-1 hover:bg-sky-50" title={`${title}. Открыть стыки`} onClick={() => onOpenRows(bucket.rowIds, `Показаны стыки сварщика ${row.stamp} за ${formatDisplayDate(bucket.date)}: ${bucket.rowIds.length}.`)}>{content}</button>
                ) : <div key={bucket.date} className="grid w-12 justify-items-center gap-1" title={title}>{content}</div>
              })}
            </div>
          </div>
        ) : <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">По дням нет данных для выбранного периода.</div>}
      </div>
    </div>
  )
}

function WelderSummaryCard({
  accent = 'slate',
  align = 'left',
  detail,
  f,
  groupMetric,
  groups,
  jointFilter,
  label,
  s,
  style,
  unit,
  value,
}: {
  accent?: 'slate' | 'green' | 'blue' | 'indigo' | 'rose'
  align?: 'left' | 'center'
  detail?: string
  f?: number
  groupMetric?: keyof Pick<WelderStatisticsRow['materialGroups'][number], 'total' | 'good' | 'waitingRequest' | 'waitingControl' | 'rejected'>
  groups?: WelderStatisticsRow['materialGroups']
  jointFilter?: WelderStatisticsJointFilter
  label: string
  s?: number
  style?: CSSProperties
  unit?: StatisticsUnit
  value: string
}) {
  const accentClass = {
    slate: 'border-slate-200 bg-slate-50/85 text-slate-900',
    green: 'border-emerald-100 bg-emerald-50/55 text-emerald-900',
    blue: 'border-sky-100 bg-sky-50/60 text-sky-900',
    indigo: 'border-indigo-100 bg-indigo-50/55 text-indigo-900',
    rose: 'border-rose-100 bg-rose-50/55 text-rose-900',
  }[accent]
  const groupDetails =
    groups && groupMetric
      ? groups
          .map((group) => ({ key: group.key, value: group[groupMetric] }))
          .filter((group) => group.value > 0)
          .sort((left, right) => right.value - left.value || left.key.localeCompare(right.key, 'ru', { numeric: true }))
      : []
  const visibleGroups = groupDetails.slice(0, 2)
  const hiddenGroups = Math.max(0, groupDetails.length - visibleGroups.length)
  const groupUnitLabel = unit === 'joints' ? 'ст.' : 'WDI'

  return (
    <div
      className={cn(
        'min-h-[72px] rounded-md border px-2.5 py-2 shadow-sm',
        align === 'center' ? 'flex flex-col items-center justify-center text-center' : '',
        accentClass,
      )}
      style={style}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-base font-semibold leading-none">{value}</div>
      {detail ? <div className="mt-1 text-[11px] font-medium leading-4 text-slate-500">{detail}</div> : null}
      {jointFilter === 'all' && typeof f === 'number' && typeof s === 'number' && unit ? (
        <div className="mt-2 grid grid-cols-2 gap-1">
          <span className="flex items-center justify-between gap-1 rounded border border-slate-200/80 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
            <span className="text-slate-500">F</span>
            <span className="tabular-nums text-slate-800">{formatStatisticValue(f, unit)}</span>
          </span>
          <span className="flex items-center justify-between gap-1 rounded border border-slate-200/80 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
            <span className="text-slate-500">S</span>
            <span className="tabular-nums text-slate-800">{formatStatisticValue(s, unit)}</span>
          </span>
        </div>
      ) : null}
      {visibleGroups.length > 0 ? (
        <div className="mt-2 grid gap-1" title={WELDER_GROUP_BREAKDOWN_TOOLTIP}>
          {visibleGroups.map((group) => (
            <div
              key={group.key}
              className="flex min-w-0 items-center justify-between gap-2 rounded border border-slate-200/80 bg-white px-1.5 py-0.5 text-[10.5px] leading-4 text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.03)]"
            >
              <span className="min-w-0 truncate font-semibold text-slate-800">{group.key}</span>
              <span className="shrink-0 tabular-nums text-slate-700">
                {formatStatisticValue(group.value, unit ?? 'joints')} {groupUnitLabel}
              </span>
            </div>
          ))}
          {hiddenGroups > 0 ? (
            <div className="rounded border border-slate-200/80 bg-white px-1.5 py-0.5 text-[10.5px] font-medium leading-4 text-slate-500">
              еще {hiddenGroups}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function getDefectCardStyle(defectPercent: number): CSSProperties {
  const clamped = Math.max(0, Math.min(25, defectPercent))
  const ratio = clamped <= 4 ? 0 : (clamped - 4) / 21
  const hue = ratio < 0.5 ? 145 - ratio * 2 * 95 : 50 - (ratio - 0.5) * 2 * 50
  return {
    backgroundColor: `hsl(${hue} 82% 96%)`,
    borderColor: `hsl(${hue} 72% 84%)`,
  }
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

function WelderHeaderCell({ children, align = 'left', className }: { children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  return <th className={cn('px-4 py-3 font-semibold', align === 'right' ? 'text-right' : 'text-left', className)}>{children}</th>
}

function WelderBodyCell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 text-right font-medium text-slate-700', className)}>{children}</td>
}

function PercentageLinesPanel({
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  summary,
  onOpenPercentageLineStampRows,
  onOpenWeldRowIds,
  search,
  onSearchChange,
}: {
  onAssignPercentageLineMissingControls?: (rowIds: number[], method: PercentageControlMethod) => Promise<void> | void
  onCancelPercentageLineMissingControls?: (rowIds: number[]) => Promise<void> | void
  summary: PercentageLineSummary[]
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
  onOpenWeldRowIds?: (rowIds: number[], message?: string) => void
  search: string
  onSearchChange: (value: string) => void
}) {
  const [collapsedLineKeys, setCollapsedLineKeys] = useState<Set<string>>(() => new Set())
  const [detailDialog, setDetailDialog] = useState<PercentageLineJointDetailDialogState | null>(null)
  const [assignMissingDialog, setAssignMissingDialog] = useState<PercentageLineAssignMissingDialogState | null>(null)
  const requestedRowIds = useMemo(
    () =>
      detailDialog?.rowIds ??
      (assignMissingDialog
        ? Array.from(new Set([...assignMissingDialog.rowIds, ...assignMissingDialog.cancellationRowIds]))
        : []),
    [assignMissingDialog, detailDialog],
  )
  const detailRowsQuery = useWeldRowsByIdsQuery(requestedRowIds)
  const rowsById = useMemo(
    () => new Map((detailRowsQuery.data ?? []).map((row) => [row.id, row])),
    [detailRowsQuery.data],
  )
  const detailRows = useMemo(
    () => (detailDialog ? detailDialog.rowIds.map((rowId) => rowsById.get(rowId)).filter((row): row is WeldRow => Boolean(row)) : []),
    [detailDialog, rowsById],
  )
  const filteredSummary = useMemo(() => filterPercentageLineSummaries(summary, search), [search, summary])
  const allVisibleLinesCollapsed =
    filteredSummary.length > 0 && filteredSummary.every((line) => collapsedLineKeys.has(line.lineKey))
  const totals = useMemo(() => getPercentageLineReportTotals(filteredSummary), [filteredSummary])
  const closedControls = Math.max(0, totals.required - totals.missing)
  const completionPercent = getPercentageControlCompletionPercent(totals.required, totals.missing)
  const toggleLine = (lineKey: string) => {
    setCollapsedLineKeys((current) => {
      const next = new Set(current)
      if (next.has(lineKey)) next.delete(lineKey)
      else next.add(lineKey)
      return next
    })
  }
  const toggleVisibleLines = () => {
    setCollapsedLineKeys((current) => {
      const next = new Set(current)
      if (allVisibleLinesCollapsed) {
        for (const line of filteredSummary) next.delete(line.lineKey)
      } else {
        for (const line of filteredSummary) next.add(line.lineKey)
      }
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
      <div className="rounded-md border border-slate-200 bg-white px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">Сводка процентных линий</div>
            <div className="mt-0.5 text-xs text-slate-500">
              Итог по выбранному срезу{search.trim() ? ' и текущему поиску' : ''}
            </div>
          </div>
          {search.trim() ? (
            <span className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
              Показано {filteredSummary.length} из {summary.length} линий
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-stretch gap-2 border-t border-slate-100 pt-3">
          <label className="relative min-w-[240px] flex-[1.35_1_240px]">
            <span className="sr-only">Поиск по линии или клейму</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Линия, проект, шифр или клеймо"
              className={cn(
                'h-12 rounded-md border-slate-200 bg-white pl-10 text-sm shadow-sm',
                search.trim() && 'pr-10',
              )}
            />
            {search.trim() ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                onClick={() => onSearchChange('')}
                title="Очистить поиск"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>

          <PercentageLineSummaryBadge
            label="Линий"
            value={filteredSummary.length}
            title="Линий = количество процентных линий в выбранном срезе и текущем поиске. Учитываются линии с единым процентом контроля меньше 100%."
          />
          <PercentageLineSummaryBadge
            label="Стыков"
            value={totals.joints}
            title="Стыков = сумма сваренных официальных стыков на показанных процентных линиях. Неактуальные по ИЗМу строки, неофициальные стыки и строки без даты сварки не учитываются."
          />
          <PercentageLineSummaryBadge
            label="Клейм"
            value={totals.stamps}
            title="Клейм = сумма расчетных групп официальных клейм на показанных линиях. Одно и то же клеймо на разных линиях учитывается отдельно."
          />

          <div
            className="flex h-12 min-w-[280px] flex-[2_1_280px] flex-col justify-center rounded-md border border-slate-200 bg-white px-3.5 shadow-sm"
            title="Закрыто = требуется − осталось. Процент выполнения = закрыто ÷ требуется × 100%. Закрытием считается допустимое назначение, выполненный результат или осознанная отмена РК+УЗК; на У-стыке допустим ПВК. Назначения сверх расчета показаны отдельно."
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="text-sm text-slate-600">
                <span className="font-semibold text-emerald-700">Закрыто {closedControls}</span>
                <span className="mx-1.5 text-slate-300">/</span>
                требуется <span className="font-semibold text-slate-900">{totals.required}</span>
              </div>
              <span className="text-sm font-semibold text-slate-700">{completionPercent}%</span>
            </div>
            <PercentageLineProgressBar percent={completionPercent} compact />
          </div>

          <PercentageLineSummaryBadge
            label="Осталось"
            value={totals.missing}
            tone={totals.missing > 0 ? 'amber' : 'slate'}
            title="Осталось = требуется − закрыто расчетом. На обычном стыке закрывают РК/УЗК, на У-стыке также ПВК; учитываются результат и осознанная отмена РК+УЗК."
          />
          <PercentageLineSummaryBadge
            label="Лишнее"
            value={totals.excess}
            tone={totals.excess > 0 ? 'rose' : 'slate'}
            title="Лишнее = фактически назначено «да» − допустимое количество «да» по фактическим клеймам. Расчет выполняется отдельно по каждому официальному клейму; статус «дополнительный» сюда не входит."
          />
          <PercentageLineSummaryBadge
            label="Потенциальное сокращение"
            value={totals.potentialReduction}
            tone="sky"
            className="min-w-[170px] flex-[1.45_1_170px]"
            title="Потенциальное сокращение = фактически требуется − теоретически требуется при минимальном количестве клейм. На каждой линии остается одно базовое клеймо плюс дополнительные клейма с принятым ДЗ-01; добор после брака и 100% контроль сохраняются. Назначенные «да» на этот показатель не влияют."
          />
          {totals.fullControl > 0 ? (
            <PercentageLineSummaryBadge
              label="100% по клейму"
              value={totals.fullControl}
              tone="amber"
              title="100% по клейму = количество клейм с четырьмя и более первичными негодными процентными контролями. На У-стыках сюда входит и ПВК. Для каждого такого клейма требуется контроль всех доступных стыков."
            />
          ) : null}
        </div>
      </div>

      <Panel
        title="Процентные линии"
        subtitle="Расчет идет по официальным клеймам на линиях с единым процентом меньше 100. Обычный стык закрывают РК/УЗК, стык типа «У…» — РК/УЗК/ПВК."
        headerAction={
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0 rounded-md border-sky-100 bg-sky-50/70 text-sky-800 hover:border-sky-200 hover:bg-sky-100"
            onClick={toggleVisibleLines}
            disabled={filteredSummary.length === 0}
            title={allVisibleLinesCollapsed ? 'Развернуть все видимые процентные линии' : 'Свернуть все видимые процентные линии'}
          >
            {allVisibleLinesCollapsed ? (
              <ChevronDown className="mr-1.5 h-4 w-4" />
            ) : (
              <ChevronRight className="mr-1.5 h-4 w-4" />
            )}
            {allVisibleLinesCollapsed ? 'Развернуть все' : 'Свернуть все'}
          </Button>
        }
      >
        {summary.length > 0 ? (
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
          loading={detailRowsQuery.isLoading}
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
          loading={detailRowsQuery.isLoading}
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
  loading,
  onClose,
  onOpenRows,
  rows,
}: {
  detail: PercentageLineJointDetailDialogState
  loading: boolean
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
        subtitle={`${detail.subtitle} · стыков: ${detail.rowIds.length}`}
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
        {loading ? (
          <div className="rounded-md border border-sky-100 bg-sky-50 p-6 text-sm text-sky-800">
            Загружаем выбранные стыки...
          </div>
        ) : rows.length > 0 ? (
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
  loading,
  onClose,
  onCancelSave,
  onOpenRows,
  onSave,
}: {
  assignmentRows: WeldRow[]
  cancellationRows: WeldRow[]
  detail: PercentageLineAssignMissingDialogState
  loading: boolean
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
  const activeRows = action === 'отмена'
    ? cancellationRows
    : assignmentRows.filter((row) => isPercentageControlMethodAvailableForRow(action, row))
  const selectedRows = activeRows.filter((row) => selectedIds.has(row.id))
  const isSelectionFull = selectedIds.size >= selectableCount
  const actionTitle = action === 'отмена' ? 'закрытия недобора отменой РК/УЗК' : `назначения ${action} по процентной линии`
  const actionHintClassName =
    action === 'отмена'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : action === 'РК'
        ? 'border-sky-100 bg-sky-50 text-sky-900'
        : action === 'УЗК'
          ? 'border-indigo-100 bg-indigo-50 text-indigo-900'
          : 'border-cyan-100 bg-cyan-50 text-cyan-900'
  const actionHint =
    action === 'отмена' ? (
      <>
        Выберите стыки, по которым расчетный РК/УЗК сознательно не выполняется. Система проставит{' '}
        <span className="font-semibold">РК = отменен</span> и <span className="font-semibold">УЗК = отменен</span>, и эти
        стыки закроют недобор процентной линии.
      </>
    ) : (
      <>
        Выберите актуальные официальные стыки без закрытия расчетом и без негодного результата. Система проставит{' '}
        <span className="font-semibold">{action}</span> как назначенный контроль по процентной линии.
        {action === 'ПВК' ? ' ПВК доступен в этом действии только для стыков типа «У…».' : ''}
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
      setSaveError((error as Error).message || 'Не удалось сохранить назначение контроля')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[760px]" maxHeightClassName="max-h-[86vh]" overlayClassName="z-[85] bg-slate-950/25">
      <DialogHeader
        title="Назначить контроль"
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
          {(['РК', 'УЗК', 'ПВК', 'отмена'] as PercentageLineMissingControlAction[]).map((option) => (
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
              disabled={
                isSaving ||
                (option === 'ПВК' && !assignmentRows.some((row) => isPercentageControlMethodAvailableForRow('ПВК', row)))
              }
              title={option === 'ПВК' ? 'ПВК можно назначить только на стык типа «У…»' : undefined}
            >
              {option === 'отмена' ? 'Отмена' : option}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500">
          Выберите стыки вручную. Можно выбрать не больше {detail.missingControls}.
          {action === 'ПВК' ? ` Показаны только У-стыки: ${activeRows.length}.` : ''}
        </div>
        {saveError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</div>
        ) : null}
        {loading ? (
          <div className="rounded-md border border-sky-100 bg-sky-50 p-5 text-sm text-sky-800">
            Загружаем доступные стыки...
          </div>
        ) : activeRows.length > 0 ? (
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
        Спул: {String(row.spool ?? '').trim() || '-'} · Тип: {String(row.connectionType ?? '').trim() || '-'} · Диаметр:{' '}
        {formatJointDiameterLabel(row)} · Дата сварки:{' '}
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
        Спул: {String(row.spool ?? '').trim() || '-'} · Тип: {String(row.connectionType ?? '').trim() || '-'} · Диаметр:{' '}
        {formatJointDiameterLabel(row)} · Дата сварки:{' '}
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
  line: PercentageLineSummary
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
    `Если первичный стык не годен по процентному контролю, включая дубль: ${line.percent === 1 ? '+1 стык к контролю' : '+2 стыка к контролю'}. На У-стыке учитывается и ПВК. ` +
    'После 4-го первичного негодного результата требуется 100% контроль по этому клейму.'
  const allAcceptedAndClosed =
    totals.missing === 0 &&
    line.stamps.length > 0 &&
    line.stamps.every((stamp) => stamp.rejectedJoints === 0 && stamp.waitingRequestJoints === 0 && stamp.waitingControlJoints === 0)
  const closedControls = Math.max(0, totals.required - totals.missing)
  const completionPercent = getPercentageControlCompletionPercent(totals.required, totals.missing)

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
              {line.percent}% контроля
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {line.projectTitle} · {line.subtitleCode}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            расчет отдельно по каждому официальному клейму
          </div>
        </div>
        <div className="min-w-0 overflow-x-auto pb-0.5 lg:ml-auto lg:flex-[0_1_780px]">
          <div className="grid min-w-[740px] grid-cols-[0.85fr_0.75fr_1.9fr_0.75fr_0.75fr] gap-2">
            <PercentageLineMetricPill
              label="Стыков"
              value={line.rowCount}
              title="Количество сваренных официальных стыков на этой процентной линии. Неофициальные, неактуальные по ИЗМу и строки без даты сварки не учитываются."
            />
            <PercentageLineMetricPill
              label="Клейм"
              value={line.stamps.length}
              title="Количество официальных клейм, участвующих в расчете этой процентной линии."
            />
            <PercentageLineProgressPill
              closed={closedControls}
              percent={completionPercent}
              required={totals.required}
            />
            <PercentageLineMetricPill
              label="Осталось"
              value={totals.missing}
              tone={totals.missing > 0 ? 'amber' : 'slate'}
              title="Сколько расчетных стыков еще нужно закрыть допустимым контролем."
            />
            <PercentageLineMetricPill
              label="Лишнее"
              value={totals.excess}
              tone={totals.excess > 0 ? 'rose' : 'slate'}
              title="Обычные назначения «да» сверх расчетной потребности. «Дополнительный» сюда не попадает."
            />
          </div>
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
              title="Сколько стыков нужно закрыть по этому клейму: расчет по проценту + добор после первичных негодных расчетных контролей. На У-стыках учитывается ПВК. После 4-го такого результата требуется 100% контроль."
            >
              Расчет
            </PercentageLineGridHeader>
            <PercentageLineGridHeader
              align="right"
              title="Всего назначено = все стыки с допустимым для них расчетным контролем «да» или «дополнительный», а также стыки с осознанной отменой РК+УЗК. Для У-стыка допустим ПВК. Обычное «да» участвует в проверке лишнего контроля. «Дополнительный» не закрывает обязательный расчет и добор."
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

function PercentageLineProgressPill({
  closed,
  percent,
  required,
}: {
  closed: number
  percent: number
  required: number
}) {
  return (
    <div
      className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm"
      title="Закрыто по расчету: допустимое «да», выполненный результат, осознанная отмена РК+УЗК или уже известный негодный результат. На У-стыке допустим ПВК. Лишние назначения показываются отдельно."
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 whitespace-nowrap text-xs text-slate-500">
          <span className="font-semibold text-emerald-700">Закрыто {closed}</span>
          <span className="mx-1 text-slate-300">/</span>
          требуется <span className="font-semibold text-slate-800">{required}</span>
        </div>
        <span className="shrink-0 text-xs font-semibold text-slate-700">{percent}%</span>
      </div>
      <PercentageLineProgressBar percent={percent} compact />
    </div>
  )
}

function PercentageLineMetricPill({
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
        'min-w-0 rounded-md border bg-white px-3 py-2 shadow-sm',
        tone === 'amber'
          ? 'border-amber-200 bg-amber-50/50 text-amber-800'
          : tone === 'rose'
            ? 'border-rose-200 bg-rose-50/50 text-rose-800'
            : 'border-slate-200 text-slate-700',
      )}
      title={title}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold leading-none text-slate-900">{value}</div>
    </div>
  )
}

function PercentageLineSummaryBadge({
  className,
  label,
  title,
  tone = 'slate',
  value,
}: {
  className?: string
  label: string
  title: string
  tone?: 'slate' | 'amber' | 'rose' | 'sky'
  value: number
}) {
  return (
    <span
      className={cn(
        'inline-flex h-12 min-w-[96px] flex-[1_1_96px] items-center justify-between gap-2.5 rounded-md border px-3.5 text-sm font-medium shadow-sm',
        tone === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : tone === 'rose'
            ? 'border-rose-200 bg-rose-50 text-rose-800'
            : tone === 'sky'
              ? 'border-sky-200 bg-sky-50 text-sky-800'
              : 'border-slate-200 bg-slate-50 text-slate-600',
        className,
      )}
      title={title}
    >
      {label}
      <strong className="text-base font-semibold text-slate-900">{value}</strong>
    </span>
  )
}

function PercentageLineProgressBar({ percent, compact = false }: { percent: number; compact?: boolean }) {
  return (
    <div className={cn('overflow-hidden rounded-full bg-slate-100', compact ? 'mt-2 h-1.5' : 'mt-2 h-2')}>
      <div
        className={cn('h-full rounded-full transition-[width]', percent >= 100 ? 'bg-emerald-500' : 'bg-sky-500')}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

function getPercentageControlCompletionPercent(required: number, missing: number) {
  if (required <= 0) return 0
  const closed = Math.max(0, required - missing)
  return Math.min(100, Math.round((closed / required) * 100))
}

function PercentageLineTableRow({
  line,
  onAssignMissing,
  onOpenDetail,
  onOpenStamp,
  stamp,
}: {
  line: PercentageLineSummary
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
              100% контроль
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
              <span className="block text-[10px] leading-4 text-rose-600">в т.ч. расчетных: {stamp.rejectedPrimaryControls}</span>
            ) : null}
          </span>
        </div>
      </PercentageLineGridCell>
      <PercentageLineGridCell label="Расчет">
        <PercentageLineCellStack
          main={`требуется ${stamp.requiredControls}`}
          title="Расчетная потребность контроля"
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
                  detail: createDetail('Дополнительный расчетный контроль', stamp.additionalAssignedRowIds),
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
            ...createDetail('Назначить расчетный контроль', stamp.assignmentCandidateRowIds),
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
          title="Назначить расчетный контроль или закрыть недобор отменой"
        >
          Назначить контроль
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
    } else if (
      (code === 'РК' || code === 'УЗК' || (code === 'ПВК' && isPercentageControlMethodAvailableForRow('ПВК', row))) &&
      isEnabledControlValue(availability)
    ) {
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
    `В том числе по расчетному контролю: ${stamp.rejectedPrimaryControls}. На У-стыках сюда входит ПВК. Эти стыки влияют на добор контроля процентной линии`,
  ].join('. ')
}

function getAssignedControlsHint(stamp: PercentageLineStampSummary) {
  return [
    `${getJointListHint('Всего назначено', stamp.assignedJointNames)}. Это общее число допустимых назначений: РК/УЗК, для У-стыков также ПВК, и осознанные отмены РК+УЗК`,
    stamp.additionalAssignedControls > 0 ? getJointListHint('В т.ч. дополнительно', stamp.additionalAssignedJointNames) : '',
    stamp.cancelledAssignedControls > 0 ? getJointListHint('В т.ч. отменено РК и УЗК', stamp.cancelledAssignedJointNames) : '',
    stamp.cancelledAssignedControls > 0
      ? 'Отмена РК+УЗК закрывает одно расчетное место и не считается лишним контролем'
      : '',
    stamp.additionalAssignedControls > 0 ? 'Статус «дополнительный» не закрывает обязательный расчет и добор' : '',
  ].filter(Boolean).join('. ')
}

function getJointListHint(title: string, joints: string[]) {
  return joints.length > 0 ? `${title}: ${joints.join(', ')}` : `${title}: нет стыков`
}

function LineSummaryPanel({
  onOpenRows,
  summary,
  unit,
}: {
  onOpenRows?: StatisticsPageProps['onOpenWeldRowIds']
  summary: LineSummary
  unit: StatisticsUnit
}) {
  const [lineSearch, setLineSearch] = useState('')
  const [showLineDetails, setShowLineDetails] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'remaining' | 'completed'>('all')
  const [sortMode, setSortMode] = useState<'remaining' | 'progress' | 'line'>('remaining')
  const unitColumnLabel = unit === 'wdi' ? 'WDI' : 'стыков'
  const completedLines = summary.rows.filter((row) => row.remaining <= 0)
  const remainingLines = summary.rows.filter((row) => row.remaining > 0)
  const completedLineRowIds = mergeStatisticRowIds(completedLines.map((row) => row.rowIds))
  const remainingRowIds = mergeStatisticRowIds(remainingLines.map((row) => row.remainingRowIds))
  const completedRowIds = mergeStatisticRowIds(summary.rows.map((row) => row.completedRowIds))
  const filteredRows = useMemo(() => {
    const query = lineSearch.trim().toLowerCase()
    return summary.rows
      .filter((row) => !query || [row.line, row.projectTitle, row.subtitleCode].some((value) => value.toLowerCase().includes(query)))
      .filter((row) => statusFilter === 'all' || (statusFilter === 'remaining' ? row.remaining > 0 : row.remaining <= 0))
      .sort((left, right) => {
        if (sortMode === 'line') return left.line.localeCompare(right.line, 'ru', { numeric: true })
        if (sortMode === 'progress') {
          const leftProgress = left.total > 0 ? left.completed / left.total : 0
          const rightProgress = right.total > 0 ? right.completed / right.total : 0
          return leftProgress - rightProgress || right.remaining - left.remaining
        }
        return right.remaining - left.remaining || right.total - left.total || left.line.localeCompare(right.line, 'ru', { numeric: true })
      })
  }, [lineSearch, sortMode, statusFilter, summary.rows])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={Gauge}
          label="Линий всего"
          value={String(summary.rows.length)}
          detail="Количество линий в выбранном срезе"
          accent="slate"
        />
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={ClipboardCheck}
          label="Закрыто полностью"
          value={String(completedLines.length)}
          detail="Линии без текущего остатка"
          accent="green"
          actionTitle="Открыть стыки закрытых линий"
          onClick={onOpenRows && completedLineRowIds.length > 0 ? () => onOpenRows(completedLineRowIds, `Показаны стыки полностью закрытых линий: ${completedLineRowIds.length}.`) : undefined}
        />
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={TimerReset}
          label="Линий с остатком"
          value={String(remainingLines.length)}
          detail="Требуют завершения сварки"
          accent="amber"
          actionTitle="Открыть незаваренные стыки этих линий"
          onClick={onOpenRows && remainingRowIds.length > 0 ? () => onOpenRows(remainingRowIds, `Показан текущий остаток по линиям: ${remainingRowIds.length}.`) : undefined}
        />
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={TimerReset}
          label="Общий остаток"
          value={formatStatisticValue(summary.remaining, unit)}
          detail={`Из общего объема ${formatStatisticValue(summary.total, unit)}`}
          accent="amber"
          actionTitle="Открыть текущий остаток"
          onClick={onOpenRows && remainingRowIds.length > 0 ? () => onOpenRows(remainingRowIds, `Показан текущий остаток по линиям: ${remainingRowIds.length}.`) : undefined}
        />
        <MetricCard
          compact
          wrapDetail
          wrapLabel
          icon={LineChart}
          label="Выполнено"
          value={formatPercent(summary.total > 0 ? (summary.completed / summary.total) * 100 : 0)}
          detail={`${formatStatisticValue(summary.completed, unit)} из ${formatStatisticValue(summary.total, unit)}`}
          accent="blue"
          actionTitle="Открыть выполненные стыки"
          onClick={onOpenRows && completedRowIds.length > 0 ? () => onOpenRows(completedRowIds, `Показаны выполненные стыки по линиям: ${completedRowIds.length}.`) : undefined}
        />
      </div>

      <LineRemainderRankingPanel onOpenRows={onOpenRows} rows={filteredRows} unit={unit} />

      <Panel
        title="Полинейная сводка"
        subtitle="Список линий по проекту/шифру. История цепочки до годного результата и строки «не актуален» по изм. не учитываются."
      >
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="relative min-w-[260px] flex-1">
            <span className="sr-only">Поиск по линии, проекту или шифру</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={lineSearch} onChange={(event) => setLineSearch(event.target.value)} placeholder="Линия, проект или шифр" className="h-10 rounded-md border-slate-200 bg-white pl-9 text-sm" />
            {lineSearch.trim() ? <button type="button" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Очистить поиск" onClick={() => setLineSearch('')}><X className="h-4 w-4" /></button> : null}
          </label>
          <WelderToolbarSegments label="Показать" options={[["all", "Все"], ["remaining", "С остатком"], ["completed", "Закрытые"]]} value={statusFilter} onChange={(value) => setStatusFilter(value as typeof statusFilter)} />
          <WelderToolbarSegments label="Сортировка" options={[["remaining", "По остатку"], ["progress", "По готовности"], ["line", "По линии"]]} value={sortMode} onChange={(value) => setSortMode(value as typeof sortMode)} />
          <Button variant="outline" size="sm" className="h-10 gap-2 rounded-md border-slate-200 bg-white text-slate-600 hover:bg-slate-50" title={showLineDetails ? 'Скрыть параметры линии' : 'Показать параметры линии'} onClick={() => setShowLineDetails((current) => !current)}><Settings2 className="h-4 w-4" />Параметры</Button>
        </div>

        {summary.rows.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-slate-200">
            <div className="overflow-x-auto">
              <table className={cn('w-full table-fixed border-collapse text-sm', showLineDetails ? 'min-w-[1120px]' : 'min-w-[820px]')}>
                <colgroup>
                  {showLineDetails ? (
                    <>
                      <col className="w-[12%]" />
                      <col className="w-[13%]" />
                      <col className="w-[16%]" />
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[9%]" />
                      <col className="w-[20%]" />
                      <col className="w-[14%]" />
                    </>
                  ) : (
                    <>
                      <col className="w-[17%]" />
                      <col className="w-[18%]" />
                      <col className="w-[25%]" />
                      <col className="w-[24%]" />
                      <col className="w-[16%]" />
                    </>
                  )}
                </colgroup>
                <thead className="sticky top-0 z-20 bg-slate-100 text-slate-700">
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
                    <LineHeaderCell align="right">Выполнение, {unitColumnLabel}</LineHeaderCell>
                    <LineHeaderCell align="right">Остаток {unitColumnLabel}</LineHeaderCell>
                  </tr>
                </thead>
                <LineSummaryTableBody onOpenRows={onOpenRows} rows={filteredRows} showLineDetails={showLineDetails} unit={unit} />
              </table>
              {filteredRows.length === 0 ? (
                <div className="border-t border-slate-100 bg-slate-50 p-5 text-sm text-slate-500">
                  По текущему поиску и фильтрам ничего не найдено.
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

function LineRemainderRankingPanel({ onOpenRows, rows, unit }: { onOpenRows?: StatisticsPageProps['onOpenWeldRowIds']; rows: LineSummaryRow[]; unit: StatisticsUnit }) {
  const visibleRows = [...rows].filter((row) => row.remaining > 0).sort((left, right) => right.remaining - left.remaining || right.total - left.total).slice(0, 10)
  const maxTotal = Math.max(1, ...visibleRows.map((row) => row.total))
  return (
    <Panel
      title="Линии с наибольшим остатком"
      subtitle="Первые 10 линий по незавершенному объему. Длина полосы показывает масштаб линии, янтарная часть - текущий остаток."
      headerAction={<div className="flex items-center gap-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-200" />Выполнено</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300" />Остаток</span></div>}
    >
      {visibleRows.length > 0 ? (
        <div className="space-y-2">
          {visibleRows.map((row, index) => {
            const completedPercent = row.total > 0 ? (row.completed / row.total) * 100 : 0
            const remainingPercent = row.total > 0 ? (row.remaining / row.total) * 100 : 0
            const content = <><span className="w-6 shrink-0 text-center text-xs font-medium tabular-nums text-slate-400">{index + 1}</span><span className="w-48 shrink-0 truncate text-sm font-semibold text-slate-800" title={`${row.projectTitle} · ${row.subtitleCode} · ${row.line}`}>{row.line}</span><span className="h-7 min-w-0 flex-1 rounded bg-slate-100"><span className="flex h-full overflow-hidden rounded" style={{ width: `${Math.max(3, (row.total / maxTotal) * 100)}%` }}><span className="h-full bg-sky-200" style={{ width: `${completedPercent}%` }} /><span className="h-full bg-amber-300" style={{ width: `${remainingPercent}%` }} /></span></span><span className="w-28 shrink-0 text-right text-xs tabular-nums text-slate-600">остаток <strong className="text-amber-800">{formatStatisticValue(row.remaining, unit)}</strong></span>{row.rowIds.length > 0 ? <ArrowUpRight className="h-4 w-4 shrink-0 text-sky-600" /> : null}</>
            return onOpenRows && row.rowIds.length > 0 ? <button key={row.key} type="button" className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-sky-100 hover:bg-sky-50/50" title={`Открыть стыки линии ${row.line}`} onClick={() => onOpenRows(row.rowIds, `Показаны стыки линии ${row.line}: ${row.rowIds.length}.`)}>{content}</button> : <div key={row.key} className="flex items-center gap-2 px-2 py-1.5">{content}</div>
          })}
        </div>
      ) : <div className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 p-5 text-sm text-emerald-800">По текущему срезу и фильтрам линий с остатком нет.</div>}
    </Panel>
  )
}

function LineSummaryTableBody({
  onOpenRows,
  rows,
  showLineDetails,
  unit,
}: {
  onOpenRows?: StatisticsPageProps['onOpenWeldRowIds']
  rows: LineSummaryRow[]
  showLineDetails: boolean
  unit: StatisticsUnit
}) {
  const {
    bodyRef,
    bottomSpacerHeight,
    measureRow,
    rowIndexes,
    topSpacerHeight,
    visibleRows,
  } = useWindowTableVirtualization({
    rows,
    estimateRowHeight: 76,
  })
  const columnCount = showLineDetails ? 8 : 5

  return (
    <tbody ref={bodyRef}>
      <LineSummaryVirtualSpacer colSpan={columnCount} height={topSpacerHeight} />
      {visibleRows.map((row, visibleIndex) => (
        <LineSummaryTableRow
          key={row.key}
          row={row}
          rowIndex={rowIndexes[visibleIndex] ?? visibleIndex}
          measureRow={measureRow}
          onOpenRows={onOpenRows}
          showLineDetails={showLineDetails}
          unit={unit}
        />
      ))}
      <LineSummaryVirtualSpacer colSpan={columnCount} height={bottomSpacerHeight} />
    </tbody>
  )
}

function LineSummaryVirtualSpacer({
  colSpan,
  height,
}: {
  colSpan: number
  height: number
}) {
  if (height <= 0) return null
  return (
    <tr aria-hidden="true">
      <td colSpan={colSpan} style={{ height, padding: 0, border: 0 }} />
    </tr>
  )
}

function LineSummaryTableRow({
  onOpenRows,
  row,
  rowIndex,
  measureRow,
  showLineDetails,
  unit,
}: {
  onOpenRows?: StatisticsPageProps['onOpenWeldRowIds']
  row: LineSummaryRow
  rowIndex: number
  measureRow?: RefCallback<HTMLTableRowElement>
  showLineDetails: boolean
  unit: StatisticsUnit
}) {
  return (
    <tr
      ref={measureRow}
      data-index={rowIndex}
      className={cn(
        'border-t border-slate-100',
        rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/60',
      )}
    >
      <LineBodyCell align="left">{row.projectTitle}</LineBodyCell>
      <LineBodyCell align="left">{row.subtitleCode}</LineBodyCell>
      <LineBodyCell align="left" className="font-semibold text-slate-900">
        <div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-words">{row.line}</span>{onOpenRows && row.rowIds.length > 0 ? <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-sky-600 hover:bg-sky-50" title={`Открыть стыки линии ${row.line}`} onClick={() => onOpenRows(row.rowIds, `Показаны стыки линии ${row.line}: ${row.rowIds.length}.`)}><ArrowUpRight className="h-4 w-4" /></button> : null}</div>
      </LineBodyCell>
      {showLineDetails ? (
        <>
          <LineBodyCell align="left">{row.groupName}</LineBodyCell>
          <LineBodyCell align="left">{row.category}</LineBodyCell>
          <LineBodyCell>{row.weldControlPercent}</LineBodyCell>
        </>
      ) : null}
      <LineBodyCell>
        <LineCompletionCell row={row} unit={unit} />
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

function LineCompletionCell({ row, unit }: { row: LineSummaryRow; unit: StatisticsUnit }) {
  const percent = row.total > 0 ? (row.completed / row.total) * 100 : 0
  return (
    <div className="ml-auto w-full max-w-[240px]">
      <div className="flex items-center justify-end gap-2 text-xs tabular-nums text-slate-500"><strong className="text-slate-800">{formatStatisticValue(row.completed, unit)} / {formatStatisticValue(row.total, unit)}</strong><span>{formatPercent(percent)}</span></div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-300" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
      <div className="mt-1 flex justify-end gap-1 text-[10px] text-slate-500"><span className="rounded border border-slate-200 bg-white px-1.5 py-0.5">F {formatStatisticValue(row.completedF, unit)}/{formatStatisticValue(row.totalF, unit)}</span><span className="rounded border border-slate-200 bg-white px-1.5 py-0.5">S {formatStatisticValue(row.completedS, unit)}/{formatStatisticValue(row.totalS, unit)}</span></div>
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

type StatisticsPrintableReportInput = {
  activeTab: StatisticsTab
  dynamics: WeldingDynamicsSummary
  jointFilter: WelderStatisticsJointFilter
  lineSummary: LineSummary
  lnkMethods: StatisticsMethodSummary[]
  percentageLines: PercentageLineSummary[]
  periodLabel: string
  periodDescription: string
  scopeLabel: string
  summary: StatisticsSummary
  unofficialCount: number
  unofficialValue: number
  unit: StatisticsUnit
  welderSummary: WelderStatisticsSummary
}

function buildStatisticsPrintableReport(input: StatisticsPrintableReportInput): PrintableReport {
  const {
    activeTab,
    dynamics,
    jointFilter,
    lineSummary,
    lnkMethods,
    percentageLines,
    periodLabel,
    periodDescription,
    scopeLabel,
    summary,
    unofficialCount,
    unofficialValue,
    unit,
    welderSummary,
  } = input
  const unitLabel = unit === 'wdi' ? 'WDI' : 'стыки'
  const baseMeta = [
    { label: 'Срез', value: scopeLabel },
    { label: 'Период', value: activeTab === 'lineSummary' || activeTab === 'percentageLines' ? 'Текущие данные' : periodLabel },
    ...(activeTab === 'percentageLines' ? [] : [{ label: 'Единица', value: unitLabel }]),
  ]

  if (activeTab === 'general') {
    const jointTypeTable = buildWeldingDynamicsJointTypeTable(dynamics, jointFilter, unit)
    const statusRows: Array<[string, number]> = [
      ['Годен', summary.good],
      ['Не годен', summary.rejected],
      ['Годен по дублю', summary.duplicateGood],
      ['Не годен по дубю', summary.duplicateRejected],
      ['Ожидает заявку', summary.waitingRequest],
      ['Ожидает НК', summary.waitingControl],
      ['Ожидает ремонт', summary.waitingRepair],
      ['Ожидает сварку', summary.waitingWeld],
    ]
    return {
      title: 'Статистика сварки',
      subtitle: periodDescription,
      meta: [...baseMeta, { label: 'Тип стыка', value: getJointFilterLabel(jointFilter) }],
      metrics: [
        {
          label: 'Сварено за период',
          value: formatStatisticValue(summary.welded, unit),
          detail: `${formatPercent(summary.weldedShare)} от общего количества`,
          tone: 'blue',
        },
        {
          label: 'Годность',
          value: summary.good + summary.rejected > 0 ? formatPercent(summary.qualityPercent) : '—',
          detail: summary.good + summary.rejected > 0
            ? `${formatStatisticValue(summary.good, unit)} годен · ${formatStatisticValue(summary.rejected, unit)} не годен`
            : 'Нет результатов для расчета годности',
          tone: 'green',
        },
        {
          label: `В смену, ${unitLabel}`,
          value: formatAverageStatisticValue(dynamics.periodDays > 0 ? dynamics.totalValue / dynamics.periodDays : 0),
          detail: `${formatStatisticValue(dynamics.totalValue, unit)} за ${dynamics.periodDays} дн.`,
          tone: 'amber',
        },
        {
          label: 'Количество сварщиков',
          value: String(dynamics.totalWelders),
          detail: 'Уникальные фактические клейма за период',
          tone: 'blue',
        },
        {
          label: getAveragePerWelderShiftLabel(unit),
          value: formatValuePerWelderShift(dynamics.averageValuePerWelderShift, dynamics.welderShiftCount),
          detail: `Среднее число сварщиков в смену: ${formatAverageStatisticValue(dynamics.averageWeldersPerShift)}`,
          tone: 'slate',
        },
        {
          label: 'Ремонтов выполнено',
          value: formatStatisticValue(summary.completedRepairs, unit),
          detail: 'Повторные стыки с завершенной сваркой',
          tone: 'slate',
        },
      ],
      charts: [
        {
          title: 'Динамика сварки',
          subtitle: `Общий объем по периодам, ${unitLabel}; в подписи указано число сварщиков по фактическим клеймам. Распределение по типам стыков и группам материалов приведено ниже.`,
          valueLabel: unitLabel,
          items: dynamics.buckets.map((bucket) => ({
            label: bucket.shortLabel,
            value: bucket.value,
            detail: `${bucket.welderCount} св. · ${bucket.welderShiftCount > 0 ? `${formatAverageStatisticValue(bucket.valuePerWelderShift)} ${unitLabel}/св.` : '—'}`,
          })),
        },
      ],
      tables: [
        ...(jointTypeTable ? [jointTypeTable] : []),
        ...(!jointTypeTable && dynamics.materialGroups.length > 0
          ? [{
              title: 'Группы материалов за период',
              columns: ['Группа материалов', unitLabel, 'Доля'],
              rows: dynamics.materialGroups.map((group) => [
                group.label,
                formatStatisticValue(group.value, unit),
                formatPercent(dynamics.totalValue > 0 ? (group.value / dynamics.totalValue) * 100 : 0),
              ]),
            }]
          : []),
        {
          title: 'Состояние стыков',
          columns: ['Состояние', unitLabel, 'Доля'],
          rows: statusRows.map(([label, value]) => [
            label,
            formatStatisticValue(value, unit),
            formatPercent(summary.totalRows > 0 ? (value / summary.totalRows) * 100 : 0),
          ]),
        },
        {
          title: 'Текущий остаток вне выбранного периода',
          columns: ['Состояние', unitLabel],
          rows: [
            ['Всего в остатке', formatStatisticValue(summary.backlogTotal, unit)],
            ['Ожидает сварку', formatStatisticValue(summary.backlogWaitingWeld, unit)],
            ['Ожидает ремонт', formatStatisticValue(summary.backlogWaitingRepair, unit)],
          ],
        },
      ],
    }
  }

  if (activeTab === 'lnk') {
    return {
      title: 'Статистика ЛНК',
      subtitle: 'Заявки, заключения, результаты и текущие очереди по видам неразрушающего контроля.',
      meta: [...baseMeta, { label: 'Расчет', value: periodDescription }],
      metrics: [
        {
          label: 'Заявки ЛНК',
          value: formatPercent(summary.lnkRequestCoveragePercent),
          detail: `${summary.lnkCreatedRequests} из ${summary.lnkRequiredRequests} требуемых контролей`,
          tone: 'blue',
        },
        {
          label: 'Заключения ЛНК',
          value: formatPercent(summary.lnkClosurePercent),
          detail: `${formatStatisticValue(summary.lnkClosed, unit)} из ${formatStatisticValue(summary.lnkRequests, unit)} заявок`,
          tone: 'blue',
        },
        { label: 'Без заявки', value: formatStatisticValue(lnkMethods.reduce((total, method) => total + method.waitingRequest, 0), unit), detail: 'Требуемые позиции без заявки', tone: 'amber' },
        { label: 'Ожидает заключение', value: formatStatisticValue(lnkMethods.reduce((total, method) => total + method.waitingControl, 0), unit), detail: 'Заявки без результата', tone: 'blue' },
        { label: 'Не годен', value: formatStatisticValue(lnkMethods.reduce((total, method) => total + method.rejected, 0), unit), detail: 'Ремонт или вырез', tone: 'amber' },
        {
          label: 'Неофициальные стыки',
          value: String(unofficialCount),
          detail: `${formatStatisticValue(unofficialValue, unit)} в выбранной единице`,
          tone: 'slate',
        },
      ],
      charts: [
        {
          title: 'Закрытие заявок по видам контроля',
          valueLabel: unitLabel,
          items: lnkMethods.map((method) => ({
            label: method.code,
            value: method.closed,
            detail: `из ${formatStatisticValue(method.requests, unit)}`,
          })),
        },
      ],
      tables: [
        {
          title: 'Лаборатория по видам контроля',
          columns: ['Вид', 'Требуется', 'Заявлено', 'Заявлено, %', 'Заявок', 'Закрыто', 'Всего результатов', 'Без заявки', 'Ожидает НК', 'Годен', 'Не годен', 'Закрытие'],
          rows: lnkMethods.map((method) => [
            method.code,
            String(method.requiredRequests),
            String(method.createdRequests),
            formatPercent(method.requestCoveragePercent),
            formatStatisticValue(method.requests, unit),
            formatStatisticValue(method.closed, unit),
            formatStatisticValue(method.totalClosed, unit),
            formatStatisticValue(method.waitingRequest, unit),
            formatStatisticValue(method.waitingControl, unit),
            formatStatisticValue(method.good, unit),
            formatStatisticValue(method.rejected, unit),
            formatPercent(method.closurePercent),
          ]),
        },
        {
          title: 'Состояние стыков за период',
          columns: ['Состояние', unitLabel],
          rows: [
            ['Годен', formatStatisticValue(summary.good, unit)],
            ['Не годен', formatStatisticValue(summary.rejected, unit)],
            ['Годен по дублю', formatStatisticValue(summary.duplicateGood, unit)],
            ['Не годен по дублю', formatStatisticValue(summary.duplicateRejected, unit)],
            ['Ожидает заявку', formatStatisticValue(summary.waitingRequest, unit)],
            ['Ожидает НК', formatStatisticValue(summary.waitingControl, unit)],
            ['Ожидает ремонт', formatStatisticValue(summary.waitingRepair, unit)],
          ],
        },
      ],
    }
  }

  if (activeTab === 'psto') {
    const method = summary.pstoMethod
    return {
      title: 'Статистика ПСТО',
      subtitle: 'Заявки, проведение и текущая очередь послесварочной термообработки.',
      meta: [...baseMeta, { label: 'Расчет', value: periodDescription }],
      metrics: [
        {
          label: 'Заявки ПСТО',
          value: formatPercent(summary.pstoRequestCoveragePercent),
          detail: `${summary.pstoCreatedRequests} из ${summary.pstoRequiredRequests} требуемых обработок`,
          tone: 'blue',
        },
        {
          label: 'Заключения ПСТО',
          value: formatPercent(summary.pstoClosurePercent),
          detail: `${formatStatisticValue(summary.pstoClosed, unit)} из ${formatStatisticValue(summary.pstoRequests, unit)} заявок`,
          tone: 'green',
        },
        { label: 'Без заявки', value: formatStatisticValue(method.waitingRequest, unit), detail: 'Требуемые позиции без заявки', tone: 'amber' },
        { label: 'Ожидает ПСТО', value: formatStatisticValue(method.waitingControl, unit), detail: 'Заявки без проведения', tone: 'blue' },
        { label: 'Проведено', value: formatStatisticValue(method.good, unit), detail: 'Заключения за выбранный период', tone: 'green' },
        {
          label: 'Неофициальные стыки',
          value: String(unofficialCount),
          detail: `${formatStatisticValue(unofficialValue, unit)} в выбранной единице`,
          tone: 'slate',
        },
      ],
      tables: [
        {
          title: 'ПСТО по этапам',
          columns: ['Требуется', 'Заявлено', 'Заявлено, %', 'Заявок', 'Закрыто', 'Всего заключений', 'Без заявки', 'Ожидает ПСТО', 'Проведено', 'Закрытие'],
          rows: [[
            String(method.requiredRequests),
            String(method.createdRequests),
            formatPercent(method.requestCoveragePercent),
            formatStatisticValue(method.requests, unit),
            formatStatisticValue(method.closed, unit),
            formatStatisticValue(method.totalClosed, unit),
            formatStatisticValue(method.waitingRequest, unit),
            formatStatisticValue(method.waitingControl, unit),
            formatStatisticValue(method.good, unit),
            formatPercent(method.closurePercent),
          ]],
        },
        {
          title: 'Состояние стыков за период',
          columns: ['Состояние', unitLabel],
          rows: [
            ['Годен', formatStatisticValue(summary.good, unit)],
            ['Не годен', formatStatisticValue(summary.rejected, unit)],
            ['Годен по дублю', formatStatisticValue(summary.duplicateGood, unit)],
            ['Не годен по дублю', formatStatisticValue(summary.duplicateRejected, unit)],
            ['Ожидает заявку', formatStatisticValue(summary.waitingRequest, unit)],
            ['Ожидает НК', formatStatisticValue(summary.waitingControl, unit)],
            ['Ожидает ремонт', formatStatisticValue(summary.waitingRepair, unit)],
          ],
        },
      ],
    }
  }

  if (activeTab === 'welders') {
    const controlled = welderSummary.good + welderSummary.rejected
    return {
      title: 'Статистика сварщиков',
      subtitle: 'Расчет выполнен по фактическим клеймам. Вклад распределяется между сварщиками по выполненным слоям.',
      meta: [...baseMeta, { label: 'Тип стыка', value: getJointFilterLabel(jointFilter) }],
      metrics: [
        { label: 'Сварщиков', value: String(welderSummary.totalWelders), detail: 'Уникальные фактические клейма', tone: 'blue' },
        {
          label: 'Всего работ',
          value: formatStatisticValue(welderSummary.total, unit),
          detail: unitLabel,
          tone: 'slate',
        },
        {
          label: 'Годен',
          value: formatStatisticValue(welderSummary.good, unit),
          detail: `Ожидает заявку ${formatStatisticValue(welderSummary.waitingRequest, unit)}`,
          tone: 'green',
        },
        {
          label: 'Проконтролировано',
          value: formatStatisticValue(controlled, unit),
          detail: 'Годные + негодные',
          tone: 'blue',
        },
        {
          label: '% брака',
          value: formatPercent(welderSummary.defectPercent),
          detail: `${formatStatisticValue(welderSummary.rejected, unit)} не годен`,
          tone: welderSummary.defectPercent > 25 ? 'rose' : welderSummary.defectPercent >= 5 ? 'amber' : 'green',
        },
      ],
      charts: [
        {
          title: 'Объем по сварщикам',
          subtitle: `Первые ${Math.min(24, welderSummary.rows.length)} сварщика по расчетному объему.`,
          valueLabel: unitLabel,
          items: [...welderSummary.rows]
            .sort((left, right) => right.total - left.total)
            .slice(0, 24)
            .map((row) => ({
              label: row.stamp,
              value: row.total,
              detail: row.welderName || '',
            })),
        },
      ],
      tables: [
        {
          title: 'Отчет по сварщикам',
          columns: ['Клеймо', 'ФИО', 'Всего', 'Годен', 'Ожидает заявку', 'Ожидает НК', 'Не годен', '% брака', 'Группы материалов'],
          rows: welderSummary.rows.map((row) => [
            row.stamp,
            row.welderName || '—',
            formatStatisticValue(row.total, unit),
            formatStatisticValue(row.good, unit),
            formatStatisticValue(row.waitingRequest, unit),
            formatStatisticValue(row.waitingControl, unit),
            formatStatisticValue(row.rejected, unit),
            formatPercent(row.defectPercent),
            row.materialGroups
              .map((group) => `${group.key}: ${formatStatisticValue(group.total, unit)}`)
              .join('; ') || '—',
          ]),
        },
      ],
    }
  }

  if (activeTab === 'lineSummary') {
    return {
      title: 'Полинейная сводка',
      subtitle: 'Актуальный объем, выполнение и остаток по проектам, шифрам и линиям.',
      meta: baseMeta,
      metrics: [
        { label: 'Линий', value: String(lineSummary.rows.length), detail: 'В текущем срезе', tone: 'slate' },
        { label: `Всего, ${unitLabel}`, value: formatStatisticValue(lineSummary.total, unit), tone: 'blue' },
        {
          label: 'Выполнено',
          value: formatPercent(lineSummary.total > 0 ? (lineSummary.completed / lineSummary.total) * 100 : 0),
          detail: `${formatStatisticValue(lineSummary.completed, unit)} из ${formatStatisticValue(lineSummary.total, unit)}`,
          tone: 'green',
        },
        { label: `Остаток, ${unitLabel}`, value: formatStatisticValue(lineSummary.remaining, unit), tone: 'amber' },
      ],
      charts: [
        {
          title: 'Выполнение по линиям',
          subtitle: `Первые ${Math.min(24, lineSummary.rows.length)} линии по общему объему.`,
          valueLabel: unitLabel,
          items: [...lineSummary.rows]
            .sort((left, right) => right.total - left.total)
            .slice(0, 24)
            .map((row) => ({
              label: row.line,
              value: row.completed,
              detail: `из ${formatStatisticValue(row.total, unit)}`,
            })),
        },
      ],
      tables: [
        {
          title: 'Линии',
          columns: ['Проект', 'Шифр', 'Линия', 'Группа трубопровода', 'Категория трубопровода', 'Контроль, %', 'Всего', 'Выполнено', 'Остаток'],
          rows: lineSummary.rows.map((row) => [
            row.projectTitle,
            row.subtitleCode,
            row.line,
            row.groupName,
            row.category,
            row.weldControlPercent,
            formatStatisticValue(row.total, unit),
            formatStatisticValue(row.completed, unit),
            formatStatisticValue(row.remaining, unit),
          ]),
        },
      ],
    }
  }

  const percentageTotals = getPercentageLineReportTotals(percentageLines)
  const percentageLineRows = percentageLines.map((line) => {
    const stamps = getPercentageLineStampTotals(line.stamps)
    return {
      line,
      ...stamps,
    }
  })
  return {
    title: 'Отчет по процентным линиям',
    subtitle: 'Расчет по официальным клеймам на линиях с единым процентом меньше 100. Для У-стыков учитывается ПВК.',
    meta: baseMeta,
    metrics: [
      { label: 'Процентных линий', value: String(percentageLines.length), detail: `${percentageTotals.joints} сваренных стыков`, tone: 'blue' },
      { label: 'Клейм', value: String(percentageTotals.stamps), detail: 'Участвуют в расчете', tone: 'slate' },
      { label: 'Требуется контроля', value: String(percentageTotals.required), detail: 'По расчету процентных линий', tone: 'green' },
      { label: 'Осталось закрыть', value: String(percentageTotals.missing), detail: `Закрыто ${percentageTotals.covered}`, tone: 'amber' },
      { label: 'Лишнее “да”', value: String(percentageTotals.excess), detail: `100% по клейму: ${percentageTotals.fullControl}`, tone: 'rose' },
    ],
    charts: [
      {
        title: 'Требуется контроля по линиям',
        subtitle: `Первые ${Math.min(24, percentageLineRows.length)} линии по требуемому количеству контроля.`,
        valueLabel: 'контролей',
        items: percentageLineRows.slice(0, 24).map((row) => ({
          label: row.line.line,
          value: row.required,
          detail: `закрыто ${row.covered}`,
        })),
      },
    ],
    tables: [
      {
        title: 'Сводка по линиям',
        columns: ['Проект', 'Шифр', 'Линия', '%', 'Стыков', 'Клейм', 'Требуется', 'Назначено', 'Закрыто', 'Осталось', 'Лишнее'],
        rows: percentageLineRows.map((row) => [
          row.line.projectTitle,
          row.line.subtitleCode,
          row.line.line,
          row.line.percent,
          row.line.rowCount,
          row.line.stamps.length,
          row.required,
          row.assigned,
          row.covered,
          row.missing,
          row.excess,
        ]),
      },
      {
        title: 'Расчет по официальным клеймам',
        columns: ['Проект', 'Шифр', 'Линия', 'Клеймо', 'Стыков', 'Требуется', 'Назначено', 'Закрыто', 'Выполнено', 'Осталось', 'Лишнее', '100%'],
        rows: percentageLines.flatMap((line) =>
          line.stamps.map((stamp) => [
            line.projectTitle,
            line.subtitleCode,
            line.line,
            stamp.stamp,
            stamp.officialJointCount,
            stamp.requiredControls,
            stamp.assignedControls,
            stamp.coveredControls,
            stamp.completedControls,
            stamp.missingControls,
            stamp.excessControls,
            stamp.fullControlRequired ? 'да' : 'нет',
          ]),
        ),
      },
    ],
  }
}

function filterPercentageLineSummaries(summary: PercentageLineSummary[], search: string) {
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
}

function getPercentageLineReportTotals(lines: PercentageLineSummary[]) {
  return lines.reduce(
    (totals, line) => {
      totals.joints += line.rowCount
      totals.stamps += line.stamps.length
      totals.potentialReduction += line.potentialControlReduction
      const stampTotals = getPercentageLineStampTotals(line.stamps)
      totals.required += stampTotals.required
      totals.assigned += stampTotals.assigned
      totals.covered += stampTotals.covered
      totals.missing += stampTotals.missing
      totals.excess += stampTotals.excess
      totals.fullControl += stampTotals.fullControl
      return totals
    },
    {
      joints: 0,
      stamps: 0,
      required: 0,
      assigned: 0,
      covered: 0,
      missing: 0,
      excess: 0,
      potentialReduction: 0,
      fullControl: 0,
    },
  )
}

function getPercentageLineStampTotals(stamps: PercentageLineStampSummary[]) {
  return stamps.reduce(
    (totals, stamp) => ({
      required: totals.required + stamp.requiredControls,
      assigned: totals.assigned + stamp.assignedControls,
      covered: totals.covered + stamp.coveredControls,
      missing: totals.missing + stamp.missingControls,
      excess: totals.excess + stamp.excessControls,
      fullControl: totals.fullControl + (stamp.fullControlRequired ? 1 : 0),
    }),
    { required: 0, assigned: 0, covered: 0, missing: 0, excess: 0, fullControl: 0 },
  )
}

function getJointFilterLabel(filter: WelderStatisticsJointFilter) {
  return jointFilterOptions.find(([value]) => value === filter)?.[1] ?? 'Все'
}

function segmentButtonClass(active: boolean) {
  return cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    active ? 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
  )
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

function formatValuePerWelderShift(value: number, welderShiftCount: number) {
  return welderShiftCount > 0 ? formatAverageStatisticValue(value) : '—'
}

function getAveragePerWelderShiftLabel(unit: StatisticsUnit) {
  return unit === 'wdi'
    ? 'Средний WDI на сварщика в смену'
    : 'Среднее количество стыков на сварщика в смену'
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
