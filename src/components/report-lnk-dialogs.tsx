import { lazy, Suspense } from 'react'
import type { DuplicateControlDialogProps } from '@/components/duplicate-control-dialog'
import type { LnkOfficialityDialogProps } from '@/components/lnk-officiality-dialog'
import type { LnkRequestDialogProps } from '@/components/lnk-request-dialog'
import type { LnkRequestManagerDialogProps } from '@/components/lnk-request-manager-dialog'
import type { LnkResultDialogProps } from '@/components/lnk-result-dialog'
import type { LnkResultManagerDialogProps } from '@/components/lnk-result-manager-dialog'
import type { PreHeatTreatmentLnkWorkflowDialogProps } from '@/components/pre-heat-treatment-lnk-workflow-dialog'
import type { PreHeatTreatmentResultManagerDialogProps } from '@/components/pre-heat-treatment-result-manager-dialog'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'

const DuplicateControlDialog = lazy(() => import('@/components/duplicate-control-dialog').then((module) => ({ default: module.DuplicateControlDialog })))
const LnkOfficialityDialog = lazy(() => import('@/components/lnk-officiality-dialog').then((module) => ({ default: module.LnkOfficialityDialog })))
const LnkRequestDialog = lazy(() => import('@/components/lnk-request-dialog').then((module) => ({ default: module.LnkRequestDialog })))
const LnkRequestManagerDialog = lazy(() => import('@/components/lnk-request-manager-dialog').then((module) => ({ default: module.LnkRequestManagerDialog })))
const LnkResultDialog = lazy(() => import('@/components/lnk-result-dialog').then((module) => ({ default: module.LnkResultDialog })))
const LnkResultManagerDialog = lazy(() => import('@/components/lnk-result-manager-dialog').then((module) => ({ default: module.LnkResultManagerDialog })))
const PreHeatTreatmentLnkWorkflowDialog = lazy(() => import('@/components/pre-heat-treatment-lnk-workflow-dialog').then((module) => ({ default: module.PreHeatTreatmentLnkWorkflowDialog })))
const PreHeatTreatmentResultManagerDialog = lazy(() => import('@/components/pre-heat-treatment-result-manager-dialog').then((module) => ({ default: module.PreHeatTreatmentResultManagerDialog })))

export type ReportLnkDialogsProps = {
  requestDialogProps: LnkRequestDialogProps | null
  requestManagerDialogProps: LnkRequestManagerDialogProps | null
  resultManagerDialogProps: LnkResultManagerDialogProps | null
  officialityDialogProps: LnkOfficialityDialogProps | null
  duplicateControlDialogProps: DuplicateControlDialogProps | null
  resultDialogProps: LnkResultDialogProps | null
  preHeatTreatmentWorkflowDialogProps: PreHeatTreatmentLnkWorkflowDialogProps | null
  preHeatTreatmentResultManagerDialogProps: PreHeatTreatmentResultManagerDialogProps | null
}

export function ReportLnkDialogs({
  requestDialogProps,
  requestManagerDialogProps,
  resultManagerDialogProps,
  officialityDialogProps,
  duplicateControlDialogProps,
  resultDialogProps,
  preHeatTreatmentWorkflowDialogProps,
  preHeatTreatmentResultManagerDialogProps,
}: ReportLnkDialogsProps) {
  const managerDialog = requestManagerDialogProps ? (
    <LnkRequestManagerDialog {...requestManagerDialogProps} embedded />
  ) : resultManagerDialogProps ? (
    <LnkResultManagerDialog {...resultManagerDialogProps} embedded />
  ) : preHeatTreatmentResultManagerDialogProps ? (
    <PreHeatTreatmentResultManagerDialog {...preHeatTreatmentResultManagerDialogProps} embedded />
  ) : null

  return (
    <>
      <Suspense fallback={null}>
        {requestDialogProps ? <LnkRequestDialog {...requestDialogProps} /> : null}
        {officialityDialogProps ? <LnkOfficialityDialog {...officialityDialogProps} /> : null}
        {duplicateControlDialogProps ? <DuplicateControlDialog {...duplicateControlDialogProps} /> : null}
        {resultDialogProps ? <LnkResultDialog {...resultDialogProps} /> : null}
        {preHeatTreatmentWorkflowDialogProps ? (
          <PreHeatTreatmentLnkWorkflowDialog {...preHeatTreatmentWorkflowDialogProps} />
        ) : null}
      </Suspense>
      {managerDialog ? (
        <WorkflowDialogShell variant="manager">
          <Suspense fallback={null}>{managerDialog}</Suspense>
        </WorkflowDialogShell>
      ) : null}
    </>
  )
}
