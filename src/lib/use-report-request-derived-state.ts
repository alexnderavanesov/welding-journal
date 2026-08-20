import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  getSelectedLnkResultRequestRows,
  getSelectedPstoResultRequestRows,
  getSelectedRowsByIds,
} from '@/lib/report-request-derived-utils'
import type { LnkRequestDraftState, LnkResultDraftState, PstoResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { getLnkRequestExtensionOptions } from '@/lib/lnk-request-extension'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import {
  SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY,
  loadSystemDocumentSequences,
} from '@/lib/system-document-sequence-storage'

interface ReportRequestDerivedStateOptions {
  enableLnkRequestState?: boolean
  enableLnkResultState?: boolean
  enablePstoRequestState?: boolean
  enablePstoResultState?: boolean
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
  managedPstoRequestDate: string
  managedLnkRequestName: string
  managedLnkRequestDate: string
  requestConclusionSettings: RequestConclusionSettings
}

export function useReportRequestDerivedState({
  enableLnkRequestState = true,
  enableLnkResultState = true,
  enablePstoRequestState = true,
  enablePstoResultState = true,
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
  managedPstoRequestDate,
  managedLnkRequestName,
  managedLnkRequestDate,
  requestConclusionSettings,
}: ReportRequestDerivedStateOptions) {
  const shouldLoadSystemDocumentSequences =
    enableLnkRequestState || enableLnkResultState || enablePstoRequestState || enablePstoResultState
  const { data: systemDocumentSequences } = useQuery({
    queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY,
    queryFn: loadSystemDocumentSequences,
    enabled: shouldLoadSystemDocumentSequences,
    staleTime: 30_000,
  })
  const selectedHeatTreatmentRows = useMemo(
    () => (enablePstoRequestState ? getSelectedRowsByIds(availablePstoRequestRows, selectedHeatTreatmentIds) : []),
    [availablePstoRequestRows, enablePstoRequestState, selectedHeatTreatmentIds],
  )
  const selectedLnkRows = useMemo(
    () => (enableLnkRequestState ? getSelectedRowsByIds(availableLnkRequestRows, selectedLnkIds) : []),
    [availableLnkRequestRows, enableLnkRequestState, selectedLnkIds],
  )
  const pstoResultSelectedRows = useMemo(
    () => (enablePstoResultState ? getPstoResultSelectedRows(heatTreatmentRows, pstoResultDraft) : []),
    [enablePstoResultState, heatTreatmentRows, pstoResultDraft],
  )
  const lnkResultSelectedRows = useMemo(
    () => (enableLnkResultState ? getLnkResultSelectedRows(lnkRows, lnkResultDraft) : []),
    [enableLnkResultState, lnkResultDraft, lnkRows],
  )
  const nextPstoRequestName = useMemo(
    () => (enablePstoRequestState ? getNextPstoRequestName(selectedHeatTreatmentRows, requestConclusionSettings, pstoRequestDate, systemDocumentSequences?.pstoRequest) : ''),
    [enablePstoRequestState, pstoRequestDate, requestConclusionSettings, selectedHeatTreatmentRows, systemDocumentSequences?.pstoRequest],
  )
  const nextLnkRequestName = useMemo(
    () => (enableLnkRequestState ? getNextLnkRequestName(selectedLnkRows, requestConclusionSettings, lnkRequestDraft.requestDate, systemDocumentSequences?.lnkRequest) : ''),
    [enableLnkRequestState, lnkRequestDraft.requestDate, requestConclusionSettings, selectedLnkRows, systemDocumentSequences?.lnkRequest],
  )
  const pstoRequestOptions = useMemo(() => (enablePstoRequestState || enablePstoResultState ? getPstoRequestOptions(rows) : []), [
    enablePstoRequestState,
    enablePstoResultState,
    rows,
  ])
  const pstoRequestManagerOptions = useMemo(
    () => (enablePstoRequestState ? getPstoRequestManagerOptions(heatTreatmentRows) : []),
    [enablePstoRequestState, heatTreatmentRows],
  )
  const managedPstoRequestRows = useMemo(
    () =>
      enablePstoRequestState
        ? getManagedPstoRequestRows(heatTreatmentRows, {
            name: managedPstoRequestName,
            date: managedPstoRequestDate,
          })
        : [],
    [enablePstoRequestState, heatTreatmentRows, managedPstoRequestDate, managedPstoRequestName],
  )
  const pstoResultRequestOptions = useMemo(
    () => (enablePstoResultState ? getPstoResultRequestOptions(heatTreatmentRows) : []),
    [enablePstoResultState, heatTreatmentRows],
  )
  const lnkRequestOptions = useMemo(() => (enableLnkRequestState || enableLnkResultState ? getLnkRequestOptions(rows) : []), [
    enableLnkRequestState,
    enableLnkResultState,
    rows,
  ])
  const lnkRequestManagerOptions = useMemo(
    () => (enableLnkRequestState ? getLnkRequestManagerOptions(lnkRows) : []),
    [enableLnkRequestState, lnkRows],
  )
  const lnkRequestExtensionOptions = useMemo(
    () => (enableLnkRequestState ? getLnkRequestExtensionOptions(lnkRows) : []),
    [enableLnkRequestState, lnkRows],
  )
  const lnkResultRequestOptions = useMemo(() => (enableLnkResultState ? getLnkResultRequestOptions(lnkRows) : []), [
    enableLnkResultState,
    lnkRows,
  ])
  const managedLnkRequestRows = useMemo(
    () =>
      enableLnkRequestState
        ? getManagedLnkRequestRows(lnkRows, {
            name: managedLnkRequestName,
            date: managedLnkRequestDate,
          })
        : [],
    [enableLnkRequestState, lnkRows, managedLnkRequestDate, managedLnkRequestName],
  )
  const managedLnkRequestMethods = useMemo(
    () =>
      enableLnkRequestState
        ? getManagedLnkRequestMethods(managedLnkRequestRows, {
            name: managedLnkRequestName,
            date: managedLnkRequestDate,
          })
        : [],
    [
      enableLnkRequestState,
      managedLnkRequestDate,
      managedLnkRequestName,
      managedLnkRequestRows,
    ],
  )
  const lnkConclusionSequenceId = useMemo(() => {
    const method = LNK_METHODS.find(
      (candidate) => candidate.requestKey === lnkResultDraft.methodKey,
    )
    return method
      ? getSystemDocumentTemplateId({
          type: 'lnkConclusion',
          methodCode: method.code,
        })
      : null
  }, [lnkResultDraft.methodKey])
  const nextLnkConclusionNumber = lnkConclusionSequenceId
    ? systemDocumentSequences?.[lnkConclusionSequenceId]
    : undefined
  const nextLnkConclusionName = useMemo(
    () => (enableLnkResultState ? getNextLnkConclusionName(lnkResultSelectedRows, lnkResultDraft, requestConclusionSettings, nextLnkConclusionNumber) : ''),
    [enableLnkResultState, lnkResultDraft, lnkResultSelectedRows, nextLnkConclusionNumber, requestConclusionSettings],
  )
  const nextPstoDiagramName = useMemo(
    () => (enablePstoResultState ? getNextPstoDiagramName(pstoResultSelectedRows, pstoResultDraft, requestConclusionSettings, systemDocumentSequences?.pstoConclusion) : ''),
    [enablePstoResultState, pstoResultDraft, pstoResultSelectedRows, requestConclusionSettings, systemDocumentSequences?.pstoConclusion],
  )
  const selectedPstoResultRequestRows = useMemo(
    () => (enablePstoResultState ? getSelectedPstoResultRequestRows(heatTreatmentRows, pstoResultDraft) : []),
    [enablePstoResultState, heatTreatmentRows, pstoResultDraft],
  )
  const selectedLnkResultRequestRows = useMemo(
    () => (enableLnkResultState ? getSelectedLnkResultRequestRows(lnkRows, lnkResultDraft) : []),
    [enableLnkResultState, lnkResultDraft, lnkRows],
  )

  return {
    selectedHeatTreatmentRows,
    selectedLnkRows,
    nextPstoRequestName,
    nextLnkRequestName,
    pstoRequestOptions,
    pstoRequestManagerOptions,
    managedPstoRequestRows,
    pstoResultRequestOptions,
    lnkRequestOptions,
    lnkRequestManagerOptions,
    lnkRequestExtensionOptions,
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
