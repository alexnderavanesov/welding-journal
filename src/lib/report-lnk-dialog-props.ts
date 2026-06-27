import type { ReportLnkDialogsProps } from '@/components/report-lnk-dialogs'
import { isEveryFilteredLnkRequestRowSelected } from '@/lib/report-modal-rows'

type LnkRequestDialogProps = NonNullable<ReportLnkDialogsProps['requestDialogProps']>
type LnkRequestManagerDialogProps = NonNullable<ReportLnkDialogsProps['requestManagerDialogProps']>
type LnkResultDialogProps = NonNullable<ReportLnkDialogsProps['resultDialogProps']>
type LnkResultManagerDialogProps = NonNullable<ReportLnkDialogsProps['resultManagerDialogProps']>
type LnkOfficialityDialogProps = NonNullable<ReportLnkDialogsProps['officialityDialogProps']>
type LnkResultPreviewDialogProps = NonNullable<ReportLnkDialogsProps['resultPreviewDialogProps']>

type CreateReportLnkDialogsPropsOptions = {
  requestModalOpen: boolean
  request: LnkRequestDialogProps

  requestManagerOpen: boolean
  requestManager: LnkRequestManagerDialogProps

  resultManagerOpen: boolean
  resultManager: LnkResultManagerDialogProps

  officialityModalOpen: boolean
  officiality: LnkOfficialityDialogProps

  resultModalOpen: boolean
  result: Omit<LnkResultDialogProps, 'areAllFilteredRowsSelected'>
  selectableResultRows: LnkResultDialogProps['visibleRows']

  resultPreviewOpen: boolean
  resultPreview: LnkResultPreviewDialogProps
}

export function createReportLnkDialogsProps({
  requestModalOpen,
  request,
  requestManagerOpen,
  requestManager,
  resultManagerOpen,
  resultManager,
  officialityModalOpen,
  officiality,
  resultModalOpen,
  result,
  selectableResultRows,
  resultPreviewOpen,
  resultPreview,
}: CreateReportLnkDialogsPropsOptions): ReportLnkDialogsProps {
  return {
    requestDialogProps: requestModalOpen ? request : null,
    requestManagerDialogProps: requestManagerOpen ? requestManager : null,
    resultManagerDialogProps: resultManagerOpen ? resultManager : null,
    officialityDialogProps: officialityModalOpen ? officiality : null,
    resultDialogProps: resultModalOpen
      ? {
          ...result,
          areAllFilteredRowsSelected: isEveryFilteredLnkRequestRowSelected(result.draft.rowIds, selectableResultRows),
        }
      : null,
    resultPreviewDialogProps: resultPreviewOpen ? resultPreview : null,
  }
}
