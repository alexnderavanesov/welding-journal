import { useState } from 'react'

export function useReportSelectionState() {
  const [selectedWeldingJournalIds, setSelectedWeldingJournalIds] = useState<Set<number>>(new Set())
  const [selectedHeatTreatmentIds, setSelectedHeatTreatmentIds] = useState<Set<number>>(new Set())
  const [selectedLnkIds, setSelectedLnkIds] = useState<Set<number>>(new Set())

  return {
    selectedHeatTreatmentIds,
    selectedLnkIds,
    selectedWeldingJournalIds,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
    setSelectedWeldingJournalIds,
  }
}
