import { memo, type ComponentProps } from 'react'
import { DispatcherWorkspaceDialog } from '@/components/dispatcher-workspace-dialog'
import { ReportDialogs } from '@/components/report-dialogs'
import { ReportHeaderActions, type ReportHeaderActionsProps } from '@/components/report-header-actions'
import { ReportMainContent } from '@/components/report-main-content'
import { ReportPageHeader } from '@/components/report-page-header'
import { ReportNotificationToast, type ReportNotificationToastProps } from '@/components/report-notification-toast'
import { ReportSummaryBar, type ReportSummaryBarProps } from '@/components/report-summary-bar'
import { ReportTaskPanels, type ReportTaskPanelsProps } from '@/components/report-task-panels'
import { ReportWorkspace } from '@/components/report-workspace'
import type { DocumentGenerationRequest } from '@/lib/document-generation'
import type { FinalStatusRowsContext } from '@/lib/weld-status'
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
  reportNotificationToastProps: ReportNotificationToastProps
  reportSummaryBarProps: ReportSummaryBarProps
  reportTaskPanelsProps: ReportTaskPanelsProps
  documentGenerationRequest: DocumentGenerationRequest | null
  documentGenerationContextLoading: boolean
  documentGenerationContextError: string
  documentGenerationFinalStatusContext: FinalStatusRowsContext
  welderStamps: ComponentProps<typeof ReportMainContent>['welderStamps']
  welderStampsRegistryProps: ComponentProps<typeof ReportMainContent>['welderStampsRegistryProps']
  weldTableProps: ComponentProps<typeof ReportMainContent>['weldTableProps']
  onAssignPercentageLineMissingControls: ComponentProps<typeof ReportMainContent>['onAssignPercentageLineMissingControls']
  onCancelPercentageLineMissingControls: ComponentProps<typeof ReportMainContent>['onCancelPercentageLineMissingControls']
  onOpenPercentageLineStampRows: ComponentProps<typeof ReportMainContent>['onOpenPercentageLineStampRows']
  onOpenReportRowIds: ComponentProps<typeof ReportMainContent>['onOpenReportRowIds']
  onOpenWeldRowIds: ComponentProps<typeof ReportMainContent>['onOpenWeldRowIds']
  percentageLineNavigationRequest: ComponentProps<typeof ReportMainContent>['percentageLineNavigationRequest']
  onPercentageLineNavigationRequestHandled: ComponentProps<typeof ReportMainContent>['onPercentageLineNavigationRequestHandled']
  onDocumentGenerationRequestHandled: (requestId: number) => void
  onDocumentGenerated: (message: string) => void
  onOpenDocumentRows: ComponentProps<typeof ReportMainContent>['onOpenDocumentRows']
  onOpenDocumentJointHistory: ComponentProps<typeof ReportMainContent>['onOpenDocumentJointHistory']
  documentsPageType: ComponentProps<typeof ReportMainContent>['documentsPageType']
  onDocumentsPageTypeChange: ComponentProps<typeof ReportMainContent>['onDocumentsPageTypeChange']
  documentNavigationRequest: ComponentProps<typeof ReportMainContent>['documentNavigationRequest']
  onDocumentNavigationRequestHandled: ComponentProps<typeof ReportMainContent>['onDocumentNavigationRequestHandled']
  reportChainDialogProps: ComponentProps<typeof ReportDialogs>['chainDialogProps']
  reportWeldEditorProps: ComponentProps<typeof ReportDialogs>['weldEditorProps']
  reportPstoDialogsProps: ComponentProps<typeof ReportDialogs>['pstoDialogsProps']
  reportLnkDialogsProps: ComponentProps<typeof ReportDialogs>['lnkDialogsProps']
  reportFieldEditorProps: ComponentProps<typeof ReportDialogs>['fieldEditorProps']
  reportImportDialogProps: ComponentProps<typeof ReportDialogs>['importDialogProps']
  reportRkExposureDialogProps: ComponentProps<typeof ReportDialogs>['rkExposureDialogProps']
  rootCauseNavigationProps: ComponentProps<typeof ReportDialogs>['rootCauseNavigationProps']
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
  reportNotificationToastProps,
  reportSummaryBarProps,
  reportTaskPanelsProps,
  documentGenerationRequest,
  documentGenerationContextLoading,
  documentGenerationContextError,
  documentGenerationFinalStatusContext,
  welderStamps,
  welderStampsRegistryProps,
  weldTableProps,
  onAssignPercentageLineMissingControls,
  onCancelPercentageLineMissingControls,
  onOpenPercentageLineStampRows,
  onOpenReportRowIds,
  onOpenWeldRowIds,
  percentageLineNavigationRequest,
  onPercentageLineNavigationRequestHandled,
  onDocumentGenerationRequestHandled,
  onDocumentGenerated,
  onOpenDocumentRows,
  onOpenDocumentJointHistory,
  documentsPageType,
  onDocumentsPageTypeChange,
  documentNavigationRequest,
  onDocumentNavigationRequestHandled,
  reportChainDialogProps,
  reportWeldEditorProps,
  reportPstoDialogsProps,
  reportLnkDialogsProps,
  reportFieldEditorProps,
  reportImportDialogProps,
  reportRkExposureDialogProps,
  rootCauseNavigationProps,
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
    percentageLineNavigationRequest,
    onPercentageLineNavigationRequestHandled,
    onOpenDocumentRows,
    onOpenDocumentJointHistory,
    documentsPageType,
    onDocumentsPageTypeChange,
    documentNavigationRequest,
    onDocumentNavigationRequestHandled,
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

      {reportTaskPanelsProps.dispatcherWorkspaceOpen ? (
        <DispatcherWorkspaceDialog
          tasks={reportTaskPanelsProps.repeatedJointTasks}
          groups={reportTaskPanelsProps.repeatedJointTaskGroups}
          totalTaskCount={reportTaskPanelsProps.repeatedJointTaskCount ?? reportTaskPanelsProps.repeatedJointTasks.length}
          computedRevision={reportTaskPanelsProps.computedRevision ?? -1}
          taskFilterOptions={reportTaskPanelsProps.taskFilterOptions ?? []}
          isRefreshing={Boolean(reportTaskPanelsProps.dispatcherTasksRefreshing)}
          hasMoreTasks={Boolean(reportTaskPanelsProps.hasMoreTasks)}
          onLoadMoreTasks={reportTaskPanelsProps.onLoadMoreTasks}
          isTaskBatchLoading={Boolean(reportTaskPanelsProps.isTaskBatchLoading)}
          taskBatchError={reportTaskPanelsProps.taskBatchError}
          onRetryTaskBatch={reportTaskPanelsProps.onRetryTaskBatch}
          onRefreshTasks={reportTaskPanelsProps.onRefreshTasks}
          handlers={reportTaskPanelsProps.handlers}
          onClose={() => reportTaskPanelsProps.onDispatcherWorkspaceOpenChange(false)}
        />
      ) : null}

      <ReportNotificationToast {...reportNotificationToastProps} />

      <ReportDialogs
        chainDialogProps={reportChainDialogProps}
        weldEditorProps={reportWeldEditorProps}
        pstoDialogsProps={reportPstoDialogsProps}
        lnkDialogsProps={reportLnkDialogsProps}
        fieldEditorProps={reportFieldEditorProps}
        importDialogProps={reportImportDialogProps}
        rkExposureDialogProps={reportRkExposureDialogProps}
        rootCauseNavigationProps={rootCauseNavigationProps}
        generationDialogProps={
          documentGenerationRequest
            ? {
                request: documentGenerationRequest,
                finalStatusContext: documentGenerationFinalStatusContext,
                contextLoading: documentGenerationContextLoading,
                contextError: documentGenerationContextError,
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
  | 'percentageLineNavigationRequest'
  | 'onPercentageLineNavigationRequestHandled'
  | 'onOpenDocumentRows'
  | 'onOpenDocumentJointHistory'
  | 'documentsPageType'
  | 'onDocumentsPageTypeChange'
  | 'documentNavigationRequest'
  | 'onDocumentNavigationRequestHandled'
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
  percentageLineNavigationRequest,
  onPercentageLineNavigationRequestHandled,
  onOpenDocumentRows,
  onOpenDocumentJointHistory,
  documentsPageType,
  onDocumentsPageTypeChange,
  documentNavigationRequest,
  onDocumentNavigationRequestHandled,
}: ReportBackgroundProps) {
  const isStandaloneReport =
    activeReport === 'statistics' ||
    activeReport === 'percentageLines' ||
    activeReport === 'documents' ||
    activeReport === 'settings' ||
    activeReport === 'userGuide'
  const isWeldTableReport =
    activeReport === 'weldingJournal' ||
    activeReport === 'heatTreatment' ||
    activeReport === 'lnk'
  const reportTaskPanels = !isStandaloneReport ? <ReportTaskPanels {...reportTaskPanelsProps} /> : null
  return (
    <>
      <ReportPageHeader
        title={activeTitle}
        stickyLeft={stickyLeft}
        summary={!isStandaloneReport ? <ReportSummaryBar {...reportSummaryBarProps} embedded /> : undefined}
      >
        {activeReport !== 'documents' && activeReport !== 'settings' && activeReport !== 'userGuide' ? (
          <ReportHeaderActions {...reportHeaderActionsProps} />
        ) : null}
      </ReportPageHeader>

      {!isWeldTableReport ? reportTaskPanels : null}

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
        percentageLineNavigationRequest={percentageLineNavigationRequest}
        onPercentageLineNavigationRequestHandled={onPercentageLineNavigationRequestHandled}
        onOpenDocumentRows={onOpenDocumentRows}
        onOpenDocumentJointHistory={onOpenDocumentJointHistory}
        documentsPageType={documentsPageType}
        onDocumentsPageTypeChange={onDocumentsPageTypeChange}
        documentNavigationRequest={documentNavigationRequest}
        onDocumentNavigationRequestHandled={onDocumentNavigationRequestHandled}
        reportTaskPanels={isWeldTableReport ? reportTaskPanels : null}
      />
    </>
  )
}
