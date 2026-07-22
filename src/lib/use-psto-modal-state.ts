import { useState } from 'react'
import { formatDateInputValue } from '@/lib/date-format'
import {
  createDefaultPstoResultDraft,
  type PstoResultDraftState,
} from '@/lib/report-draft-state'
import {
  defaultRequestNamingState,
  type RequestNamingState,
} from '@/lib/request-naming-state'

export function usePstoModalState() {
  const [pstoRequestNaming, setPstoRequestNaming] = useState<RequestNamingState>(defaultRequestNamingState)
  const [pstoRequestDate, setPstoRequestDate] = useState(() => formatDateInputValue(new Date()))
  const [pstoRequestSearch, setPstoRequestSearch] = useState('')
  const [pstoResultRequestSearch, setPstoResultRequestSearch] = useState('')
  const [isPstoRequestModalOpen, setIsPstoRequestModalOpen] = useState(false)
  const [isPstoRequestManagerOpen, setIsPstoRequestManagerOpen] = useState(false)
  const [managedPstoRequestName, setManagedPstoRequestName] = useState('')
  const [managedPstoRequestNameDraft, setManagedPstoRequestNameDraft] = useState('')
  const [isPstoResultModalOpen, setIsPstoResultModalOpen] = useState(false)
  const [isPstoResultManagerOpen, setIsPstoResultManagerOpen] = useState(false)
  const [managedPstoDiagramDrafts, setManagedPstoDiagramDrafts] = useState<Record<number, string>>({})
  const [pstoResultDraft, setPstoResultDraft] = useState<PstoResultDraftState>(() => createDefaultPstoResultDraft())

  return {
    pstoRequestNaming,
    pstoRequestDate,
    pstoRequestSearch,
    pstoResultRequestSearch,
    isPstoRequestModalOpen,
    isPstoRequestManagerOpen,
    managedPstoRequestName,
    managedPstoRequestNameDraft,
    isPstoResultModalOpen,
    isPstoResultManagerOpen,
    managedPstoDiagramDrafts,
    pstoResultDraft,
    setPstoRequestNaming,
    setPstoRequestDate,
    setPstoRequestSearch,
    setPstoResultRequestSearch,
    setIsPstoRequestModalOpen,
    setIsPstoRequestManagerOpen,
    setManagedPstoRequestName,
    setManagedPstoRequestNameDraft,
    setIsPstoResultModalOpen,
    setIsPstoResultManagerOpen,
    setManagedPstoDiagramDrafts,
    setPstoResultDraft,
  }
}
