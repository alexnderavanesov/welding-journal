import { useMemo } from 'react'
import {
  getLnkRequestManagerOptions,
  getLnkRequestOptions,
  getLnkResultRequestOptions,
  getLnkResultSelectedRows,
  getManagedLnkRequestMethods,
  getManagedLnkRequestRows,
  getManagedPstoRequestRows,
  getNextLnkConclusionName,
  getNextLnkRequestName,
  getNextPstoDiagramName,
  getNextPstoRequestName,
  getPstoRequestManagerOptions,
  getPstoRequestOptions,
  getPstoResultRequestOptions,
  getPstoResultSelectedRows,
  getSelectedLnkMethodKeys,
  getSelectedLnkRequestTargetCount,
  getSelectedLnkResultRequestRows,
  getSelectedPstoResultRequestRows,
  getSelectedRowsByIds,
} from '@/lib/report-request-derived-utils'
import type { LnkRequestDraftState, LnkResultDraftState, PstoResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'

interface ReportRequestDerivedStateOptions {
  rows: WeldRow[]
  heatTreatmentRows: WeldRow[]
  lnkRows: WeldRow[]
  availablePstoRequestRows: WeldRow[]
  availableLnkRequestRows: WeldRow[]
  selectedHeatTreatmentIds: Set<number>
  selectedLnkIds: Set<number>
  pstoRequestDate: string
  lnkRequestDraft: LnkRequestDraftState
  pstoResultDraft: PstoResultDraftState
  lnkResultDraft: LnkResultDraftState
  managedPstoRequestName: string
  managedLnkRequestName: string
  requestConclusionSettings: RequestConclusionSettings
}

export function useReportRequestDerivedState({
  rows,
  heatTreatmentRows,
  lnkRows,
  availablePstoRequestRows,
  availableLnkRequestRows,
  selectedHeatTreatmentIds,
  selectedLnkIds,
  pstoRequestDate,
  lnkRequestDraft,
  pstoResultDraft,
  lnkResultDraft,
  managedPstoRequestName,
  managedLnkRequestName,
  requestConclusionSettings,
}: ReportRequestDerivedStateOptions) {
  const selectedHeatTreatmentRows = useMemo(
    () => getSelectedRowsByIds(availablePstoRequestRows, selectedHeatTreatmentIds),
    [availablePstoRequestRows, selectedHeatTreatmentIds],
  )
  const selectedLnkRows = useMemo(
    () => getSelectedRowsByIds(availableLnkRequestRows, selectedLnkIds),
    [availableLnkRequestRows, selectedLnkIds],
  )
  const selectedLnkMethodKeys = useMemo(() => getSelectedLnkMethodKeys(lnkRequestDraft), [lnkRequestDraft.methods])
  const selectedLnkRequestTargetCount = useMemo(
    () => getSelectedLnkRequestTargetCount(selectedLnkRows, selectedLnkMethodKeys),
    [selectedLnkMethodKeys, selectedLnkRows],
  )
  const nextPstoRequestName = useMemo(
    () => getNextPstoRequestName(heatTreatmentRows, requestConclusionSettings, pstoRequestDate),
    [heatTreatmentRows, pstoRequestDate, requestConclusionSettings],
  )
  const nextLnkRequestName = useMemo(
    () => getNextLnkRequestName(rows, requestConclusionSettings, lnkRequestDraft.requestDate),
    [lnkRequestDraft.requestDate, requestConclusionSettings, rows],
  )
  const pstoRequestOptions = useMemo(() => getPstoRequestOptions(rows), [rows])
  const pstoRequestManagerOptions = useMemo(() => getPstoRequestManagerOptions(pstoRequestOptions), [pstoRequestOptions])
  const managedPstoRequestRows = useMemo(
    () => getManagedPstoRequestRows(heatTreatmentRows, managedPstoRequestName),
    [heatTreatmentRows, managedPstoRequestName],
  )
  const pstoResultRequestOptions = useMemo(() => getPstoResultRequestOptions(heatTreatmentRows), [heatTreatmentRows])
  const lnkRequestOptions = useMemo(() => getLnkRequestOptions(rows), [rows])
  const lnkRequestManagerOptions = useMemo(() => getLnkRequestManagerOptions(lnkRequestOptions), [lnkRequestOptions])
  const lnkResultRequestOptions = useMemo(() => getLnkResultRequestOptions(lnkRows), [lnkRows])
  const managedLnkRequestRows = useMemo(() => getManagedLnkRequestRows(lnkRows, managedLnkRequestName), [lnkRows, managedLnkRequestName])
  const managedLnkRequestMethods = useMemo(
    () => getManagedLnkRequestMethods(managedLnkRequestRows, managedLnkRequestName),
    [managedLnkRequestName, managedLnkRequestRows],
  )
  const nextLnkConclusionName = useMemo(
    () => getNextLnkConclusionName(rows, lnkResultDraft, requestConclusionSettings),
    [lnkResultDraft, requestConclusionSettings, rows],
  )
  const nextPstoDiagramName = useMemo(
    () => getNextPstoDiagramName(rows, pstoResultDraft, requestConclusionSettings),
    [pstoResultDraft, requestConclusionSettings, rows],
  )
  const selectedPstoResultRequestRows = useMemo(
    () => getSelectedPstoResultRequestRows(heatTreatmentRows, pstoResultDraft),
    [heatTreatmentRows, pstoResultDraft],
  )
  const pstoResultSelectedRows = useMemo(
    () => getPstoResultSelectedRows(heatTreatmentRows, pstoResultDraft),
    [heatTreatmentRows, pstoResultDraft],
  )
  const selectedLnkResultRequestRows = useMemo(
    () => getSelectedLnkResultRequestRows(lnkRows, lnkResultDraft),
    [lnkResultDraft, lnkRows],
  )
  const lnkResultSelectedRows = useMemo(
    () => getLnkResultSelectedRows(lnkRows, lnkResultDraft),
    [lnkResultDraft, lnkRows],
  )

  return {
    selectedHeatTreatmentRows,
    selectedLnkRows,
    selectedLnkMethodKeys,
    selectedLnkRequestTargetCount,
    nextPstoRequestName,
    nextLnkRequestName,
    pstoRequestOptions,
    pstoRequestManagerOptions,
    managedPstoRequestRows,
    pstoResultRequestOptions,
    lnkRequestOptions,
    lnkRequestManagerOptions,
    lnkResultRequestOptions,
    managedLnkRequestRows,
    managedLnkRequestMethods,
    nextLnkConclusionName,
    nextPstoDiagramName,
    selectedPstoResultRequestRows,
    pstoResultSelectedRows,
    selectedLnkResultRequestRows,
    lnkResultSelectedRows,
  }
}
