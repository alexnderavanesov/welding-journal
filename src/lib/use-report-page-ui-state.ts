import { useState } from 'react'
import type { EditingState, HeatTreatmentFieldEditingState } from '@/lib/home-state'
import type { WeldRow } from '@/lib/dispatcher-types'

export function useReportPageUiState() {
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [chainRecord, setChainRecord] = useState<WeldRow | null>(null)
  const [heatTreatmentFieldEditing, setHeatTreatmentFieldEditing] = useState<HeatTreatmentFieldEditingState | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  return {
    editing,
    chainRecord,
    heatTreatmentFieldEditing,
    message,
    setEditing,
    setChainRecord,
    setHeatTreatmentFieldEditing,
    setMessage,
  }
}
