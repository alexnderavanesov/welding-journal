import type { LnkResultDraftState, PstoResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { LNK_METHODS, LNK_REQUEST_FIELD_KEYS } from '@/lib/report-config'
import {
  collectRequestNames,
  formatLnkConclusionName,
  formatLnkRequestName,
  formatPstoDiagramName,
  formatPstoRequestName,
} from '@/lib/report-naming'
import {
  getLnkRequestDocumentIdentities,
  getPstoRequestDocumentIdentities,
  isSameRequestDocument,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

export function getSelectedRowsByIds(rows: WeldRow[], ids: Set<number>) {
  return rows.filter((row) => ids.has(row.id))
}

export function getNextPstoRequestName(heatTreatmentRows: WeldRow[], settings: RequestConclusionSettings, requestDate?: string, documentNumber?: number) {
  return formatPstoRequestName(heatTreatmentRows, settings, requestDate, documentNumber)
}

export function getNextLnkRequestName(rows: WeldRow[], settings: RequestConclusionSettings, requestDate?: string, documentNumber?: number) {
  return formatLnkRequestName(rows, settings, requestDate, documentNumber)
}

export function getPstoRequestOptions(rows: WeldRow[]) {
  return collectRequestNames(rows, ['pstoRequest'])
}

export function getPstoRequestManagerOptions(rows: WeldRow[]) {
  return getPstoRequestDocumentIdentities(rows)
}

export function getManagedPstoRequestRows(
  heatTreatmentRows: WeldRow[],
  identity: Pick<RequestDocumentIdentity, 'name' | 'date'>,
) {
  return heatTreatmentRows.filter((row) =>
    isSameRequestDocument(row.pstoRequest, row.pstoRequestDate, identity),
  )
}

export function getPstoResultRequestOptions(heatTreatmentRows: WeldRow[]) {
  return getPstoRequestDocumentIdentities(heatTreatmentRows)
}

export function getLnkRequestOptions(rows: WeldRow[]) {
  return collectRequestNames(rows, LNK_REQUEST_FIELD_KEYS)
}

export function getLnkRequestManagerOptions(rows: WeldRow[]) {
  return getLnkRequestDocumentIdentities(rows)
}

export function getLnkResultRequestOptions(lnkRows: WeldRow[]) {
  return getLnkRequestDocumentIdentities(lnkRows)
}

export function getManagedLnkRequestRows(
  lnkRows: WeldRow[],
  identity: Pick<RequestDocumentIdentity, 'name' | 'date'>,
) {
  return lnkRows.filter((row) =>
    LNK_METHODS.some((method) =>
      isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], identity),
    ),
  )
}

export function getManagedLnkRequestMethods(
  managedLnkRequestRows: WeldRow[],
  identity: Pick<RequestDocumentIdentity, 'name' | 'date'>,
) {
  return LNK_METHODS.filter((method) =>
    managedLnkRequestRows.some((row) =>
      isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], identity),
    ),
  )
}

export function getNextLnkConclusionName(rows: WeldRow[], lnkResultDraft: LnkResultDraftState, settings: RequestConclusionSettings, documentNumber?: number) {
  return formatLnkConclusionName(rows, lnkResultDraft.controlDate, lnkResultDraft.methodKey, settings, documentNumber)
}

export function getNextPstoDiagramName(rows: WeldRow[], pstoResultDraft: PstoResultDraftState, settings: RequestConclusionSettings, documentNumber?: number) {
  return formatPstoDiagramName(rows, pstoResultDraft.pstoDate, settings, documentNumber)
}

export function getSelectedPstoResultRequestRows(heatTreatmentRows: WeldRow[], pstoResultDraft: PstoResultDraftState) {
  if (!pstoResultDraft.requestName) return []
  return heatTreatmentRows.filter((row) =>
    isSameRequestDocument(row.pstoRequest, row.pstoRequestDate, {
      name: pstoResultDraft.requestName,
      date: pstoResultDraft.requestDate,
    }),
  )
}

export function getPstoResultSelectedRows(heatTreatmentRows: WeldRow[], pstoResultDraft: PstoResultDraftState) {
  return getSelectedRowsByIds(heatTreatmentRows, pstoResultDraft.rowIds)
}

export function getSelectedLnkResultRequestRows(lnkRows: WeldRow[], lnkResultDraft: LnkResultDraftState) {
  if (!lnkResultDraft.requestName) return []
  return lnkRows.filter((row) =>
    LNK_METHODS.some((method) =>
      isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], {
        name: lnkResultDraft.requestName,
        date: lnkResultDraft.requestDate,
      }),
    ),
  )
}

export function getLnkResultSelectedRows(lnkRows: WeldRow[], lnkResultDraft: LnkResultDraftState) {
  return getSelectedRowsByIds(lnkRows, lnkResultDraft.rowIds)
}
