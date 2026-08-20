import { memo, type ComponentProps } from 'react'
import { ReportDialogs } from '@/components/report-dialogs'
import { ReportHeaderActions, type ReportHeaderActionsProps } from '@/components/report-header-actions'
import { ReportMainContent } from '@/components/report-main-content'
import { ReportPageHeader } from '@/components/report-page-header'
import { ReportSummaryBar, type ReportSummaryBarProps } from '@/components/report-summary-bar'
import { ReportTaskPanels, type ReportTaskPanelsProps } from '@/components/report-task-panels'
import { ReportWorkspace } from '@/components/report-workspace'
import type { DocumentGenerationRequest } from '@/lib/document-generation'
import type { WeldRow } from '@/lib/dispatcher-types'
import { useFrozenValue } from '@/lib/use-frozen-value'

type HomePageViewProps = {
  activeReport: ComponentProps<typeof ReportWorkspace>['activeReport']
  activeTitle: string
  freezeReportBackground: boolean
  navCollapsed: boolean
  registerMinWidth: number
  stickyLeft: number
  onNavCollapsedChange: ComponentProps<typeof ReportWorkspace>['onNavCollapsedChange']
  onReportChange: ComponentProps<typeof ReportWorkspace>['onReportChange']
  reportHeaderActionsProps: ReportHeaderActionsProps
  reportSummaryBarProps: ReportSummaryBarProps
  reportTaskPanelsProps: ReportTaskPanelsProps
  documentGenerationRequest: DocumentGenerationRequest | null
  documentGenerationContextLoading: boolean
  statisticsRows: WeldRow[]
  welderStamps: ComponentProps<typeof ReportMainContent>['welderStamps']
  welderStampsRegistryProps: ComponentProps<typeof ReportMainContent>['welderStampsRegistryProps']
  weldTableProps: ComponentProps<typeof ReportMainContent>['weldTableProps']
  onAssignPercentageLineMissingControls: ComponentProps<typeof ReportMainContent>['onAssignPercentageLineMissingControls']
  onCancelPercentageLineMissingControls: ComponentProps<typeof ReportMainContent>['onCancelPercentageLineMissingControls']
  onOpenPercentageLineStampRows: ComponentProps<typeof ReportMainContent>['onOpenPercentageLineStampRows']
  onOpenReportRowIds: ComponentProps<typeof ReportMainContent>['onOpenReportRowIds']
  onOpenWeldRowIds: ComponentProps<typeof ReportMainContent>['onOpenWeldRowIds']
  onDocumentGenerationRequestHandled: (requestId: number) => void
  onDocumentGenerated: (message: string) => void
  onOpenDocumentRows: ComponentProps<typeof ReportMainContent>['onOpenDocumentRows']
  systemDocumentNavigationRequest: ComponentProps<typeof ReportMainContent>['systemDocumentNavigationRequest']
  onSystemDocumentNavigationRequestHandled: ComponentProps<typeof ReportMainContent>['onSystemDocumentNavigationRequestHandled']
  reportChainDialogProps: ComponentProps<typeof ReportDialogs>['chainDialogProps']
  reportWeldEditorProps: ComponentProps<typeof ReportDialogs>['weldEditorProps']
  reportPstoDialogsProps: ComponentProps<typeof ReportDialogs>['pstoDialogsProps']
  reportLnkDialogsProps: ComponentProps<typeof ReportDialogs>['lnkDialogsProps']
  reportFieldEditorProps: ComponentProps<typeof ReportDialogs>['fieldEditorProps']
  reportImportDialogProps: ComponentProps<typeof ReportDialogs>['importDialogProps']
  reportRkExposureDialogProps: ComponentProps<typeof ReportDialogs>['rkExposureDialogProps']
}

