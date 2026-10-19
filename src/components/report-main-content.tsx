import { lazy, Suspense, type ReactNode } from 'react'
import type { WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import type { DocumentsPageType } from '@/components/documents-page'
import type { WeldTableProps } from '@/lib/weld-report-table-types'
import type { ActiveReport } from '@/lib/home-state'
import type { DocumentNavigationRequest } from '@/lib/document-navigation'
import type {
  PercentageLineNavigationOutcome,
  PercentageLineNavigationRequest,
} from '@/lib/percentage-line-navigation'
import type { PercentageLineStampFilter } from '@/lib/report-navigation'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import type { WeldReportExportFieldsRef } from '@/lib/weld-report-export-fields'

const StatisticsPage = lazy(() => import('@/components/statistics-page').then((module) => ({ default: module.StatisticsPage })))
const LineProgramPage = lazy(() => import('@/components/line-program-page').then((module) => ({ default: module.LineProgramPage })))
const WelderStampsRegistry = lazy(() =>
  import('@/components/welder-stamps-registry').then((module) => ({ default: module.WelderStampsRegistry })),
)
const DocumentsPage = lazy(() => import('@/components/documents-page').then((module) => ({ default: module.DocumentsPage })))
const SettingsPage = lazy(() => import('@/components/settings-page').then((module) => ({ default: module.SettingsPage })))
const UserGuidePage = lazy(() => import('@/components/user-guide-page').then((module) => ({ default: module.UserGuidePage })))
const WeldReportGrid = lazy(() => import('@/components/weld-report-grid').then((module) => ({ default: module.WeldReportGrid })))

type ReportMainContentProps = {
  onCancelEarlyCoil?: (sourceId: number) => void
  activeReport: ActiveReport
  welderStamps: WelderStampRecord[]
  welderStampsRegistryProps: WelderStampsRegistryProps
  welderStampsHeader?: ReactNode
  weldTableProps: WeldTableProps
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
  onOpenWeldRowIds?: (rowIds: number[], message?: string) => void
  percentageLineNavigationRequest?: PercentageLineNavigationRequest | null
  onPercentageLineNavigationRequestHandled?: (
    requestId: number,
    outcome: PercentageLineNavigationOutcome,
  ) => void
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
  onOpenDocumentJointHistory?: (rowId: number) => void
  documentsPageType?: DocumentsPageType
  onDocumentsPageTypeChange?: (documentType: DocumentsPageType) => void
  documentNavigationRequest?: DocumentNavigationRequest | null
  onDocumentNavigationRequestHandled?: (requestId: number) => void
  reportTaskPanels?: ReactNode
  journalSummary?: (beforeSearch?: ReactNode) => ReactNode
  reportExportFieldsRef?: WeldReportExportFieldsRef
}

export function ReportMainContent({
  onCancelEarlyCoil,
  activeReport,
  welderStamps,
  welderStampsRegistryProps,
  welderStampsHeader,
  weldTableProps,
  onOpenPercentageLineStampRows,
  onOpenReportRowIds,
  onOpenWeldRowIds,
  percentageLineNavigationRequest,
  onPercentageLineNavigationRequestHandled,
  onOpenDocumentRows,
  onOpenDocumentJointHistory,
  documentsPageType,
  onDocumentsPageTypeChange,
  documentNavigationRequest,
  onDocumentNavigationRequestHandled,
  reportTaskPanels,
  journalSummary,
  reportExportFieldsRef,
}: ReportMainContentProps) {
  if (activeReport === 'percentageLines') {
    return <Suspense fallback={<ReportSectionFallback label="Загружаем программу линий" />}>
      <LineProgramPage onOpenReportRows={onOpenReportRowIds} navigationRequest={percentageLineNavigationRequest} onNavigationHandled={onPercentageLineNavigationRequestHandled} />
    </Suspense>
  }
  if (activeReport === 'statistics') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем статистику" />}>
        <StatisticsPage
          key={activeReport}
          onOpenReportRowIds={onOpenReportRowIds}
          onOpenWeldRowIds={onOpenWeldRowIds}
          percentageLineNavigationRequest={percentageLineNavigationRequest}
          onPercentageLineNavigationRequestHandled={onPercentageLineNavigationRequestHandled}
        />
      </Suspense>
    )
  }

  if (activeReport === 'welderStamps') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем клейма" />}>
        <WelderStampsRegistry {...welderStampsRegistryProps} header={welderStampsHeader} taskPanels={reportTaskPanels} />
      </Suspense>
    )
  }

  if (activeReport === 'documents') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем документы" />}>
        <DocumentsPage
          welderStamps={welderStamps}
          initialDocumentType={documentsPageType}
          onDocumentTypeChange={onDocumentsPageTypeChange}
          navigationRequest={documentNavigationRequest}
          onNavigationRequestHandled={onDocumentNavigationRequestHandled}
          onOpenDocumentRows={onOpenDocumentRows}
          onOpenJointHistory={onOpenDocumentJointHistory}
        />
      </Suspense>
    )
  }

  if (activeReport === 'settings') {
    return (
      <Suspense fallback={<ReportSectionFallback label="Загружаем настройки" />}>
        <SettingsPage onOpenReportRowIds={onOpenReportRowIds} onCancelEarlyCoil={onCancelEarlyCoil} />
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

  return <Suspense fallback={<ReportSectionFallback label="Загружаем таблицу" />}>
    <WeldReportGrid {...weldTableProps} report={activeReport} reportTaskPanels={reportTaskPanels} renderSummary={journalSummary} reportExportFieldsRef={reportExportFieldsRef} />
  </Suspense>
}

function ReportSectionFallback({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
      {label}...
    </div>
  )
}
