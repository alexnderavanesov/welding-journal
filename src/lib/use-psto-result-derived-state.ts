import { useMemo } from 'react'
import { PSTO_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import { findFirstDateBeforeWeldDateIssue } from '@/lib/report-date-rules'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import { collectRequestNames, filterRequestNamesBySearch, getRequestNameFromNaming, sortPstoRequestNamesNewestFirst } from '@/lib/report-naming'
import { canSelectPstoResultRow } from '@/lib/report-modal-rows'
import { filterPstoResultRows } from '@/lib/report-row-utils'
import { hasText } from '@/lib/report-value-utils'
import type { WeldRow } from '@/lib/dispatcher-types'

type PstoResultDerivedStateParams = {
  heatTreatmentRows: WeldRow[]
  pstoResultSelectedRows: WeldRow[]
  pstoResultRequestOptions: string[]
  pstoResultRequestSearch: string
  selectedPstoResultRequestRows: WeldRow[]
  pstoResultDraft: PstoResultDraftState
  nextPstoDiagramName: string
  isPstoResultSaving: boolean
}

export function usePstoResultDerivedState({
  heatTreatmentRows,
  pstoResultSelectedRows,
  pstoResultRequestOptions,
  pstoResultRequestSearch,
  selectedPstoResultRequestRows,
  pstoResultDraft,
  nextPstoDiagramName,
  isPstoResultSaving,
}: PstoResultDerivedStateParams) {
  const pstoResultAvailableRequestOptions = useMemo(() => {
    const selectedRequestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(pstoResultSelectedRows, ['pstoRequest']))
    return selectedRequestOptions.length > 0 ? selectedRequestOptions : pstoResultRequestOptions
  }, [pstoResultRequestOptions, pstoResultSelectedRows])

  const filteredPstoResultRequestOptions = useMemo(
    () => filterRequestNamesBySearch(pstoResultAvailableRequestOptions, pstoResultRequestSearch),
    [pstoResultAvailableRequestOptions, pstoResultRequestSearch],
  )

  const pstoResultSearchRows = pstoResultDraft.requestName ? selectedPstoResultRequestRows : heatTreatmentRows

  const filteredPstoResultRows = useMemo(
    () => filterPstoResultRows(pstoResultSearchRows, pstoResultDraft.search),
    [pstoResultDraft.search, pstoResultSearchRows],
  )

  const selectedPstoResultRows = useMemo(
    () =>
      filteredPstoResultRows.filter(
        (row) => pstoResultDraft.rowIds.has(row.id) && canSelectPstoResultRow(row, pstoResultDraft.requestName),
      ),
    [filteredPstoResultRows, pstoResultDraft.requestName, pstoResultDraft.rowIds],
  )

  const pstoResultSaveBlockReason = useMemo(() => {
    if (isPstoResultSaving) return 'Результат сохраняется, дождитесь завершения.'
    if (!pstoResultDraft.requestName) return 'Выберите заявку ПСТО.'
    if (selectedPstoResultRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
    if (!pstoResultDraft.result) return 'Выберите результат ПСТО.'
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && pstoResultDraft.result !== 'проведено') return 'Выберите результат ПСТО.'
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && !pstoResultDraft.pstoDate) return 'Укажите дату ПСТО.'
    const dateIssue =
      pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE
        ? null
        : findFirstDateBeforeWeldDateIssue(selectedPstoResultRows, pstoResultDraft.pstoDate, 'Дата ПСТО')
    if (dateIssue) return dateIssue
    if (
      pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE &&
      !getRequestNameFromNaming(pstoResultDraft.diagramNaming, nextPstoDiagramName)
    ) {
      return 'Укажите наименование диаграммы термообработки.'
    }
    return ''
  }, [isPstoResultSaving, nextPstoDiagramName, pstoResultDraft, selectedPstoResultRows])

  const managedPstoResultRows = useMemo(
    () =>
      heatTreatmentRows.filter(
        (row) => pstoResultDraft.rowIds.has(row.id) && (hasText(row.pstoResult) || hasText(row.heatTreatmentDiagram) || hasText(row.pstoDate)),
      ),
    [heatTreatmentRows, pstoResultDraft.rowIds],
  )

  return {
    pstoResultAvailableRequestOptions,
    filteredPstoResultRequestOptions,
    filteredPstoResultRows,
    selectedPstoResultRows,
    pstoResultSaveBlockReason,
    managedPstoResultRows,
  }
}
