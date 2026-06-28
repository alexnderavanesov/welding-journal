import { canCreatePstoRequest } from '@/lib/psto-status'
import { canCreateLnkRequest } from '@/lib/report-control-state'
import { getLnkRowRequestNames } from '@/lib/report-modal-rows'
import type { ReportRow, ReportRowActionHandlers } from '@/lib/report-row-actions'
import { hasText } from '@/lib/report-value-utils'

type CreateReportRowActionHandlersOptions = {
  openCreatePstoRequestModalForRow: (row: ReportRow) => void
  openAddPstoResultModalForRow: (row: ReportRow) => void
  openCreateLnkRequestModalForRow: (row: ReportRow) => void
  openAddLnkResultModalForRow: (row: ReportRow) => void
}

export function createReportRowActionHandlers({
  openCreatePstoRequestModalForRow,
  openAddPstoResultModalForRow,
  openCreateLnkRequestModalForRow,
  openAddLnkResultModalForRow,
}: CreateReportRowActionHandlersOptions): ReportRowActionHandlers {
  return {
    openCreatePstoRequestModalForRow,
    openAddPstoResultModalForRow,
    canCreatePstoRequest,
    canAddPstoResult: (row) => hasText(row.pstoRequest),
    openCreateLnkRequestModalForRow,
    openAddLnkResultModalForRow,
    canCreateLnkRequest,
    canAddLnkResult: (row) => getLnkRowRequestNames(row).length > 0,
  }
}
