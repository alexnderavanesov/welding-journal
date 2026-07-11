import { DocumentsPage } from '@/components/documents-page'
import { SettingsPage } from '@/components/settings-page'
import { StatisticsPage } from '@/components/statistics-page'
import { UserGuidePage } from '@/components/user-guide-page'
import { WelderStampsRegistry, type WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import { WeldTable, type WeldTableProps } from '@/components/weld-table'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DocumentGenerationRequest } from '@/lib/document-generation'
import type { ActiveReport } from '@/lib/home-state'
import type { PercentageControlMethod } from '@/lib/percentage-line-summary'
import type { PercentageLineStampFilter } from '@/lib/report-navigation'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type ReportMainContentProps = {
  activeReport: ActiveReport
  documentGenerationRequest?: DocumentGenerationRequest | null
  statisticsRows: WeldRow[]
  welderStamps: WelderStampRecord[]
  welderStampsRegistryProps: WelderStampsRegistryProps
  weldTableProps: WeldTableProps
  onAssignPercentageLineMissingControls?: (rowIds: number[], method: PercentageControlMethod) => Promise<void> | void
  onCancelPercentageLineMissingControls?: (rowIds: number[]) => Promise<void> | void
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
  onOpenWeldRowIds?: (rowIds: number[], message?: string) => void
}

export function ReportMainContent({
  activeReport,
  documentGenerationRequest,
  statisticsRows,
  welderStamps,
  welderStampsRegistryProps,
  weldTableProps,
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  onOpenPercentageLineStampRows,
  onOpenWeldRowIds,
}: ReportMainContentProps) {
  if (activeReport === 'statistics' || activeReport === 'percentageLines') {
    return (
      <StatisticsPage
        fixedTab={activeReport === 'percentageLines' ? 'percentageLines' : undefined}
        rows={statisticsRows}
        welderStamps={welderStamps}
        onAssignPercentageLineMissingControls={onAssignPercentageLineMissingControls}
        onCancelPercentageLineMissingControls={onCancelPercentageLineMissingControls}
        onOpenPercentageLineStampRows={onOpenPercentageLineStampRows}
        onOpenWeldRowIds={onOpenWeldRowIds}
      />
    )
  }

  if (activeReport === 'welderStamps') {
    return <WelderStampsRegistry {...welderStampsRegistryProps} />
  }

  if (activeReport === 'documents') {
    return <DocumentsPage rows={statisticsRows} welderStamps={welderStamps} generationRequest={documentGenerationRequest} />
  }

  if (activeReport === 'settings') {
    return <SettingsPage rows={statisticsRows} />
  }

  if (activeReport === 'userGuide') {
    return <UserGuidePage />
  }

  return <WeldTable {...weldTableProps} />
}
