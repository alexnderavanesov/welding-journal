import { isAgGridWeldReport } from '@/lib/weld-report-grid-profile'
import { lazy, Suspense, memo, type ComponentProps } from 'react'
const CoilRestorationDialog = lazy(() => import('./coil-restoration-dialog').then(module => ({ default: module.CoilRestorationDialog })))
const ChainActualityDialog = lazy(() => import('./chain-actuality-dialog').then(module => ({ default: module.ChainActualityDialog })))
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
import { HistoryDocumentPreview } from '@/components/history-document-preview'
import { PrintableReportPreview } from '@/components/printable-report-preview'
import { Button } from './ui/button'

type HomePageViewProps = {
  onCancelEarlyCoil?: (sourceId: number) => void
  coilRestorationDialogProps?: ComponentProps<typeof CoilRestorationDialog> | null
  coilCorrectionReturnProps?: { onReturn: () => void; onDismiss: () => void } | null
  chainActualityDialogProps?: ComponentProps<typeof ChainActualityDialog> | null
  documentPreviewProps?: ComponentProps<typeof HistoryDocumentPreview> | null
  reportPreviewProps: ComponentProps<typeof PrintableReportPreview> | null
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
  reportExportFieldsRef: ComponentProps<typeof ReportMainContent>['reportExportFieldsRef']
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
  onCancelEarlyCoil,
  coilRestorationDialogProps,
  coilCorrectionReturnProps,
  chainActualityDialogProps,
  reportPreviewProps,
  documentPreviewProps,
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
  reportExportFieldsRef,
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
    onCancelEarlyCoil,
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
    reportExportFieldsRef,
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
      {coilCorrectionReturnProps && !freezeReportBackground ? <section aria-label="Продолжение исправления катушки" className="flex w-fit items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
        <Button variant="outline" size="sm" onClick={coilCorrectionReturnProps.onReturn}>Вернуться к исправлению катушки</Button>
        <span>Возврат к исходной цепочке без сброса фильтров.</span>
        <Button variant="ghost" size="sm" onClick={coilCorrectionReturnProps.onDismiss}>Скрыть подсказку</Button>
      </section> : null}
      <MemoizedReportBackground {...reportBackgroundProps} />

      {reportTaskPanelsProps.dispatcherWorkspaceOpen ? (
        <DispatcherWorkspaceDialog
          journalAppearance={isAgGridWeldReport(reportTaskPanelsProps.activeReport)}
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

      {!coilRestorationDialogProps ? <ReportNotificationToast {...reportNotificationToastProps} /> : null}
      {coilRestorationDialogProps ? <Suspense fallback={null}><CoilRestorationDialog key={`${coilRestorationDialogProps.rootId}:${Boolean(coilRestorationDialogProps.earlyDecision)}`} {...coilRestorationDialogProps} /></Suspense> : null}
      {chainActualityDialogProps ? <Suspense fallback={null}><ChainActualityDialog key={`${chainActualityDialogProps.rowId}:${chainActualityDialogProps.active}`} {...chainActualityDialogProps} /></Suspense> : null}
      {reportPreviewProps ? <PrintableReportPreview {...reportPreviewProps} /> : null}

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
      {documentPreviewProps ? <HistoryDocumentPreview {...documentPreviewProps} /> : null}
    </ReportWorkspace>
  )
}

type ReportBackgroundProps = Pick<
  HomePageViewProps,
  | 'activeReport'
  | 'onCancelEarlyCoil'
  | 'activeTitle'
  | 'registerMinWidth'
  | 'stickyLeft'
  | 'reportHeaderActionsProps'
  | 'reportSummaryBarProps'
  | 'reportTaskPanelsProps'
  | 'welderStamps'
  | 'welderStampsRegistryProps'
  | 'weldTableProps'
  | 'reportExportFieldsRef'
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
  onCancelEarlyCoil,
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
  reportExportFieldsRef,
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
    isAgGridWeldReport(activeReport) ||
    activeReport === 'lnk'
  const reportTaskPanels = !isStandaloneReport ? <ReportTaskPanels {...reportTaskPanelsProps} /> : null
  const reportHeader = (
      <ReportPageHeader
        title={activeTitle}
        stickyLeft={stickyLeft}
        fluid={activeReport === 'percentageLines' || isAgGridWeldReport(activeReport)}
        summary={!isStandaloneReport && !isAgGridWeldReport(activeReport) ? <ReportSummaryBar {...reportSummaryBarProps} embedded /> : undefined}
      >
        {activeReport === 'percentageLines' ? <div data-line-program-report-actions /> : null}
        {activeReport !== 'percentageLines' && activeReport !== 'documents' && activeReport !== 'settings' && activeReport !== 'userGuide' ? (
          <ReportHeaderActions {...reportHeaderActionsProps} />
        ) : null}
      </ReportPageHeader>
  )

  return (
    <>
      {activeReport !== 'welderStamps' ? reportHeader : null}
      {!isWeldTableReport && activeReport !== 'welderStamps' ? reportTaskPanels : null}

      <ReportMainContent
        onCancelEarlyCoil={onCancelEarlyCoil}
        activeReport={activeReport}
        welderStamps={welderStamps}
        welderStampsRegistryProps={welderStampsRegistryProps}
        welderStampsHeader={activeReport === 'welderStamps' ? reportHeader : undefined}
        weldTableProps={weldTableProps}
        reportExportFieldsRef={reportExportFieldsRef}
        journalSummary={isAgGridWeldReport(activeReport) ? beforeSearch => <ReportSummaryBar {...reportSummaryBarProps} embedded beforeSearch={beforeSearch} /> : undefined}
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
        reportTaskPanels={isWeldTableReport || activeReport === 'welderStamps' ? reportTaskPanels : null}
      />
    </>
  )
}
