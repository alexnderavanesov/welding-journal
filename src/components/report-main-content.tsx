import type { ComponentProps } from 'react'
import { WelderStampsRegistry } from '@/components/welder-stamps-registry'
import { WeldTable } from '@/components/weld-table'
import type { ActiveReport } from '@/lib/home-state'

type ReportMainContentProps = {
  activeReport: ActiveReport
  welderStampsRegistryProps: ComponentProps<typeof WelderStampsRegistry>
  weldTableProps: ComponentProps<typeof WeldTable>
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
