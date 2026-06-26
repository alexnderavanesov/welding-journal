import { useState } from 'react'

export function useReportSelectionState() {
  const [selectedHeatTreatmentIds, setSelectedHeatTreatmentIds] = useState<Set<number>>(new Set())
  const [selectedLnkIds, setSelectedLnkIds] = useState<Set<number>>(new Set())

  return {
    selectedHeatTreatmentIds,
    selectedLnkIds,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
  }
}
