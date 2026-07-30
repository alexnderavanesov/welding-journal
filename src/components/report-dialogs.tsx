import { lazy, Suspense } from 'react'
import type { ReportChainDialogProps } from '@/components/report-chain-dialog'
import type { ReportFieldEditorProps } from '@/components/report-field-editor'
import type { ReportLnkDialogsProps } from '@/components/report-lnk-dialogs'
import type { ReportPstoDialogsProps } from '@/components/report-psto-dialogs'
import type { ReportImportDialogProps } from '@/components/report-import-dialog'
import type { ReportWeldEditorProps } from '@/components/report-weld-editor'

const ReportChainDialog = lazy(() => import('@/components/report-chain-dialog').then((module) => ({ default: module.ReportChainDialog })))
const ReportWeldEditor = lazy(() => import('@/components/report-weld-editor').then((module) => ({ default: module.ReportWeldEditor })))
const ReportFieldEditor = lazy(() => import('@/components/report-field-editor').then((module) => ({ default: module.ReportFieldEditor })))
const ReportPstoDialogs = lazy(() => import('@/components/report-psto-dialogs').then((module) => ({ default: module.ReportPstoDialogs })))
const ReportLnkDialogs = lazy(() => import('@/components/report-lnk-dialogs').then((module) => ({ default: module.ReportLnkDialogs })))
const ReportImportDialog = lazy(() =>
  import('@/components/report-import-dialog').then((module) => ({ default: module.ReportImportDialog })),
)

type ReportDialogsProps = {
  chainDialogProps: ReportChainDialogProps
  weldEditorProps: ReportWeldEditorProps
  pstoDialogsProps: ReportPstoDialogsProps
  lnkDialogsProps: ReportLnkDialogsProps
  fieldEditorProps: ReportFieldEditorProps
  importDialogProps: ReportImportDialogProps
}

export function ReportDialogs({
  chainDialogProps,
  weldEditorProps,
  pstoDialogsProps,
  lnkDialogsProps,
  fieldEditorProps,
  importDialogProps,
}: ReportDialogsProps) {
  return (
    <>
      {chainDialogProps.dialogProps ? (
        <Suspense fallback={null}>
          <ReportChainDialog {...chainDialogProps} />
        </Suspense>
      ) : null}
      {weldEditorProps.formKey && weldEditorProps.formProps ? (
        <Suspense fallback={null}>
          <ReportWeldEditor {...weldEditorProps} />
        </Suspense>
      ) : null}
      {pstoDialogsProps.requestDialogProps ||
      pstoDialogsProps.requestManagerDialogProps ||
      pstoDialogsProps.resultDialogProps ||
      pstoDialogsProps.resultManagerDialogProps ? (
        <Suspense fallback={null}>
          <ReportPstoDialogs {...pstoDialogsProps} />
        </Suspense>
      ) : null}
      {lnkDialogsProps.requestDialogProps ||
      lnkDialogsProps.requestManagerDialogProps ||
      lnkDialogsProps.resultManagerDialogProps ||
      lnkDialogsProps.officialityDialogProps ||
      lnkDialogsProps.duplicateControlDialogProps ||
      lnkDialogsProps.resultDialogProps ||
      lnkDialogsProps.resultPreviewDialogProps ? (
        <Suspense fallback={null}>
          <ReportLnkDialogs {...lnkDialogsProps} />
        </Suspense>
      ) : null}
      {fieldEditorProps.dialogProps ? (
        <Suspense fallback={null}>
          <ReportFieldEditor {...fieldEditorProps} />
        </Suspense>
      ) : null}
      {importDialogProps.open ? (
        <Suspense fallback={null}>
          <ReportImportDialog {...importDialogProps} />
        </Suspense>
      ) : null}
    </>
  )
}
