import { SystemDocumentNamesPanel } from '@/components/system-document-names-panel'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SystemDocumentCreationGroup, SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import type { MouseEvent } from 'react'

type LnkResultConclusionsPanelProps = {
  plan: SystemDocumentCreationPlan
  naming: RequestNamingState
  disabled?: boolean
  onNamingChange: (value: RequestNamingState) => void
  onOpenGroupContextMenu?: (event: MouseEvent<HTMLElement>, group: SystemDocumentCreationGroup) => void
}

export function LnkResultConclusionsPanel(props: LnkResultConclusionsPanelProps) {
  return (
    <SystemDocumentNamesPanel
      {...props}
      documentNameLabel="Наименование заключения"
      documentNameAriaLabel="Название заключения"
      documentNamePlaceholder="Название заключения"
      emptyMessage="Выберите метод, результат и хотя бы один стык."
    />
  )
}
