import { lazy, Suspense } from 'react'
import type { WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import { WeldTable, type WeldTableProps } from '@/components/weld-table'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import type { PercentageControlMethod } from '@/lib/percentage-line-summary'
import type { PercentageLineStampFilter } from '@/lib/report-navigation'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

const StatisticsPage = lazy(() => import('@/components/statistics-page').then((module) => ({ default: module.StatisticsPage })))
const WelderStampsRegistry = lazy(() =>
  import('@/components/welder-stamps-registry').then((module) => ({ default: module.WelderStampsRegistry })),
)
const DocumentsPage = lazy(() => import('@/components/documents-page').then((module) => ({ default: module.DocumentsPage })))
const SettingsPage = lazy(() => import('@/components/settings-page').then((module) => ({ default: module.SettingsPage })))
const UserGuidePage = lazy(() => import('@/components/user-guide-page').then((module) => ({ default: module.UserGuidePage })))

type ReportMainContentProps = {
  activeReport: ActiveReport
  statisticsRows: WeldRow[]
  welderStamps: WelderStampRecord[]
  welderStampsRegistryProps: WelderStampsRegistryProps
  weldTableProps: WeldTableProps
  onAssignPercentageLineMissingControls?: (rowIds: number[], method: PercentageControlMethod) => Promise<void> | void
  onCancelPercentageLineMissingControls?: (rowIds: number[]) => Promise<void> | void
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
  onOpenWeldRowIds?: (rowIds: number[], message?: string) => void
  onOpenDocumentRows?: (rowIds: number[], documentTitle: string) => void
}

export function ReportMainContent({
  activeReport,
  statisticsRows,
  welderStamps,
  welderStampsRegistryProps,
  weldTableProps,
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  onOpenPercentageLineStampRows,
  onOpenWeldRowIds,
  onOpenDocumentRows,
}: ReportMainContentProps) {
  if (activeReport === 'statistics' || activeReport === 'percentageLines') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем статистику" />}>
        <StatisticsPage
          key={activeReport}
          fixedTab={activeReport === 'percentageLines' ? 'percentageLines' : undefined}
          rows={statisticsRows}
          welderStamps={welderStamps}
          onAssignPercentageLineMissingControls={onAssignPercentageLineMissingControls}
          onCancelPercentageLineMissingControls={onCancelPercentageLineMissingControls}
          onOpenPercentageLineStampRows={onOpenPercentageLineStampRows}
          onOpenWeldRowIds={onOpenWeldRowIds}
        />
      </Suspense>
    )
  }

  if (activeReport === 'welderStamps') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем клейма" />}>
        <WelderStampsRegistry {...welderStampsRegistryProps} />
      </Suspense>
    )
  }

  if (activeReport === 'documents') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем документы" />}>
        <DocumentsPage
          rows={statisticsRows}
          welderStamps={welderStamps}
          onOpenDocumentRows={onOpenDocumentRows}
        />
      </Suspense>
    )
  }

  if (activeReport === 'settings') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем настройки" />}>
        <SettingsPage rows={statisticsRows} />
      </Suspense>
    )
  }

  if (activeReport === 'userGuide') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем руководство" />}>
        <UserGuidePage />
      </Suspense>
    )
  }

  return <WeldTable {...weldTableProps} />
}

function ReportSectionFallback({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
      {label}...
    </div>
  )
}
