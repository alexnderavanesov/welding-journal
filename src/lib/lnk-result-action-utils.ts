import { LNK_METHODS } from '@/lib/report-config'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { filterLnkResultDraftRowResults } from '@/lib/lnk-result-draft'
import { canSelectLnkResultRow } from '@/lib/report-modal-rows'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { collectRequestDocumentIdentities, createRequestDocumentIdentity, type RequestDocumentIdentity } from '@/lib/request-document-identity'
import type { ControlProcessSettings } from '@/lib/control-process-settings'

export function getInitialLnkResultRequest(rows: WeldRow[], settings?: ControlProcessSettings) {
  const requests = collectRequestDocumentIdentities(rows.flatMap(row => LNK_METHODS.flatMap(method => {
    if (!canSelectLnkResultRow(row, '', method.requestKey, undefined, settings)) return []
    const identity = createRequestDocumentIdentity(row[method.requestKey], row[method.requestDateKey])
    return identity ? [identity] : []
  })))
  return requests.length === 1 ? requests[0]! : null
}

// A request filters candidates; it never changes the selected conclusion positions.
export function resolveLnkResultDraftAfterRequestChange(
  current: LnkResultDraftState,
  request: RequestDocumentIdentity | null,
): LnkResultDraftState {
  return { ...current, requestName: request?.name ?? '', requestDate: request?.date ?? '' }
}

export function resolveLnkResultDraftAfterMethodChange(
  current: LnkResultDraftState,
  lnkRows: WeldRow[],
  methodKey: WeldFieldKey | '',
  controlProcessSettings?: ControlProcessSettings,
): LnkResultDraftState {
  if (!methodKey) return { ...current, methodKey: '', layeredControlRowIds: new Set() }
  const rowIds = new Set(
    [...current.rowIds].filter((id) => {
      const row = lnkRows.find((candidate) => candidate.id === id)
      return row
        ? canSelectLnkResultRow(
            row,
            '',
            methodKey,
            undefined,
            controlProcessSettings,
          )
        : false
    }),
  )
  return {
    ...current,
    methodKey,
    rowIds,
    rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds),
    layeredControlRowIds: keepLayeredControlRowIds(current, methodKey, rowIds),
  }
}

export function resolveLnkResultDraftAfterRowIdsChange(
  current: LnkResultDraftState,
  rowIds: Set<number>,
): LnkResultDraftState {
  return {
    ...current,
    rowIds,
    rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds),
    layeredControlRowIds: keepLayeredControlRowIds(current, current.methodKey, rowIds),
  }
}

function keepLayeredControlRowIds(current: LnkResultDraftState, methodKey: WeldFieldKey | '', rowIds: Set<number>) {
  return new Set(methodKey === 'pvkRequest' ? [...current.layeredControlRowIds].filter((id) => rowIds.has(id)) : [])
}
