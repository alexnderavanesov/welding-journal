import type { ReactNode } from 'react'

import { DialogHeader } from '@/components/dialog-header'

type RequestDialogHeaderProps = {
  title: string
  subtitle: string
  onClose: () => void
  actions?: ReactNode
}

export function RequestDialogHeader({ title, subtitle, onClose, actions }: RequestDialogHeaderProps) {
  return <DialogHeader title={title} subtitle={subtitle} onClose={onClose} actions={actions} />
}
