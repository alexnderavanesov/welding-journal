import type { ReportPstoDialogsProps } from '@/components/report-psto-dialogs'
import { canCreatePstoRequest } from '@/lib/psto-status'
import { canSelectPstoResultRow, isEveryFilteredLnkRequestRowSelected } from '@/lib/report-modal-rows'

type PstoRequestDialogProps = NonNullable<ReportPstoDialogsProps['requestDialogProps']>
type PstoRequestManagerDialogProps = NonNullable<ReportPstoDialogsProps['requestManagerDialogProps']>
type PstoResultDialogProps = NonNullable<ReportPstoDialogsProps['resultDialogProps']>
type PstoResultManagerDialogProps = NonNullable<ReportPstoDialogsProps['resultManagerDialogProps']>
type TvmtWorkflowDialogProps = NonNullable<ReportPstoDialogsProps['tvmtWorkflowDialogProps']>
type PstoRepeatWorkflowDialogProps = NonNullable<ReportPstoDialogsProps['repeatWorkflowDialogProps']>
type PstoLineProgramDialogProps = NonNullable<ReportPstoDialogsProps['lineProgramDialogProps']>

type CreateReportPstoDialogsPropsOptions = {
  requestModalOpen: boolean
  request: Omit<PstoRequestDialogProps, 'areAllAvailableRowsSelected' | 'canCreateRequest'>
  filteredAvailableRequestRows: PstoRequestDialogProps['filteredRows']

  requestManagerOpen: boolean
  requestManager: PstoRequestManagerDialogProps

  resultModalOpen: boolean
  result: Omit<PstoResultDialogProps, 'allFilteredSelectableRowsSelected' | 'canSelectRow'>

  resultManagerOpen: boolean
  resultManager: PstoResultManagerDialogProps

  tvmtWorkflow: TvmtWorkflowDialogProps | null
  repeatWorkflow: PstoRepeatWorkflowDialogProps | null
  lineProgram: PstoLineProgramDialogProps | null
}

export function createReportPstoDialogsProps({
  requestModalOpen,
  request,
  filteredAvailableRequestRows,
  requestManagerOpen,
  requestManager,
  resultModalOpen,
  result,
  resultManagerOpen,
  resultManager,
  tvmtWorkflow,
  repeatWorkflow,
  lineProgram,
}: CreateReportPstoDialogsPropsOptions): ReportPstoDialogsProps {
  return {
    requestDialogProps: requestModalOpen
      ? {
          ...request,
          areAllAvailableRowsSelected: isEveryFilteredLnkRequestRowSelected(
            request.selectedIds,
            filteredAvailableRequestRows,
          ),
          canCreateRequest: canCreatePstoRequest,
        }
      : null,
    requestManagerDialogProps: requestManagerOpen ? requestManager : null,
    resultDialogProps: resultModalOpen
      ? {
          ...result,
          allFilteredSelectableRowsSelected: isEveryFilteredLnkRequestRowSelected(
            result.draft.rowIds,
            result.filteredRows.filter((row) =>
              canSelectPstoResultRow(row, result.draft.requestName, result.draft.requestDate),
            ),
          ),
          canSelectRow: canSelectPstoResultRow,
        }
      : null,
    resultManagerDialogProps: resultManagerOpen ? resultManager : null,
    tvmtWorkflowDialogProps: tvmtWorkflow,
    repeatWorkflowDialogProps: repeatWorkflow,
    lineProgramDialogProps: lineProgram,
  }
}
