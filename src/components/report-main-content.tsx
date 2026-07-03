import { StatisticsPage } from '@/components/statistics-page'
import { WelderStampsRegistry, type WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import { WeldTable, type WeldTableProps } from '@/components/weld-table'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'

type ReportMainContentProps = {
  activeReport: ActiveReport
  statisticsRows: WeldRow[]
  welderStampsRegistryProps: WelderStampsRegistryProps
  weldTableProps: WeldTableProps
}

export function ReportMainContent({
  activeReport,
  statisticsRows,
  welderStampsRegistryProps,
  weldTableProps,
}: ReportMainContentProps) {
  if (activeReport === 'statistics') {
    return <StatisticsPage rows={statisticsRows} />
  }

  if (activeReport === 'welderStamps') {
    return <WelderStampsRegistry {...welderStampsRegistryProps} />
  }

  return <WeldTable {...weldTableProps} />
}
