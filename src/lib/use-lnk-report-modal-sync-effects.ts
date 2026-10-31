import {
  type Dispatch,
  type SetStateAction,
  useEffect,
} from 'react'
import { filterLnkResultDraftRowResults } from '@/lib/lnk-result-draft'
import {
  canSelectLnkResultRow,
} from '@/lib/report-modal-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { ControlProcessSettings } from '@/lib/control-process-settings'

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
  controlProcessSettings: ControlProcessSettings
  isLnkRowsContextReady: boolean
  isLnkRequestModalOpen: boolean
  isLnkResultManagerOpen: boolean
  isLnkResultModalOpen: boolean
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
  controlProcessSettings,
  isLnkRowsContextReady,
  isLnkRequestModalOpen,
  isLnkResultManagerOpen,
  isLnkResultModalOpen,
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
    if (!isLnkResultManagerOpen || !isLnkRowsContextReady) return
    setManagedLnkConclusionDrafts((current) => {
      const next = Object.fromEntries(
        managedLnkResultEntries.map(({ row, method, changeKey }) => [
          changeKey,
          current[changeKey] ?? String(row[method.conclusionKey] ?? '').trim(),
        ]),
      )
      return areStringRecordsEqual(current, next) ? current : next
    })
  }, [isLnkResultManagerOpen, isLnkRowsContextReady, managedLnkResultEntries, setManagedLnkConclusionDrafts])

  useEffect(() => {
    if (!isLnkResultManagerOpen || !isLnkRowsContextReady) return
    if (managedLnkResultMethodKey && !managedLnkResultMethods.some((method) => method.requestKey === managedLnkResultMethodKey)) {
      setManagedLnkResultMethodKey('')
    }
  }, [
    isLnkResultManagerOpen,
    isLnkRowsContextReady,
    managedLnkResultMethodKey,
    managedLnkResultMethods,
    setManagedLnkResultMethodKey,
  ])

  useEffect(() => {
    if (!isLnkRequestModalOpen || !isLnkRowsContextReady) return
    setSelectedLnkIds((current) => {
      const ids = new Set(availableLnkRequestRows.map((row) => row.id))
      const next = new Set([...current].filter((id) => ids.has(id)))
      return next.size === current.size ? current : next
    })
  }, [availableLnkRequestRows, isLnkRequestModalOpen, isLnkRowsContextReady, setSelectedLnkIds])

  useEffect(() => {
    if (!isLnkRowsContextReady) return
    setLnkResultDraft((current) => {
      if (!isLnkResultModalOpen) return current
      const methodKey = current.methodKey
      const rowsById = new Map(lnkRows.map((row) => [row.id, row]))
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = rowsById.get(id)
          return row
            ? !methodKey ||
                canSelectLnkResultRow(row, '', methodKey, undefined, controlProcessSettings)
            : false
        }),
      )
      const rowResults = filterLnkResultDraftRowResults(current.rowResults, rowIds)
      if (
        areNumberSetsEqual(rowIds, current.rowIds) &&
        areStringRecordsEqual(rowResults, current.rowResults)
      ) {
        return current
      }
      return {
        ...current,
        rowIds,
        rowResults,
        layeredControlRowIds: new Set([...current.layeredControlRowIds].filter(id => rowIds.has(id))),
      }
    })
  }, [controlProcessSettings, isLnkResultModalOpen, isLnkRowsContextReady, lnkRows, setLnkResultDraft])
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
