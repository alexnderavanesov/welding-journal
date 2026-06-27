import type { Dispatch, SetStateAction } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import {
  buildLnkResultDraftById,
  isValidLnkResultDraftValue,
} from '@/lib/lnk-result-draft'
import { LNK_CUSTOM_RESULT_VALUE, LNK_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkResultMutation = {
  mutate: (variables: {
    records: WeldRow[]
    methodKey: WeldFieldKey
    controlDate: string
    resultById: Record<number, string>
    conclusionName: string
  }) => void
}

type ClearLnkGeneratedDataMutation = {
  mutate: (rows: WeldRow[]) => void
}

type UseLnkResultSaveActionsOptions = {
  lnkRows: WeldRow[]
  draft: LnkResultDraftState
  selectedRows: WeldRow[]
  saveBlockReason: string | null
  nextConclusionName: string
  resultMutation: LnkResultMutation
  clearGeneratedDataMutation: ClearLnkGeneratedDataMutation
  setDraft: Dispatch<SetStateAction<LnkResultDraftState>>
  setMessage: (value: string) => void
}

export function useLnkResultSaveActions({
  lnkRows,
  draft,
  selectedRows,
  saveBlockReason,
  nextConclusionName,
  resultMutation,
  clearGeneratedDataMutation,
  setDraft,
  setMessage,
}: UseLnkResultSaveActionsOptions) {
  function setLnkResultForRow(rowId: number, result: string) {
    setDraft((current) => {
      if (!current.rowIds.has(rowId)) return current
      const row = lnkRows.find((candidate) => candidate.id === rowId)
      if (row && result === 'ремонт' && isLnkRepairForbidden(row)) return current
      const baseline = current.result && current.result !== LNK_CUSTOM_RESULT_VALUE ? current.result : ''
      const rowResults: Record<number, string> = {}
      for (const id of current.rowIds) {
        rowResults[id] = current.rowResults[id] || baseline
      }
      rowResults[rowId] = result
      return { ...current, result: LNK_CUSTOM_RESULT_VALUE, rowResults }
    })
  }

  function handleAddLnkResult() {
    if (saveBlockReason) {
      setMessage(saveBlockReason)
      return
    }
    if (!draft.methodKey) {
      setMessage('Выберите метод контроля')
      return
    }
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков')
      return
    }
    const resultById = buildLnkResultDraftById(selectedRows, draft)
    const resultValues = Object.values(resultById)
    if (resultValues.some((result) => !isValidLnkResultDraftValue(result))) {
      setMessage('Укажите результат для каждого выбранного стыка')
      return
    }
    const hasNonEmptyResult = resultValues.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
    if (hasNonEmptyResult && !draft.controlDate) {
      setMessage('Укажите дату контроля')
      return
    }
    const conclusionName =
      !hasNonEmptyResult ? '' : getRequestNameFromNaming(draft.conclusionNaming, nextConclusionName)
    if (hasNonEmptyResult && !conclusionName) {
      setMessage('Укажите наименование заключения')
      return
    }

    resultMutation.mutate({
      records: selectedRows,
      methodKey: draft.methodKey,
      controlDate: draft.controlDate,
      resultById,
      conclusionName,
    })
  }

  function handleClearLnkGeneratedData() {
    const confirmed = window.confirm(
      'Очистить результаты, даты и заключения ЛНК? Заявки ЛНК, сами стыки и отметки наличия контроля останутся.',
    )
    if (!confirmed) return
    clearGeneratedDataMutation.mutate(lnkRows)
  }

  return {
    handleAddLnkResult,
    handleClearLnkGeneratedData,
    setLnkResultForRow,
  }
}
