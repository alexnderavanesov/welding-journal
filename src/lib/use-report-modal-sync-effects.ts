import {
  type Dispatch,
  type SetStateAction,
  useEffect,
} from 'react'
import { filterLnkResultDraftRowResults } from '@/lib/lnk-result-draft'
import {
  canSelectLnkResultRow,
  canSelectPstoResultRow,
  filterLnkRowsByRequestName,
  filterPstoRowsByRequestName,
  getLnkInputMethodsForRows,
} from '@/lib/report-modal-rows'
import { collectRequestNames, sortPstoRequestNamesNewestFirst } from '@/lib/report-naming'
import { filterPstoResultRows } from '@/lib/report-row-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkResultDraftState, PstoResultDraftState } from '@/lib/report-draft-state'
import type { WeldFieldKey } from '@/lib/weld-fields'

type SetNumberSet = Dispatch<SetStateAction<Set<number>>>

type ManagedLnkResultEntry = {
  row: WeldRow
  method: {
    requestKey: WeldFieldKey
    conclusionKey: WeldFieldKey
  }
  changeKey: string
}

type ReportModalSyncEffectsOptions = {
  availableLnkRequestRows: WeldRow[]
  availablePstoRequestRows: WeldRow[]
  heatTreatmentRows: WeldRow[]
  isLnkResultManagerOpen: boolean
  isLnkResultModalOpen: boolean
  isPstoResultManagerOpen: boolean
  isPstoResultModalOpen: boolean
  lnkRequestOptions: string[]
  lnkResultRequestOptions: string[]
  lnkRows: WeldRow[]
  managedLnkResultEntries: ManagedLnkResultEntry[]
  managedLnkResultMethodKey: WeldFieldKey | ''
  managedLnkResultMethods: Array<{ requestKey: WeldFieldKey }>
  managedLnkResultRequestName: string
  managedPstoResultRows: WeldRow[]
  pstoResultRequestOptions: string[]
  setLnkResultDraft: Dispatch<SetStateAction<LnkResultDraftState>>
  setManagedLnkConclusionDrafts: Dispatch<SetStateAction<Record<string, string>>>
  setManagedLnkResultMethodKey: Dispatch<SetStateAction<WeldFieldKey | ''>>
  setManagedPstoDiagramDrafts: Dispatch<SetStateAction<Record<number, string>>>
  setPstoResultDraft: Dispatch<SetStateAction<PstoResultDraftState>>
  setSelectedHeatTreatmentIds: SetNumberSet
  setSelectedLnkIds: SetNumberSet
}

export function useReportModalSyncEffects({
  availableLnkRequestRows,
  availablePstoRequestRows,
  heatTreatmentRows,
  isLnkResultManagerOpen,
  isLnkResultModalOpen,
  isPstoResultManagerOpen,
  isPstoResultModalOpen,
  lnkRequestOptions,
  lnkResultRequestOptions,
  lnkRows,
  managedLnkResultEntries,
  managedLnkResultMethodKey,
  managedLnkResultMethods,
  managedLnkResultRequestName,
  managedPstoResultRows,
  pstoResultRequestOptions,
  setLnkResultDraft,
  setManagedLnkConclusionDrafts,
  setManagedLnkResultMethodKey,
  setManagedPstoDiagramDrafts,
  setPstoResultDraft,
  setSelectedHeatTreatmentIds,
  setSelectedLnkIds,
}: ReportModalSyncEffectsOptions) {
  useEffect(() => {
    if (!isLnkResultManagerOpen) return
    setManagedLnkConclusionDrafts(
      Object.fromEntries(
        managedLnkResultEntries.map(({ row, method, changeKey }) => [changeKey, String(row[method.conclusionKey] ?? '').trim()]),
      ),
    )
  }, [isLnkResultManagerOpen, managedLnkResultEntries, setManagedLnkConclusionDrafts])

  useEffect(() => {
    if (!isLnkResultManagerOpen) return
    if (managedLnkResultMethodKey && !managedLnkResultMethods.some((method) => method.requestKey === managedLnkResultMethodKey)) {
      setManagedLnkResultMethodKey('')
    }
  }, [
    isLnkResultManagerOpen,
    managedLnkResultMethodKey,
    managedLnkResultMethods,
    managedLnkResultRequestName,
    setManagedLnkResultMethodKey,
  ])

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

  useEffect(() => {
    setSelectedLnkIds((current) => {
      const ids = new Set(availableLnkRequestRows.map((row) => row.id))
      const next = new Set([...current].filter((id) => ids.has(id)))
      return next.size === current.size ? current : next
    })
  }, [availableLnkRequestRows, setSelectedLnkIds])

  useEffect(() => {
    setLnkResultDraft((current) => {
      if (!isLnkResultModalOpen) return current
      const selectedRows = lnkRows.filter((row) => current.rowIds.has(row.id))
      const requestName = !current.requestName || lnkResultRequestOptions.includes(current.requestName) ? current.requestName : ''
      const requestRows = filterLnkRowsByRequestName(lnkRows, requestName)
      const methodRows = current.rowIds.size > 0 ? [...selectedRows, ...requestRows] : requestName ? requestRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, '')
      const methodKey = !current.methodKey || methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = lnkRows.find((candidate) => candidate.id === id)
          return row ? !methodKey || canSelectLnkResultRow(row, '', methodKey) : false
        }),
      )
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }, [isLnkResultModalOpen, lnkRequestOptions, lnkResultRequestOptions, lnkRows, setLnkResultDraft])
}
