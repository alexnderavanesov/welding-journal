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
import { PrintableReportPreview } from '@/components/printable-report-preview'
import { Button } from './ui/button'

type HomePageViewProps = {
  coilRestorationDialogProps?: ComponentProps<typeof CoilRestorationDialog> | null
  coilCorrectionReturnProps?: { onReturn: () => void; onDismiss: () => void } | null
  chainActualityDialogProps?: ComponentProps<typeof ChainActualityDialog> | null
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
  coilRestorationDialogProps,
  coilCorrectionReturnProps,
  chainActualityDialogProps,
  reportPreviewProps,
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
      {coilRestorationDialogProps ? <Suspense fallback={null}><CoilRestorationDialog key={coilRestorationDialogProps.rootId} {...coilRestorationDialogProps} /></Suspense> : null}
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
        fluid={activeReport === 'percentageLines'}
        summary={!isStandaloneReport ? <ReportSummaryBar {...reportSummaryBarProps} embedded /> : undefined}
      >
        {activeReport === 'percentageLines' ? <div data-line-program-report-actions /> : null}
        {activeReport !== 'percentageLines' && activeReport !== 'documents' && activeReport !== 'settings' && activeReport !== 'userGuide' ? (
          <ReportHeaderActions {...reportHeaderActionsProps} />
        ) : null}
      </ReportPageHeader>

      {!isWeldTableReport ? reportTaskPanels : null}

      <ReportMainContent
        activeReport={activeReport}
        welderStamps={welderStamps}
        welderStampsRegistryProps={welderStampsRegistryProps}
        weldTableProps={weldTableProps}
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
