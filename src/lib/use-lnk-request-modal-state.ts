import { useState } from 'react'
import { createDefaultLnkRequestDraft, type LnkRequestDraftState } from '@/lib/report-draft-state'
import {
  defaultRequestNamingState,
  type RequestNamingState,
} from '@/lib/request-naming-state'

export type LnkRequestComposerMode = 'create' | 'extend'

export function useLnkRequestModalState() {
  const [lnkRequestDraft, setLnkRequestDraft] = useState<LnkRequestDraftState>(() => createDefaultLnkRequestDraft())
  const [lnkRequestNaming, setLnkRequestNaming] = useState<RequestNamingState>(defaultRequestNamingState)
  const [isLnkRequestModalOpen, setIsLnkRequestModalOpen] = useState(false)
  const [isLnkRequestManagerOpen, setIsLnkRequestManagerOpen] = useState(false)
  const [managedLnkRequestName, setManagedLnkRequestName] = useState('')
  const [managedLnkRequestDate, setManagedLnkRequestDate] = useState('')
  const [managedLnkRequestNameDraft, setManagedLnkRequestNameDraft] = useState('')
  const [lnkRequestSearch, setLnkRequestSearch] = useState('')
  const [lnkRequestComposerMode, setLnkRequestComposerMode] = useState<LnkRequestComposerMode>('create')
  const [lnkRequestTargetKey, setLnkRequestTargetKey] = useState('')

  return {
    lnkRequestDraft,
    lnkRequestNaming,
    isLnkRequestModalOpen,
    isLnkRequestManagerOpen,
    managedLnkRequestName,
    managedLnkRequestDate,
    managedLnkRequestNameDraft,
    lnkRequestSearch,
    lnkRequestComposerMode,
    lnkRequestTargetKey,
    setLnkRequestDraft,
    setLnkRequestNaming,
    setIsLnkRequestModalOpen,
    setIsLnkRequestManagerOpen,
    setManagedLnkRequestName,
    setManagedLnkRequestDate,
    setManagedLnkRequestNameDraft,
    setLnkRequestSearch,
    setLnkRequestComposerMode,
    setLnkRequestTargetKey,
  }
}
