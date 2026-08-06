import { useState } from 'react'
import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  createDefaultLnkOfficialityDraft,
  createDefaultLnkResultDraft,
  type LnkOfficialityDraftState,
  type LnkResultDraftState,
} from '@/lib/report-draft-state'

export type ManagedLnkResultChangeHintState = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  from: string
  to: string
} | null

export function useLnkResultModalState() {
  const [isLnkResultModalOpen, setIsLnkResultModalOpen] = useState(false)
  const [isLnkResultPreviewOpen, setIsLnkResultPreviewOpen] = useState(false)
  const [shouldPinPreviewedLnkResultRows, setShouldPinPreviewedLnkResultRows] = useState(false)
  const [lnkResultDraft, setLnkResultDraft] = useState<LnkResultDraftState>(() => createDefaultLnkResultDraft())
  const [lnkResultRequestSearch, setLnkResultRequestSearch] = useState('')
  const [isLnkOfficialityModalOpen, setIsLnkOfficialityModalOpen] = useState(false)
  const [lnkOfficialityDraft, setLnkOfficialityDraft] = useState<LnkOfficialityDraftState>(() =>
    createDefaultLnkOfficialityDraft(),
  )
  const [isLnkResultManagerOpen, setIsLnkResultManagerOpen] = useState(false)
  const [managedLnkResultMethodKey, setManagedLnkResultMethodKey] = useState<WeldFieldKey | ''>('')
  const [managedLnkConclusionDrafts, setManagedLnkConclusionDrafts] = useState<Record<string, string>>({})
  const [managedLnkResultOrderIds, setManagedLnkResultOrderIds] = useState<number[] | null>(null)
  const [managedLnkResultChangeHint, setManagedLnkResultChangeHint] = useState<ManagedLnkResultChangeHintState>(null)
  const [managedLnkPendingResultChanges, setManagedLnkPendingResultChanges] = useState<Record<string, string>>({})
  const [preservedLnkOrderIds, setPreservedLnkOrderIds] = useState<number[] | null>(null)

  return {
    isLnkResultModalOpen,
    isLnkResultPreviewOpen,
    shouldPinPreviewedLnkResultRows,
    lnkResultDraft,
    lnkResultRequestSearch,
    isLnkOfficialityModalOpen,
    lnkOfficialityDraft,
    isLnkResultManagerOpen,
    managedLnkResultMethodKey,
    managedLnkConclusionDrafts,
    managedLnkResultOrderIds,
    managedLnkResultChangeHint,
    managedLnkPendingResultChanges,
    preservedLnkOrderIds,
    setIsLnkResultModalOpen,
    setIsLnkResultPreviewOpen,
    setShouldPinPreviewedLnkResultRows,
    setLnkResultDraft,
    setLnkResultRequestSearch,
    setIsLnkOfficialityModalOpen,
    setLnkOfficialityDraft,
    setIsLnkResultManagerOpen,
    setManagedLnkResultMethodKey,
    setManagedLnkConclusionDrafts,
    setManagedLnkResultOrderIds,
    setManagedLnkResultChangeHint,
    setManagedLnkPendingResultChanges,
    setPreservedLnkOrderIds,
  }
}
