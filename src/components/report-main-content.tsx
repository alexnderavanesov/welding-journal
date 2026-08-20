import { lazy, Suspense } from 'react'
import type { WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import { WeldTable, type WeldTableProps } from '@/components/weld-table'
import type { ActiveReport } from '@/lib/home-state'
import type { PercentageControlMethod } from '@/lib/percentage-line-summary'
import type { PercentageLineStampFilter } from '@/lib/report-navigation'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import type { SystemDocumentNavigationRequest } from '@/lib/system-document-types'

const StatisticsPage = lazy(() => import('@/components/statistics-page').then((module) => ({ default: module.StatisticsPage })))
const WelderStampsRegistry = lazy(() =>
  import('@/components/welder-stamps-registry').then((module) => ({ default: module.WelderStampsRegistry })),
)
const DocumentsPage = lazy(() => import('@/components/documents-page').then((module) => ({ default: module.DocumentsPage })))
const SettingsPage = lazy(() => import('@/components/settings-page').then((module) => ({ default: module.SettingsPage })))
const UserGuidePage = lazy(() => import('@/components/user-guide-page').then((module) => ({ default: module.UserGuidePage })))

type ReportMainContentProps = {
  activeReport: ActiveReport
  welderStamps: WelderStampRecord[]
  welderStampsRegistryProps: WelderStampsRegistryProps
  weldTableProps: WeldTableProps
  onAssignPercentageLineMissingControls?: (rowIds: number[], method: PercentageControlMethod) => Promise<void> | void
  onCancelPercentageLineMissingControls?: (rowIds: number[]) => Promise<void> | void
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
  onOpenWeldRowIds?: (rowIds: number[], message?: string) => void
  onOpenReportRowIds?: (
    rowIds: number[],
    targetReport: 'weldingJournal' | 'lnk' | 'heatTreatment',
    message?: string,
  ) => void
  onOpenDocumentRows?: (
    rowIds: number[],
    documentTitle: string,
    targetReport?: 'weldingJournal' | 'lnk' | 'heatTreatment',
  ) => void
  systemDocumentNavigationRequest?: SystemDocumentNavigationRequest | null
  onSystemDocumentNavigationRequestHandled?: (requestId: number) => void
}

export function ReportMainContent({
  activeReport,
  welderStamps,
  welderStampsRegistryProps,
  weldTableProps,
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  onOpenPercentageLineStampRows,
  onOpenReportRowIds,
  onOpenWeldRowIds,
  onOpenDocumentRows,
  systemDocumentNavigationRequest,
  onSystemDocumentNavigationRequestHandled,
}: ReportMainContentProps) {
  if (activeReport === 'statistics' || activeReport === 'percentageLines') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем статистику" />}>
        <StatisticsPage
          key={activeReport}
          fixedTab={activeReport === 'percentageLines' ? 'percentageLines' : undefined}
          onAssignPercentageLineMissingControls={onAssignPercentageLineMissingControls}
          onCancelPercentageLineMissingControls={onCancelPercentageLineMissingControls}
          onOpenPercentageLineStampRows={onOpenPercentageLineStampRows}
          onOpenReportRowIds={onOpenReportRowIds}
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
          welderStamps={welderStamps}
          navigationRequest={systemDocumentNavigationRequest}
          onNavigationRequestHandled={onSystemDocumentNavigationRequestHandled}
          onOpenDocumentRows={onOpenDocumentRows}
        />
      </Suspense>
    )
  }

  if (activeReport === 'settings') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем настройки" />}>
        <SettingsPage />
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
