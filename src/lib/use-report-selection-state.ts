import { useState } from 'react'
import { useWorkflowSelectionState } from '@/lib/use-workflow-selection-state'

export function useReportSelectionState() {
  const [selectedWeldingJournalIds, setSelectedWeldingJournalIds] = useState<Set<number>>(new Set())
  const [selectedHeatTreatmentIds, setSelectedHeatTreatmentIds, pstoSelectionWarning, dismissPstoWarning] = useWorkflowSelectionState(() => new Set())
  const [selectedLnkIds, setSelectedLnkIds, lnkSelectionWarning, dismissLnkWarning] = useWorkflowSelectionState(() => new Set())

  return {
    selectionWarning: lnkSelectionWarning ?? pstoSelectionWarning,
    dismissSelectionWarning: () => { dismissLnkWarning(); dismissPstoWarning() },
    selectedHeatTreatmentIds,
    selectedLnkIds,
    selectedWeldingJournalIds,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
    setSelectedWeldingJournalIds,
  }
}
