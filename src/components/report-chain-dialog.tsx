import type { ComponentProps } from 'react'
import { JointChainDialog } from '@/components/joint-chain-dialog'

type JointChainDialogProps = ComponentProps<typeof JointChainDialog>

type ReportChainDialogProps = {
  dialogProps: JointChainDialogProps | null
}

export function ReportChainDialog({ dialogProps }: ReportChainDialogProps) {
  if (!dialogProps) return null

  return <JointChainDialog {...dialogProps} />
}
