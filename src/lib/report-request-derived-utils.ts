import type { LnkRequestDraftState, LnkResultDraftState, PstoResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_REQUEST_FIELD_KEYS } from '@/lib/report-config'
import {
  collectLnkResultRequestNames,
  collectRequestNames,
  formatLnkConclusionName,
  formatLnkRequestName,
  formatPstoDiagramName,
  formatPstoRequestName,
  sortLnkRequestNamesNewestFirst,
  sortPstoRequestNamesNewestFirst,
} from '@/lib/report-naming'
import {
  countLnkRequestTargets,
  filterLnkRowsByRequestName,
  filterPstoRowsByRequestName,
  getLnkRequestMethodsForRows,
} from '@/lib/report-modal-rows'

export function getSelectedRowsByIds(rows: WeldRow[], ids: Set<number>) {
  return rows.filter((row) => ids.has(row.id))
}

export function getSelectedLnkMethodKeys(lnkRequestDraft: LnkRequestDraftState) {
  return [...lnkRequestDraft.methods]
}

export function getSelectedLnkRequestTargetCount(selectedLnkRows: WeldRow[], selectedLnkMethodKeys: string[]) {
  return countLnkRequestTargets(selectedLnkRows, selectedLnkMethodKeys)
}

export function getNextPstoRequestName(heatTreatmentRows: WeldRow[]) {
  return formatPstoRequestName(heatTreatmentRows)
}

export function getNextLnkRequestName(rows: WeldRow[]) {
  return formatLnkRequestName(rows)
}

export function getPstoRequestOptions(rows: WeldRow[]) {
  return collectRequestNames(rows, ['pstoRequest'])
}

export function getPstoRequestManagerOptions(pstoRequestOptions: string[]) {
  return sortPstoRequestNamesNewestFirst(pstoRequestOptions)
}

export function getManagedPstoRequestRows(heatTreatmentRows: WeldRow[], managedPstoRequestName: string) {
  return filterPstoRowsByRequestName(heatTreatmentRows, managedPstoRequestName)
}

export function getPstoResultRequestOptions(heatTreatmentRows: WeldRow[]) {
  return sortPstoRequestNamesNewestFirst(collectRequestNames(heatTreatmentRows, ['pstoRequest']))
}

export function getLnkRequestOptions(rows: WeldRow[]) {
  return collectRequestNames(rows, LNK_REQUEST_FIELD_KEYS)
}

export function getLnkRequestManagerOptions(lnkRequestOptions: string[]) {
  return sortLnkRequestNamesNewestFirst(lnkRequestOptions)
}

export function getLnkResultRequestOptions(lnkRows: WeldRow[]) {
  return collectLnkResultRequestNames(lnkRows)
}

export function getManagedLnkRequestRows(lnkRows: WeldRow[], managedLnkRequestName: string) {
  return filterLnkRowsByRequestName(lnkRows, managedLnkRequestName)
}

export function getManagedLnkRequestMethods(managedLnkRequestRows: WeldRow[], managedLnkRequestName: string) {
  return getLnkRequestMethodsForRows(managedLnkRequestRows, managedLnkRequestName)
}

export function getNextLnkConclusionName(rows: WeldRow[], lnkResultDraft: LnkResultDraftState) {
  return formatLnkConclusionName(rows, lnkResultDraft.controlDate, lnkResultDraft.methodKey)
}

export function getNextPstoDiagramName(rows: WeldRow[], pstoResultDraft: PstoResultDraftState) {
  return formatPstoDiagramName(rows, pstoResultDraft.pstoDate)
}

export function getSelectedPstoResultRequestRows(heatTreatmentRows: WeldRow[], pstoResultDraft: PstoResultDraftState) {
  return filterPstoRowsByRequestName(heatTreatmentRows, pstoResultDraft.requestName)
}

export function getPstoResultSelectedRows(heatTreatmentRows: WeldRow[], pstoResultDraft: PstoResultDraftState) {
  return getSelectedRowsByIds(heatTreatmentRows, pstoResultDraft.rowIds)
}

export function getSelectedLnkResultRequestRows(lnkRows: WeldRow[], lnkResultDraft: LnkResultDraftState) {
  return filterLnkRowsByRequestName(lnkRows, lnkResultDraft.requestName)
}

export function getLnkResultSelectedRows(lnkRows: WeldRow[], lnkResultDraft: LnkResultDraftState) {
  return getSelectedRowsByIds(lnkRows, lnkResultDraft.rowIds)
}
