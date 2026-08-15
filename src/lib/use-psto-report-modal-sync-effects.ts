import {
  type Dispatch,
  type SetStateAction,
  useEffect,
} from 'react'
import {
  canSelectPstoResultRow,
  filterPstoRowsByRequestName,
} from '@/lib/report-modal-rows'
import { filterPstoResultRows } from '@/lib/report-row-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import {
  findRequestDocumentIdentity,
  getPstoRequestDocumentIdentities,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

type SetNumberSet = Dispatch<SetStateAction<Set<number>>>

export type PstoReportModalSyncEffectsOptions = {
  availablePstoRequestRows: WeldRow[]
  heatTreatmentRows: WeldRow[]
  isPstoRowsContextReady: boolean
  isPstoRequestModalOpen: boolean
  isPstoResultManagerOpen: boolean
  isPstoResultModalOpen: boolean
  managedPstoResultRows: WeldRow[]
  pstoResultRequestOptions: RequestDocumentIdentity[]
  setManagedPstoDiagramDrafts: Dispatch<SetStateAction<Record<number, string>>>
  setPstoResultDraft: Dispatch<SetStateAction<PstoResultDraftState>>
  setSelectedHeatTreatmentIds: SetNumberSet
}

export function usePstoReportModalSyncEffects({
  availablePstoRequestRows,
  heatTreatmentRows,
  isPstoRowsContextReady,
  isPstoRequestModalOpen,
  isPstoResultManagerOpen,
  isPstoResultModalOpen,
  managedPstoResultRows,
  pstoResultRequestOptions,
  setManagedPstoDiagramDrafts,
  setPstoResultDraft,
  setSelectedHeatTreatmentIds,
}: PstoReportModalSyncEffectsOptions) {
  useEffect(() => {
    if (!isPstoRequestModalOpen || !isPstoRowsContextReady) return
    setSelectedHeatTreatmentIds((current) => {
      const selectableIds = new Set(availablePstoRequestRows.map((row) => row.id))
      const next = new Set([...current].filter((id) => selectableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [availablePstoRequestRows, isPstoRequestModalOpen, isPstoRowsContextReady, setSelectedHeatTreatmentIds])

  useEffect(() => {
    if (!isPstoRowsContextReady) return
    setPstoResultDraft((current) => {
      if (!isPstoResultModalOpen) return current
      const selectedRows = heatTreatmentRows.filter((row) => current.rowIds.has(row.id))
      const requestOptions = getPstoRequestDocumentIdentities(selectedRows)
      const allowedRequestOptions = requestOptions.length > 0 ? requestOptions : pstoResultRequestOptions
      const selectedRequest = findRequestDocumentIdentity(
        allowedRequestOptions,
        current.requestName,
        current.requestDate,
      )
      const keepsCurrentRequest = Boolean(
        selectedRequest &&
          selectedRequest.name === current.requestName &&
          selectedRequest.date === current.requestDate,
      )
      const requestName = keepsCurrentRequest ? current.requestName : ''
      const requestDate = keepsCurrentRequest ? current.requestDate : ''
      const availableRows = filterPstoResultRows(
        requestName
          ? filterPstoRowsByRequestName(heatTreatmentRows, requestName, requestDate)
          : heatTreatmentRows,
        current.search,
      )
      const availableIds = new Set(
        availableRows
          .filter((row) => canSelectPstoResultRow(row, requestName, requestDate))
          .map((row) => row.id),
      )
      const rowIds = new Set([...current.rowIds].filter((id) => availableIds.has(id)))
      if (
        requestName === current.requestName &&
        requestDate === current.requestDate &&
        areNumberSetsEqual(rowIds, current.rowIds)
      ) {
        return current
      }
      return { ...current, requestName, requestDate, rowIds }
    })
  }, [heatTreatmentRows, isPstoResultModalOpen, isPstoRowsContextReady, pstoResultRequestOptions, setPstoResultDraft])

  useEffect(() => {
    if (!isPstoResultManagerOpen || !isPstoRowsContextReady) return
    setManagedPstoDiagramDrafts((current) => {
      const next = Object.fromEntries(
        managedPstoResultRows.map((row) => [row.id, String(row.heatTreatmentDiagram ?? '').trim()]),
      )
      return areStringRecordsEqual(current, next) ? current : next
    })
  }, [isPstoResultManagerOpen, isPstoRowsContextReady, managedPstoResultRows, setManagedPstoDiagramDrafts])
}

function areNumberSetsEqual(left: ReadonlySet<number>, right: ReadonlySet<number>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function areStringRecordsEqual(
  left: Readonly<Record<string | number, string>>,
  right: Readonly<Record<string | number, string>>,
) {
  const leftEntries = Object.entries(left)
  const rightKeys = Object.keys(right)
  return leftEntries.length === rightKeys.length && leftEntries.every(([key, value]) => right[key] === value)
}
