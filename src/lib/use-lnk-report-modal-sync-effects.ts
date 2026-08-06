import {
  type Dispatch,
  type SetStateAction,
  useEffect,
} from 'react'
import { filterLnkResultDraftRowResults } from '@/lib/lnk-result-draft'
import {
  canSelectLnkResultRow,
  filterLnkRowsByRequestName,
  getLnkInputMethodsForRows,
} from '@/lib/report-modal-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  findRequestDocumentIdentity,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

type SetNumberSet = Dispatch<SetStateAction<Set<number>>>

export type ManagedLnkResultEntry = {
  row: WeldRow
  method: {
    requestKey: WeldFieldKey
    conclusionKey: WeldFieldKey
  }
  changeKey: string
}

export type LnkReportModalSyncEffectsOptions = {
  availableLnkRequestRows: WeldRow[]
  isLnkResultManagerOpen: boolean
  isLnkResultModalOpen: boolean
  lnkRequestOptions: string[]
  lnkResultRequestOptions: RequestDocumentIdentity[]
  lnkRows: WeldRow[]
  managedLnkResultEntries: ManagedLnkResultEntry[]
  managedLnkResultMethodKey: WeldFieldKey | ''
  managedLnkResultMethods: Array<{ requestKey: WeldFieldKey }>
  setLnkResultDraft: Dispatch<SetStateAction<LnkResultDraftState>>
  setManagedLnkConclusionDrafts: Dispatch<SetStateAction<Record<string, string>>>
  setManagedLnkResultMethodKey: Dispatch<SetStateAction<WeldFieldKey | ''>>
  setSelectedLnkIds: SetNumberSet
}

export function useLnkReportModalSyncEffects({
  availableLnkRequestRows,
  isLnkResultManagerOpen,
  isLnkResultModalOpen,
  lnkRequestOptions,
  lnkResultRequestOptions,
  lnkRows,
  managedLnkResultEntries,
  managedLnkResultMethodKey,
  managedLnkResultMethods,
  setLnkResultDraft,
  setManagedLnkConclusionDrafts,
  setManagedLnkResultMethodKey,
  setSelectedLnkIds,
}: LnkReportModalSyncEffectsOptions) {
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
    setManagedLnkResultMethodKey,
  ])

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
      const selectedRequest = findRequestDocumentIdentity(
        lnkResultRequestOptions,
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
      const requestRows = filterLnkRowsByRequestName(lnkRows, requestName, requestDate)
      const methodRows = current.rowIds.size > 0 ? [...selectedRows, ...requestRows] : requestName ? requestRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, '')
      const methodKey = !current.methodKey || methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = lnkRows.find((candidate) => candidate.id === id)
          return row
            ? !methodKey ||
                canSelectLnkResultRow(row, requestName, methodKey, requestDate)
            : false
        }),
      )
      return {
        ...current,
        requestName,
        requestDate,
        methodKey,
        rowIds,
        rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds),
      }
    })
  }, [isLnkResultModalOpen, lnkRequestOptions, lnkResultRequestOptions, lnkRows, setLnkResultDraft])
}
