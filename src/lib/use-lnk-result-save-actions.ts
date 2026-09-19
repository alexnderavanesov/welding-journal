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
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentCreationPlan, type SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { getPrimaryLnkStageAccess } from '@/lib/lnk-control-stage'

type LnkResultMutation = {
  mutate: (variables: {
    records: WeldRow[]
    methodKey: WeldFieldKey
    controlDate: string
    resultById: Record<number, string>
    conclusionName: string
    useSystemName?: boolean
    documentGroups?: SystemDocumentCreationGroup[]
  }) => void
}

type UseLnkResultSaveActionsOptions = {
  controlProcessSettings: ControlProcessSettings
  lnkRows: WeldRow[]
  draft: LnkResultDraftState
  selectedRows: WeldRow[]
  saveBlockReason: string | null
  nextConclusionName: string
  nextConclusionNumber?: number
  requestConclusionSettings: RequestConclusionSettings
  resultMutation: LnkResultMutation
  setDraft: Dispatch<SetStateAction<LnkResultDraftState>>
  setMessage: (value: string) => void
}

export function useLnkResultSaveActions({
  controlProcessSettings,
  lnkRows,
  draft,
  selectedRows,
  saveBlockReason,
  nextConclusionName,
  nextConclusionNumber,
  requestConclusionSettings,
  resultMutation,
  setDraft,
  setMessage,
}: UseLnkResultSaveActionsOptions) {
  const saveCheckSettings = useSaveCheckSettings()
  const confirmAction = useConfirmAction()

  function setLnkResultForRow(rowId: number, result: string) {
    setLnkResultForRows([rowId], result)
  }

  function setLnkResultForRows(rowIds: number[], result: string) {
    setDraft((current) => {
      const targetIds = new Set(rowIds.filter((rowId) => current.rowIds.has(rowId)))
      if (targetIds.size === 0) return current
      const targetRows = lnkRows.filter((candidate) => targetIds.has(candidate.id))
      if (saveCheckSettings.lnkResultRepairRules && result === 'ремонт' && targetRows.some(isLnkRepairForbidden)) return current
      const baseline = current.result && current.result !== LNK_CUSTOM_RESULT_VALUE ? current.result : ''
      const rowResults: Record<number, string> = {}
      for (const id of current.rowIds) {
        rowResults[id] = current.rowResults[id] || baseline
      }
      for (const rowId of targetIds) rowResults[rowId] = result
      return { ...current, result: LNK_CUSTOM_RESULT_VALUE, rowResults }
    })
  }

  async function handleAddLnkResult() {
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
    const resultById = buildLnkResultDraftById(selectedRows, draft, saveCheckSettings)
    const resultValues = Object.values(resultById)
    if (resultValues.some((result) => !isValidLnkResultDraftValue(result))) {
      setMessage('Укажите результат для каждого выбранного стыка')
      return
    }
    const hasNonEmptyResult = resultValues.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
    if (saveCheckSettings.lnkResultControlDateRequired && hasNonEmptyResult && !draft.controlDate) {
      setMessage('Укажите дату контроля')
      return
    }
    const method = getLnkMethodByRequestKey(draft.methodKey)
    const conclusionRows = selectedRows.filter((row) => resultById[row.id] !== LNK_EMPTY_RESULT_VALUE)
    const creationPlan = buildSystemDocumentCreationPlan({
      type: 'lnkConclusion',
      methodCode: method?.code,
      date: draft.controlDate,
      rows: conclusionRows,
      naming: draft.conclusionNaming,
      settings: requestConclusionSettings,
      nextNumber: nextConclusionNumber,
      allowAllNamesEmpty: !saveCheckSettings.lnkResultConclusionRequired,
    })
    const conclusionName = !hasNonEmptyResult
      ? ''
      : creationPlan.groups[0]?.name ?? getRequestNameFromNaming(draft.conclusionNaming, nextConclusionName)
    if (hasNonEmptyResult && creationPlan.error) {
      setMessage(creationPlan.error)
      return
    }

    if (method) {
      const warningRows = selectedRows.filter(
        (row) =>
          resultById[row.id] !== LNK_EMPTY_RESULT_VALUE &&
          getPrimaryLnkStageAccess(row, method.code, controlProcessSettings).status === 'allowed-with-warning',
      )
      if (warningRows.length > 0) {
        const confirmed = await confirmAction({
          title: 'Продолжить основной НК раньше?',
          itemName: `Стыков: ${warningRows.length} · Метод: ${method.code}`,
          description: 'Предыдущие этапы контроля еще не завершены. Результаты и заключения будут оформлены в основном этапе ЛНК.',
          warning: 'В диспетчере появится системное предупреждение СП-01 до завершения НК до ТО, ПСТО и ТВМТ.',
          confirmLabel: 'Продолжить',
          tone: 'warning',
        })
        if (!confirmed) return
      }
    }

    resultMutation.mutate({
      records: selectedRows,
      methodKey: draft.methodKey,
      controlDate: draft.controlDate,
      resultById,
      conclusionName,
      useSystemName: hasNonEmptyResult && draft.conclusionNaming.mode === 'system',
      documentGroups: creationPlan.groups,
    })
  }

  return {
    handleAddLnkResult,
    setLnkResultForRow,
    setLnkResultForRows,
  }
}
