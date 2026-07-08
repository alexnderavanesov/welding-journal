import { StatisticsPage } from '@/components/statistics-page'
import { WelderStampsRegistry, type WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import { WeldTable, type WeldTableProps } from '@/components/weld-table'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import type { PercentageLineStampFilter } from '@/lib/report-navigation'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type ReportMainContentProps = {
  activeReport: ActiveReport
  statisticsRows: WeldRow[]
  welderStamps: WelderStampRecord[]
  welderStampsRegistryProps: WelderStampsRegistryProps
  weldTableProps: WeldTableProps
  onCancelPercentageLineMissingControls?: (rowIds: number[]) => Promise<void> | void
  onOpenPercentageLineStampRows?: (filter: PercentageLineStampFilter) => void
  onOpenWeldRowIds?: (rowIds: number[], message?: string) => void
}

export function ReportMainContent({
  activeReport,
  statisticsRows,
  welderStamps,
  welderStampsRegistryProps,
  weldTableProps,
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
        onCancelPercentageLineMissingControls={onCancelPercentageLineMissingControls}
        onOpenPercentageLineStampRows={onOpenPercentageLineStampRows}
        onOpenWeldRowIds={onOpenWeldRowIds}
      />
    )
  }

  if (activeReport === 'welderStamps') {
    return <WelderStampsRegistry {...welderStampsRegistryProps} />
  }

  return <WeldTable {...weldTableProps} />
}
