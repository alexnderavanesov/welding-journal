import { useState } from 'react'
import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  createDefaultLnkOfficialityDraft,
  createDefaultLnkResultDraft,
  type LnkOfficialityDraftState,
  type LnkResultDraftState,
} from '@/lib/report-draft-state'

type ManagedLnkResultPreviewState = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  result: string
} | null

type ManagedLnkResultChangeHintState = {
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
  const [managedLnkResultRequestName, setManagedLnkResultRequestName] = useState('')
  const [managedLnkResultMethodKey, setManagedLnkResultMethodKey] = useState<WeldFieldKey | ''>('')
  const [managedLnkResultRequestSearch, setManagedLnkResultRequestSearch] = useState('')
  const [managedLnkConclusionDrafts, setManagedLnkConclusionDrafts] = useState<Record<string, string>>({})
  const [managedLnkResultOrderIds, setManagedLnkResultOrderIds] = useState<number[] | null>(null)
  const [managedLnkResultPreview, setManagedLnkResultPreview] = useState<ManagedLnkResultPreviewState>(null)
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
    managedLnkResultRequestName,
    managedLnkResultMethodKey,
    managedLnkResultRequestSearch,
    managedLnkConclusionDrafts,
    managedLnkResultOrderIds,
    managedLnkResultPreview,
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
    setManagedLnkResultRequestName,
    setManagedLnkResultMethodKey,
    setManagedLnkResultRequestSearch,
    setManagedLnkConclusionDrafts,
    setManagedLnkResultOrderIds,
    setManagedLnkResultPreview,
    setManagedLnkResultChangeHint,
    setManagedLnkPendingResultChanges,
    setPreservedLnkOrderIds,
  }
}
