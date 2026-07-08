import type { ComponentProps } from 'react'
import { ReportDialogs } from '@/components/report-dialogs'
import { ReportHeaderActions, type ReportHeaderActionsProps } from '@/components/report-header-actions'
import { ReportMainContent } from '@/components/report-main-content'
import { ReportPageHeader } from '@/components/report-page-header'
import { ReportSummaryBar, type ReportSummaryBarProps } from '@/components/report-summary-bar'
import { ReportTaskPanels, type ReportTaskPanelsProps } from '@/components/report-task-panels'
import { ReportWorkspace } from '@/components/report-workspace'

type HomePageViewProps = {
  activeReport: ComponentProps<typeof ReportWorkspace>['activeReport']
  activeTitle: string
  navCollapsed: boolean
  registerMinWidth: number
  stickyLeft: number
  onNavCollapsedChange: ComponentProps<typeof ReportWorkspace>['onNavCollapsedChange']
  onReportChange: ComponentProps<typeof ReportWorkspace>['onReportChange']
  reportHeaderActionsProps: ReportHeaderActionsProps
  reportSummaryBarProps: ReportSummaryBarProps
  reportTaskPanelsProps: ReportTaskPanelsProps
  statisticsRows: ComponentProps<typeof ReportMainContent>['statisticsRows']
  welderStamps: ComponentProps<typeof ReportMainContent>['welderStamps']
  welderStampsRegistryProps: ComponentProps<typeof ReportMainContent>['welderStampsRegistryProps']
  weldTableProps: ComponentProps<typeof ReportMainContent>['weldTableProps']
  onCancelPercentageLineMissingControls: ComponentProps<typeof ReportMainContent>['onCancelPercentageLineMissingControls']
  onOpenPercentageLineStampRows: ComponentProps<typeof ReportMainContent>['onOpenPercentageLineStampRows']
  onOpenWeldRowIds: ComponentProps<typeof ReportMainContent>['onOpenWeldRowIds']
  reportChainDialogProps: ComponentProps<typeof ReportDialogs>['chainDialogProps']
  reportWeldEditorProps: ComponentProps<typeof ReportDialogs>['weldEditorProps']
  reportPstoDialogsProps: ComponentProps<typeof ReportDialogs>['pstoDialogsProps']
  reportLnkDialogsProps: ComponentProps<typeof ReportDialogs>['lnkDialogsProps']
  reportFieldEditorProps: ComponentProps<typeof ReportDialogs>['fieldEditorProps']
  reportImportDialogProps: ComponentProps<typeof ReportDialogs>['importDialogProps']
}

export function HomePageView({
  activeReport,
  activeTitle,
  navCollapsed,
  registerMinWidth,
  stickyLeft,
  onNavCollapsedChange,
  onReportChange,
  reportHeaderActionsProps,
  reportSummaryBarProps,
  reportTaskPanelsProps,
  statisticsRows,
  welderStamps,
  welderStampsRegistryProps,
  weldTableProps,
  onCancelPercentageLineMissingControls,
  onOpenPercentageLineStampRows,
  onOpenWeldRowIds,
  reportChainDialogProps,
  reportWeldEditorProps,
  reportPstoDialogsProps,
  reportLnkDialogsProps,
  reportFieldEditorProps,
  reportImportDialogProps,
}: HomePageViewProps) {
  const isFluidReport = activeReport === 'statistics' || activeReport === 'percentageLines' || activeReport === 'welderStamps'
  const pageMinWidth = isFluidReport ? 0 : registerMinWidth

  return (
    <ReportWorkspace
      activeReport={activeReport}
      navCollapsed={navCollapsed}
      registerMinWidth={registerMinWidth}
      onNavCollapsedChange={onNavCollapsedChange}
      onReportChange={onReportChange}
    >
      <ReportPageHeader title={activeTitle} stickyLeft={stickyLeft} minWidth={pageMinWidth}>
        <ReportHeaderActions {...reportHeaderActionsProps} />
      </ReportPageHeader>

      {activeReport !== 'statistics' && activeReport !== 'percentageLines' ? (
        <ReportSummaryBar {...reportSummaryBarProps} minWidth={pageMinWidth} />
      ) : null}

      {activeReport !== 'statistics' && activeReport !== 'percentageLines' ? <ReportTaskPanels {...reportTaskPanelsProps} /> : null}

      <ReportMainContent
        activeReport={activeReport}
        statisticsRows={statisticsRows}
        welderStamps={welderStamps}
        welderStampsRegistryProps={welderStampsRegistryProps}
        weldTableProps={weldTableProps}
        onCancelPercentageLineMissingControls={onCancelPercentageLineMissingControls}
        onOpenPercentageLineStampRows={onOpenPercentageLineStampRows}
        onOpenWeldRowIds={onOpenWeldRowIds}
      />

      <ReportDialogs
        chainDialogProps={reportChainDialogProps}
        weldEditorProps={reportWeldEditorProps}
        pstoDialogsProps={reportPstoDialogsProps}
        lnkDialogsProps={reportLnkDialogsProps}
        fieldEditorProps={reportFieldEditorProps}
        importDialogProps={reportImportDialogProps}
      />
    </ReportWorkspace>
  )
}
