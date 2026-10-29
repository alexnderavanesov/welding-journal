import { ReportDialogBoundary } from './report-dialog-boundary'
import { lazy, Suspense } from 'react'
import type { ReportChainDialogProps } from '@/components/report-chain-dialog'
import type { ReportFieldEditorProps } from '@/components/report-field-editor'
import type { ReportLnkDialogsProps } from '@/components/report-lnk-dialogs'
import type { ReportPstoDialogsProps } from '@/components/report-psto-dialogs'
import type { ReportImportDialogProps } from '@/components/report-import-dialog'
import type { ReportWeldEditorProps } from '@/components/report-weld-editor'
import type { WeldingJournalGenerationDialogProps } from '@/components/welding-journal-generation-dialog'
import type { RkExposureEditDialogProps } from '@/components/rk-exposure-edit-dialog'
import { hasOpenReportDialogProps } from '@/lib/report-modal-open-state'
import { tracePstoProgramModule } from '@/lib/psto-program-diagnostics'
import { PstoProgramDiagnosticBoundary, PstoProgramLoading } from './psto-program-diagnostic-boundary'
import {
  WorkflowRootCauseNavigation,
  type WorkflowRootCauseNavigationProps,
} from '@/components/workflow-root-cause-navigation'

const ReportChainDialog = lazy(() => import('@/components/report-chain-dialog').then((module) => ({ default: module.ReportChainDialog })))
const ReportWeldEditor = lazy(() => import('@/components/report-weld-editor').then((module) => ({ default: module.ReportWeldEditor })))
const ReportFieldEditor = lazy(() => import('@/components/report-field-editor').then((module) => ({ default: module.ReportFieldEditor })))
const ReportPstoDialogs = lazy(() => tracePstoProgramModule('group', () => import('@/components/report-psto-dialogs')).then((module) => ({ default: module.ReportPstoDialogs })))
const ReportLnkDialogs = lazy(() => import('@/components/report-lnk-dialogs').then((module) => ({ default: module.ReportLnkDialogs })))
const ReportImportDialog = lazy(() =>
  import('@/components/report-import-dialog').then((module) => ({ default: module.ReportImportDialog })),
)
const WeldingJournalGenerationDialog = lazy(() =>
  import('@/components/welding-journal-generation-dialog').then((module) => ({ default: module.WeldingJournalGenerationDialog })),
)
const RkExposureEditDialog = lazy(() =>
  import('@/components/rk-exposure-edit-dialog').then((module) => ({ default: module.RkExposureEditDialog })),
)

type ReportDialogsProps = {
  chainDialogProps: ReportChainDialogProps
  weldEditorProps: ReportWeldEditorProps
  pstoDialogsProps: ReportPstoDialogsProps
  lnkDialogsProps: ReportLnkDialogsProps
  fieldEditorProps: ReportFieldEditorProps
  importDialogProps: ReportImportDialogProps
  generationDialogProps?: WeldingJournalGenerationDialogProps | null
  rkExposureDialogProps?: RkExposureEditDialogProps | null
  rootCauseNavigationProps?: WorkflowRootCauseNavigationProps | null
}

export function ReportDialogs({
  chainDialogProps,
  weldEditorProps,
  pstoDialogsProps,
  lnkDialogsProps,
  fieldEditorProps,
  importDialogProps,
  generationDialogProps,
  rkExposureDialogProps,
  rootCauseNavigationProps,
}: ReportDialogsProps) {
  return (
    <>
      {chainDialogProps.dialogProps ? (
        <ReportDialogBoundary onClose={chainDialogProps.dialogProps.onClose}>
          <Suspense fallback={null}>
            <ReportChainDialog {...chainDialogProps} />
          </Suspense>
        </ReportDialogBoundary>
      ) : null}
      {weldEditorProps.formKey && weldEditorProps.formProps ? (
        <ReportDialogBoundary onClose={weldEditorProps.formProps.onCancel}>
          <Suspense fallback={null}>
            <ReportWeldEditor {...weldEditorProps} />
          </Suspense>
        </ReportDialogBoundary>
      ) : null}
      {hasOpenReportDialogProps(pstoDialogsProps) ? (
        <ReportDialogBoundary onClose={() => { Object.values(pstoDialogsProps).forEach(dialog => dialog?.onClose()) }}>
          <PstoProgramDiagnosticBoundary open={!!pstoDialogsProps.lineProgramDialogProps?.open} onClose={() => pstoDialogsProps.lineProgramDialogProps?.onClose()}>
            <Suspense fallback={<PstoProgramLoading open={!!pstoDialogsProps.lineProgramDialogProps?.open} onClose={() => pstoDialogsProps.lineProgramDialogProps?.onClose()} />}>
              <ReportPstoDialogs {...pstoDialogsProps} />
            </Suspense>
          </PstoProgramDiagnosticBoundary>
        </ReportDialogBoundary>
      ) : null}
      {hasOpenReportDialogProps(lnkDialogsProps) ? (
        <ReportDialogBoundary onClose={() => { Object.values(lnkDialogsProps).forEach(dialog => dialog?.onClose()) }}>
          <Suspense fallback={null}>
            <ReportLnkDialogs {...lnkDialogsProps} />
          </Suspense>
        </ReportDialogBoundary>
      ) : null}
      {fieldEditorProps.dialogProps ? (
        <ReportDialogBoundary onClose={fieldEditorProps.dialogProps.onClose}>
          <Suspense fallback={null}>
            <ReportFieldEditor {...fieldEditorProps} />
          </Suspense>
        </ReportDialogBoundary>
      ) : null}
      {importDialogProps.open ? (
        <ReportDialogBoundary onClose={importDialogProps.onClose}>
          <Suspense fallback={null}>
            <ReportImportDialog {...importDialogProps} />
          </Suspense>
        </ReportDialogBoundary>
      ) : null}
      {generationDialogProps ? (
        <ReportDialogBoundary onClose={generationDialogProps.onClose}>
          <Suspense fallback={null}>
            <WeldingJournalGenerationDialog {...generationDialogProps} />
          </Suspense>
        </ReportDialogBoundary>
      ) : null}
      {rkExposureDialogProps ? (
        <ReportDialogBoundary onClose={rkExposureDialogProps.onClose}>
          <Suspense fallback={null}>
            <RkExposureEditDialog {...rkExposureDialogProps} />
          </Suspense>
        </ReportDialogBoundary>
      ) : null}
      {rootCauseNavigationProps ? <WorkflowRootCauseNavigation {...rootCauseNavigationProps} /> : null}
    </>
  )
}