export function HomePageView({
  activeReport,
  activeTitle,
  freezeReportBackground,
  navCollapsed,
  registerMinWidth,
  stickyLeft,
  onNavCollapsedChange,
  onReportChange,
  reportHeaderActionsProps,
  reportSummaryBarProps,
  reportTaskPanelsProps,
  documentGenerationRequest,
  documentGenerationContextLoading,
  statisticsRows,
  welderStamps,
  welderStampsRegistryProps,
  weldTableProps,
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  onOpenPercentageLineStampRows,
  onOpenReportRowIds,
  onOpenWeldRowIds,
  onDocumentGenerationRequestHandled,
  onDocumentGenerated,
  onOpenDocumentRows,
  systemDocumentNavigationRequest,
  onSystemDocumentNavigationRequestHandled,
  reportChainDialogProps,
  reportWeldEditorProps,
  reportPstoDialogsProps,
  reportLnkDialogsProps,
  reportFieldEditorProps,
  reportImportDialogProps,
  reportRkExposureDialogProps,
}: HomePageViewProps) {
  const reportBackgroundProps = useFrozenValue<ReportBackgroundProps>({
    activeReport,
    activeTitle,
    registerMinWidth,
    stickyLeft,
    reportHeaderActionsProps,
    reportSummaryBarProps,
    reportTaskPanelsProps,
    welderStamps,
    welderStampsRegistryProps,
    weldTableProps,
    onAssignPercentageLineMissingControls,
    onCancelPercentageLineMissingControls,
    onOpenPercentageLineStampRows,
    onOpenReportRowIds,
    onOpenWeldRowIds,
    onOpenDocumentRows,
    systemDocumentNavigationRequest,
    onSystemDocumentNavigationRequestHandled,
  }, freezeReportBackground)

  return (
    <ReportWorkspace
      activeReport={activeReport}
      navCollapsed={navCollapsed}
      registerMinWidth={registerMinWidth}
      onNavCollapsedChange={onNavCollapsedChange}
      onReportChange={onReportChange}
    >
      <MemoizedReportBackground {...reportBackgroundProps} />

      <ReportDialogs
        chainDialogProps={reportChainDialogProps}
        weldEditorProps={reportWeldEditorProps}
        pstoDialogsProps={reportPstoDialogsProps}
        lnkDialogsProps={reportLnkDialogsProps}
        fieldEditorProps={reportFieldEditorProps}
        importDialogProps={reportImportDialogProps}
        rkExposureDialogProps={reportRkExposureDialogProps}
        generationDialogProps={
          documentGenerationRequest
            ? {
                request: documentGenerationRequest,
                contextRows: statisticsRows,
                contextLoading: documentGenerationContextLoading,
                onClose: () => onDocumentGenerationRequestHandled(documentGenerationRequest.id),
                onGenerated: onDocumentGenerated,
              }
            : null
        }
      />
    </ReportWorkspace>
  )
}

type ReportBackgroundProps = Pick<
  HomePageViewProps,
  | 'activeReport'
  | 'activeTitle'
  | 'registerMinWidth'
  | 'stickyLeft'
  | 'reportHeaderActionsProps'
  | 'reportSummaryBarProps'
  | 'reportTaskPanelsProps'
  | 'welderStamps'
  | 'welderStampsRegistryProps'
  | 'weldTableProps'
  | 'onAssignPercentageLineMissingControls'
  | 'onCancelPercentageLineMissingControls'
  | 'onOpenPercentageLineStampRows'
  | 'onOpenReportRowIds'
  | 'onOpenWeldRowIds'
  | 'onOpenDocumentRows'
  | 'systemDocumentNavigationRequest'
  | 'onSystemDocumentNavigationRequestHandled'
>

const MemoizedReportBackground = memo(ReportBackground)

function ReportBackground({
  activeReport,
  activeTitle,
  registerMinWidth,
  stickyLeft,
  reportHeaderActionsProps,
  reportSummaryBarProps,
  reportTaskPanelsProps,
  welderStamps,
  welderStampsRegistryProps,
  weldTableProps,
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  onOpenPercentageLineStampRows,
  onOpenReportRowIds,
  onOpenWeldRowIds,
  onOpenDocumentRows,
  systemDocumentNavigationRequest,
  onSystemDocumentNavigationRequestHandled,
}: ReportBackgroundProps) {
  const isFluidReport =
    activeReport === 'statistics' ||
    activeReport === 'percentageLines' ||
    activeReport === 'welderStamps' ||
    activeReport === 'documents' ||
    activeReport === 'settings' ||
    activeReport === 'userGuide'
  const isStandaloneReport =
    activeReport === 'statistics' ||
    activeReport === 'percentageLines' ||
    activeReport === 'documents' ||
    activeReport === 'settings' ||
    activeReport === 'userGuide'
  const pageMinWidth = isFluidReport ? 0 : registerMinWidth

  return (
    <>
      <ReportPageHeader title={activeTitle} stickyLeft={stickyLeft} minWidth={pageMinWidth}>
        {activeReport !== 'documents' && activeReport !== 'settings' && activeReport !== 'userGuide' ? (
          <ReportHeaderActions {...reportHeaderActionsProps} />
        ) : null}
      </ReportPageHeader>

      {!isStandaloneReport ? <ReportSummaryBar {...reportSummaryBarProps} minWidth={pageMinWidth} /> : null}

      {!isStandaloneReport ? <ReportTaskPanels {...reportTaskPanelsProps} /> : null}

      <ReportMainContent
        activeReport={activeReport}
        welderStamps={welderStamps}
        welderStampsRegistryProps={welderStampsRegistryProps}
        weldTableProps={weldTableProps}
        onAssignPercentageLineMissingControls={onAssignPercentageLineMissingControls}
        onCancelPercentageLineMissingControls={onCancelPercentageLineMissingControls}
        onOpenPercentageLineStampRows={onOpenPercentageLineStampRows}
        onOpenReportRowIds={onOpenReportRowIds}
        onOpenWeldRowIds={onOpenWeldRowIds}
        onOpenDocumentRows={onOpenDocumentRows}
        systemDocumentNavigationRequest={systemDocumentNavigationRequest}
        onSystemDocumentNavigationRequestHandled={onSystemDocumentNavigationRequestHandled}
      />
    </>
  )
}
