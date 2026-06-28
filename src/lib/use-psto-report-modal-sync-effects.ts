import {
  type Dispatch,
  type SetStateAction,
  useEffect,
} from 'react'
import {
  canSelectPstoResultRow,
  filterPstoRowsByRequestName,
} from '@/lib/report-modal-rows'
import { collectRequestNames, sortPstoRequestNamesNewestFirst } from '@/lib/report-naming'
import { filterPstoResultRows } from '@/lib/report-row-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoResultDraftState } from '@/lib/report-draft-state'

type SetNumberSet = Dispatch<SetStateAction<Set<number>>>

export type PstoReportModalSyncEffectsOptions = {
  availablePstoRequestRows: WeldRow[]
  heatTreatmentRows: WeldRow[]
  isPstoResultManagerOpen: boolean
  isPstoResultModalOpen: boolean
  managedPstoResultRows: WeldRow[]
  pstoResultRequestOptions: string[]
  setManagedPstoDiagramDrafts: Dispatch<SetStateAction<Record<number, string>>>
  setPstoResultDraft: Dispatch<SetStateAction<PstoResultDraftState>>
  setSelectedHeatTreatmentIds: SetNumberSet
}

export function usePstoReportModalSyncEffects({
  availablePstoRequestRows,
  heatTreatmentRows,
  isPstoResultManagerOpen,
  isPstoResultModalOpen,
  managedPstoResultRows,
  pstoResultRequestOptions,
  setManagedPstoDiagramDrafts,
  setPstoResultDraft,
  setSelectedHeatTreatmentIds,
}: PstoReportModalSyncEffectsOptions) {
  useEffect(() => {
    setSelectedHeatTreatmentIds((current) => {
      const selectableIds = new Set(availablePstoRequestRows.map((row) => row.id))
      const next = new Set([...current].filter((id) => selectableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [availablePstoRequestRows, setSelectedHeatTreatmentIds])

  useEffect(() => {
    setPstoResultDraft((current) => {
      if (!isPstoResultModalOpen) return current
      const selectedRows = heatTreatmentRows.filter((row) => current.rowIds.has(row.id))
      const requestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
      const allowedRequestOptions = requestOptions.length > 0 ? requestOptions : pstoResultRequestOptions
      const requestName = !current.requestName || allowedRequestOptions.includes(current.requestName) ? current.requestName : ''
      const availableRows = filterPstoResultRows(requestName ? filterPstoRowsByRequestName(heatTreatmentRows, requestName) : heatTreatmentRows, current.search)
      const availableIds = new Set(availableRows.filter((row) => canSelectPstoResultRow(row, requestName)).map((row) => row.id))
      const rowIds = new Set([...current.rowIds].filter((id) => availableIds.has(id)))
      return { ...current, requestName, rowIds }
    })
  }, [heatTreatmentRows, isPstoResultModalOpen, pstoResultRequestOptions, setPstoResultDraft])

  useEffect(() => {
    if (!isPstoResultManagerOpen) return
    setManagedPstoDiagramDrafts(
      Object.fromEntries(managedPstoResultRows.map((row) => [row.id, String(row.heatTreatmentDiagram ?? '').trim()])),
    )
  }, [isPstoResultManagerOpen, managedPstoResultRows, setManagedPstoDiagramDrafts])
}
