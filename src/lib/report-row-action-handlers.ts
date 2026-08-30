import {
  canAddPstoWorkflowResult,
  canCreatePstoWorkflowRequest,
} from '@/lib/psto-status'
import {
  canAddLnkWorkflowResult,
  canCreateLnkWorkflowRequest,
} from '@/lib/lnk-workflow-routing'
import type { ReportRow, ReportRowActionHandlers } from '@/lib/report-row-actions'

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
    canCreatePstoRequest: canCreatePstoWorkflowRequest,
    canAddPstoResult: canAddPstoWorkflowResult,
    openCreateLnkRequestModalForRow,
    openAddLnkResultModalForRow,
    canCreateLnkRequest: canCreateLnkWorkflowRequest,
    canAddLnkResult: canAddLnkWorkflowResult,
  }
}
