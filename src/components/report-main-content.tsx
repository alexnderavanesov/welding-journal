import { WelderStampsRegistry, type WelderStampsRegistryProps } from '@/components/welder-stamps-registry'
import { WeldTable, type WeldTableProps } from '@/components/weld-table'
import type { ActiveReport } from '@/lib/home-state'

type ReportMainContentProps = {
  activeReport: ActiveReport
  welderStampsRegistryProps: WelderStampsRegistryProps
  weldTableProps: WeldTableProps
}

export function ReportMainContent({
  activeReport,
  welderStampsRegistryProps,
  weldTableProps,
}: ReportMainContentProps) {
  if (activeReport === 'welderStamps') {
    return <WelderStampsRegistry {...welderStampsRegistryProps} />
  }

  return <WeldTable {...weldTableProps} />
}
