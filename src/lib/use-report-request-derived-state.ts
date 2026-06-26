import { useMemo } from 'react'
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
import type { LnkRequestDraftState, LnkResultDraftState, PstoResultDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_REQUEST_FIELD_KEYS } from '@/lib/report-config'

interface ReportRequestDerivedStateOptions {
  rows: WeldRow[]
  heatTreatmentRows: WeldRow[]
  lnkRows: WeldRow[]
  availablePstoRequestRows: WeldRow[]
  availableLnkRequestRows: WeldRow[]
  selectedHeatTreatmentIds: Set<number>
  selectedLnkIds: Set<number>
  lnkRequestDraft: LnkRequestDraftState
  pstoResultDraft: PstoResultDraftState
  lnkResultDraft: LnkResultDraftState
  managedPstoRequestName: string
  managedLnkRequestName: string
}

export function useReportRequestDerivedState({
  rows,
  heatTreatmentRows,
  lnkRows,
  availablePstoRequestRows,
  availableLnkRequestRows,
  selectedHeatTreatmentIds,
  selectedLnkIds,
  lnkRequestDraft,
  pstoResultDraft,
  lnkResultDraft,
  managedPstoRequestName,
  managedLnkRequestName,
}: ReportRequestDerivedStateOptions) {
  const selectedHeatTreatmentRows = useMemo(
    () => availablePstoRequestRows.filter((row) => selectedHeatTreatmentIds.has(row.id)),
    [availablePstoRequestRows, selectedHeatTreatmentIds],
  )
  const selectedLnkRows = useMemo(
    () => availableLnkRequestRows.filter((row) => selectedLnkIds.has(row.id)),
    [availableLnkRequestRows, selectedLnkIds],
  )
  const selectedLnkMethodKeys = useMemo(() => [...lnkRequestDraft.methods], [lnkRequestDraft.methods])
  const selectedLnkRequestTargetCount = useMemo(
    () => countLnkRequestTargets(selectedLnkRows, selectedLnkMethodKeys),
    [selectedLnkMethodKeys, selectedLnkRows],
  )
  const nextPstoRequestName = useMemo(() => formatPstoRequestName(heatTreatmentRows), [heatTreatmentRows])
  const nextLnkRequestName = useMemo(() => formatLnkRequestName(rows), [rows])
  const pstoRequestOptions = useMemo(() => collectRequestNames(rows, ['pstoRequest']), [rows])
  const pstoRequestManagerOptions = useMemo(() => sortPstoRequestNamesNewestFirst(pstoRequestOptions), [pstoRequestOptions])
  const managedPstoRequestRows = useMemo(
    () => filterPstoRowsByRequestName(heatTreatmentRows, managedPstoRequestName),
    [heatTreatmentRows, managedPstoRequestName],
  )
  const pstoResultRequestOptions = useMemo(() => sortPstoRequestNamesNewestFirst(collectRequestNames(heatTreatmentRows, ['pstoRequest'])), [heatTreatmentRows])
  const lnkRequestOptions = useMemo(() => collectRequestNames(rows, LNK_REQUEST_FIELD_KEYS), [rows])
  const lnkRequestManagerOptions = useMemo(() => sortLnkRequestNamesNewestFirst(lnkRequestOptions), [lnkRequestOptions])
  const lnkResultRequestOptions = useMemo(() => collectLnkResultRequestNames(lnkRows), [lnkRows])
  const managedLnkRequestRows = useMemo(() => filterLnkRowsByRequestName(lnkRows, managedLnkRequestName), [lnkRows, managedLnkRequestName])
  const managedLnkRequestMethods = useMemo(
    () => getLnkRequestMethodsForRows(managedLnkRequestRows, managedLnkRequestName),
    [managedLnkRequestName, managedLnkRequestRows],
  )
  const nextLnkConclusionName = useMemo(
    () => formatLnkConclusionName(rows, lnkResultDraft.controlDate, lnkResultDraft.methodKey),
    [lnkResultDraft.controlDate, lnkResultDraft.methodKey, rows],
  )
  const nextPstoDiagramName = useMemo(
    () => formatPstoDiagramName(rows, pstoResultDraft.pstoDate),
    [pstoResultDraft.pstoDate, rows],
  )
  const selectedPstoResultRequestRows = useMemo(
    () => filterPstoRowsByRequestName(heatTreatmentRows, pstoResultDraft.requestName),
    [heatTreatmentRows, pstoResultDraft.requestName],
  )
  const pstoResultSelectedRows = useMemo(
    () => heatTreatmentRows.filter((row) => pstoResultDraft.rowIds.has(row.id)),
    [heatTreatmentRows, pstoResultDraft.rowIds],
  )
  const selectedLnkResultRequestRows = useMemo(
    () => filterLnkRowsByRequestName(lnkRows, lnkResultDraft.requestName),
    [lnkResultDraft.requestName, lnkRows],
  )
  const lnkResultSelectedRows = useMemo(
    () => lnkRows.filter((row) => lnkResultDraft.rowIds.has(row.id)),
    [lnkResultDraft.rowIds, lnkRows],
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
