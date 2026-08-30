import { lazy, Suspense } from 'react'
import type { PstoRequestDialogProps } from '@/components/psto-request-dialog'
import type { PstoRequestManagerDialogProps } from '@/components/psto-request-manager-dialog'
import type { PstoResultDialogProps } from '@/components/psto-result-dialog'
import type { PstoResultManagerDialogProps } from '@/components/psto-result-manager-dialog'
import type { TvmtWorkflowDialogProps } from '@/components/tvmt-workflow-dialog'
import type { PstoRepeatWorkflowDialogProps } from '@/components/psto-repeat-workflow-dialog'
import type { PstoLineProgramDialogProps } from '@/components/psto-line-program-dialog'

const PstoRequestDialog = lazy(() => import('@/components/psto-request-dialog').then((module) => ({ default: module.PstoRequestDialog })))
const PstoRequestManagerDialog = lazy(() => import('@/components/psto-request-manager-dialog').then((module) => ({ default: module.PstoRequestManagerDialog })))
const PstoResultDialog = lazy(() => import('@/components/psto-result-dialog').then((module) => ({ default: module.PstoResultDialog })))
const PstoResultManagerDialog = lazy(() => import('@/components/psto-result-manager-dialog').then((module) => ({ default: module.PstoResultManagerDialog })))
const TvmtWorkflowDialog = lazy(() => import('@/components/tvmt-workflow-dialog').then((module) => ({ default: module.TvmtWorkflowDialog })))
const PstoRepeatWorkflowDialog = lazy(() => import('@/components/psto-repeat-workflow-dialog').then((module) => ({ default: module.PstoRepeatWorkflowDialog })))
const PstoLineProgramDialog = lazy(() => import('@/components/psto-line-program-dialog').then((module) => ({ default: module.PstoLineProgramDialog })))

export type ReportPstoDialogsProps = {
  requestDialogProps: PstoRequestDialogProps | null
  requestManagerDialogProps: PstoRequestManagerDialogProps | null
  resultDialogProps: PstoResultDialogProps | null
  resultManagerDialogProps: PstoResultManagerDialogProps | null
  tvmtWorkflowDialogProps: TvmtWorkflowDialogProps | null
  repeatWorkflowDialogProps: PstoRepeatWorkflowDialogProps | null
  lineProgramDialogProps: PstoLineProgramDialogProps | null
}

export function ReportPstoDialogs({
  requestDialogProps,
  requestManagerDialogProps,
  resultDialogProps,
  resultManagerDialogProps,
  tvmtWorkflowDialogProps,
  repeatWorkflowDialogProps,
  lineProgramDialogProps,
}: ReportPstoDialogsProps) {
  return (
    <Suspense fallback={null}>
      {requestDialogProps ? <PstoRequestDialog {...requestDialogProps} /> : null}
      {requestManagerDialogProps ? <PstoRequestManagerDialog {...requestManagerDialogProps} /> : null}
      {resultDialogProps ? <PstoResultDialog {...resultDialogProps} /> : null}
      {resultManagerDialogProps ? <PstoResultManagerDialog {...resultManagerDialogProps} /> : null}
      {tvmtWorkflowDialogProps ? <TvmtWorkflowDialog {...tvmtWorkflowDialogProps} /> : null}
      {repeatWorkflowDialogProps ? <PstoRepeatWorkflowDialog {...repeatWorkflowDialogProps} /> : null}
      {lineProgramDialogProps ? <PstoLineProgramDialog {...lineProgramDialogProps} /> : null}
    </Suspense>
  )
}
