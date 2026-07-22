import { useState } from 'react'
import { createDefaultLnkRequestDraft, type LnkRequestDraftState } from '@/lib/report-draft-state'
import {
  defaultRequestNamingState,
  type RequestNamingState,
} from '@/lib/request-naming-state'

export function useLnkRequestModalState() {
  const [lnkRequestDraft, setLnkRequestDraft] = useState<LnkRequestDraftState>(() => createDefaultLnkRequestDraft())
  const [lnkRequestNaming, setLnkRequestNaming] = useState<RequestNamingState>(defaultRequestNamingState)
  const [isLnkRequestModalOpen, setIsLnkRequestModalOpen] = useState(false)
  const [isLnkRequestManagerOpen, setIsLnkRequestManagerOpen] = useState(false)
  const [managedLnkRequestName, setManagedLnkRequestName] = useState('')
  const [managedLnkRequestNameDraft, setManagedLnkRequestNameDraft] = useState('')
  const [lnkRequestSearch, setLnkRequestSearch] = useState('')

  return {
    lnkRequestDraft,
    lnkRequestNaming,
    isLnkRequestModalOpen,
    isLnkRequestManagerOpen,
    managedLnkRequestName,
    managedLnkRequestNameDraft,
    lnkRequestSearch,
    setLnkRequestDraft,
    setLnkRequestNaming,
    setIsLnkRequestModalOpen,
    setIsLnkRequestManagerOpen,
    setManagedLnkRequestName,
    setManagedLnkRequestNameDraft,
    setLnkRequestSearch,
  }
}
