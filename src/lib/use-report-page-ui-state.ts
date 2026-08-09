import { useEffect, useState } from 'react'
import type { EditingState, HeatTreatmentFieldEditingState, RkExposureEditingState } from '@/lib/home-state'
import type { WeldRow } from '@/lib/dispatcher-types'

export function useReportPageUiState() {
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [chainRecord, setChainRecord] = useState<WeldRow | null>(null)
  const [heatTreatmentFieldEditing, setHeatTreatmentFieldEditing] = useState<HeatTreatmentFieldEditingState | null>(null)
  const [rkExposureEditing, setRkExposureEditing] = useState<RkExposureEditingState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lnkNotice, setLnkNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!lnkNotice) return undefined

    const timeoutId = window.setTimeout(() => setLnkNotice(null), 10000)
    return () => window.clearTimeout(timeoutId)
  }, [lnkNotice])

  return {
    editing,
    chainRecord,
    heatTreatmentFieldEditing,
    rkExposureEditing,
    message,
    lnkNotice,
    setEditing,
    setChainRecord,
    setHeatTreatmentFieldEditing,
    setRkExposureEditing,
    setMessage,
    setLnkNotice,
  }
}
