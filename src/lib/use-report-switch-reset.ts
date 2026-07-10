import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  createDefaultLnkResultDraft,
  createDefaultPstoResultDraft,
  type LnkRequestDraftState,
  type LnkResultDraftState,
  type PstoResultDraftState,
} from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { ActiveReport, HeatTreatmentFieldEditingState } from '@/lib/home-state'

type SetState<T> = Dispatch<SetStateAction<T>>

type ReportSwitchResetInput = {
  activeReport: ActiveReport
  replayLatestHighlight: () => void
  resetWelderStampForm: () => void
  setHeatTreatmentFieldEditing: SetState<HeatTreatmentFieldEditingState | null>
  setIsLnkRequestModalOpen: SetState<boolean>
  setIsLnkResultModalOpen: SetState<boolean>
  setIsLnkResultPreviewOpen: SetState<boolean>
  setIsPstoRequestManagerOpen: SetState<boolean>
  setIsPstoRequestModalOpen: SetState<boolean>
  setIsPstoResultManagerOpen: SetState<boolean>
  setIsPstoResultModalOpen: SetState<boolean>
  setIsPstoShowMenuOpen: SetState<boolean>
  setLnkRequestDraft: SetState<LnkRequestDraftState>
  setLnkRequestNaming: SetState<RequestNamingState>
  setLnkRequestSearch: SetState<string>
  setLnkResultDraft: SetState<LnkResultDraftState>
  setManagedPstoDiagramDrafts: SetState<Record<number, string>>
  setManagedPstoRequestName: SetState<string>
  setManagedPstoRequestNameDraft: SetState<string>
  setPreservedLnkOrderIds: SetState<number[] | null>
  setPstoRequestNaming: SetState<RequestNamingState>
  setPstoRequestSearch: SetState<string>
  setPstoResultDraft: SetState<PstoResultDraftState>
  setPstoResultRequestSearch: SetState<string>
  setSelectedHeatTreatmentIds: SetState<Set<number>>
  setSelectedLnkIds: SetState<Set<number>>
  setShouldPinPreviewedLnkResultRows: SetState<boolean>
  setWelderStampSearch: SetState<string>
  defaultLnkRequestNaming: RequestNamingState
  defaultLnkConclusionNaming: RequestNamingState
  defaultPstoRequestNaming: RequestNamingState
  defaultPstoConclusionNaming: RequestNamingState
}

export function useReportSwitchReset({
  activeReport,
  replayLatestHighlight,
  resetWelderStampForm,
  setHeatTreatmentFieldEditing,
  setIsLnkRequestModalOpen,
  setIsLnkResultModalOpen,
  setIsLnkResultPreviewOpen,
  setIsPstoRequestManagerOpen,
  setIsPstoRequestModalOpen,
  setIsPstoResultManagerOpen,
  setIsPstoResultModalOpen,
  setIsPstoShowMenuOpen,
  setLnkRequestDraft,
  setLnkRequestNaming,
  setLnkRequestSearch,
  setLnkResultDraft,
  setManagedPstoDiagramDrafts,
  setManagedPstoRequestName,
  setManagedPstoRequestNameDraft,
  setPreservedLnkOrderIds,
  setPstoRequestNaming,
  setPstoRequestSearch,
  setPstoResultDraft,
  setPstoResultRequestSearch,
  setSelectedHeatTreatmentIds,
  setSelectedLnkIds,
  setShouldPinPreviewedLnkResultRows,
  setWelderStampSearch,
  defaultLnkRequestNaming,
  defaultLnkConclusionNaming,
  defaultPstoRequestNaming,
  defaultPstoConclusionNaming,
}: ReportSwitchResetInput) {
  const previousReportRef = useRef<ActiveReport>('weldingJournal')

  useEffect(() => {
    let frameId: number | null = null
    if (previousReportRef.current !== activeReport) {
      previousReportRef.current = activeReport
      frameId = window.requestAnimationFrame(() => {
        window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
      })
      replayLatestHighlight()
    }

    if (activeReport !== 'heatTreatment') {
      setSelectedHeatTreatmentIds(new Set())
      setHeatTreatmentFieldEditing(null)
      setPstoRequestNaming(defaultPstoRequestNaming)
      setPstoRequestSearch('')
      setPstoResultRequestSearch('')
      setIsPstoRequestModalOpen(false)
      setIsPstoRequestManagerOpen(false)
      setManagedPstoRequestName('')
      setManagedPstoRequestNameDraft('')
      setIsPstoResultModalOpen(false)
      setIsPstoResultManagerOpen(false)
      setManagedPstoDiagramDrafts({})
      setPstoResultDraft(createDefaultPstoResultDraft(defaultPstoConclusionNaming))
      setIsPstoShowMenuOpen(false)
    }
    if (activeReport !== 'lnk') {
      setSelectedLnkIds(new Set())
      setLnkRequestDraft({ methods: new Set() })
      setLnkRequestNaming(defaultLnkRequestNaming)
      setIsLnkRequestModalOpen(false)
      setIsLnkResultModalOpen(false)
      setIsLnkResultPreviewOpen(false)
      setShouldPinPreviewedLnkResultRows(false)
      setLnkResultDraft(createDefaultLnkResultDraft(defaultLnkConclusionNaming))
      setLnkRequestSearch('')
      setPreservedLnkOrderIds(null)
    }
    if (activeReport !== 'welderStamps') {
      resetWelderStampForm()
      setWelderStampSearch('')
    }

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [activeReport])
}
