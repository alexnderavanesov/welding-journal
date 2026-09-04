import { createDefaultLnkOfficialityDraft } from '@/lib/report-draft-state'
import {
  setNumberSetValues,
  toggleNumberSetValue,
} from '@/lib/report-ui-state'
import type { UseLnkOfficialityActionsOptions } from '@/lib/lnk-report-action-types'
import { useConfirmAction } from '@/lib/confirm-action-context'

export function useLnkOfficialityActions({
  draft,
  filteredRows,
  selectedRows,
  isSaveDisabled,
  mutation,
  previewMutation,
  setDraft,
  setIsOpen,
  setMessage,
}: UseLnkOfficialityActionsOptions) {
  const confirmAction = useConfirmAction()
  function openLnkOfficialityModal() {
    setDraft(createDefaultLnkOfficialityDraft())
    setIsOpen(true)
  }

  function closeLnkOfficialityModal() {
    if (mutation.isPending || previewMutation.isPending) return
    setIsOpen(false)
  }

  function toggleLnkOfficialityRow(rowId: number) {
    setDraft((current) => {
      return { ...current, rowIds: toggleNumberSetValue(current.rowIds, rowId) }
    })
  }

  function setVisibleLnkOfficialityRowsSelected(selected: boolean) {
    setDraft((current) => {
      return { ...current, rowIds: setNumberSetValues(current.rowIds, filteredRows.map((row) => row.id), selected) }
    })
  }

  async function saveLnkOfficiality() {
    if (isSaveDisabled) return
    const officiality = draft.officiality as 'official' | 'unofficial'
    try {
      const plan = await previewMutation.mutateAsync({ records: selectedRows, officiality })
      if (plan.renames.length > 0 || plan.earlyCoilDecisions.length > 0) {
        const renameText = plan.renames
          .slice(0, 8)
          .map((change) => `${change.currentJoint} -> ${change.targetJoint}`)
          .join('; ')
        const hiddenRenameCount = Math.max(0, plan.renames.length - 8)
        const coilText = plan.earlyCoilDecisions
          .map((decision) => decision.targetJoints.join(' + '))
          .join('; ')
        const confirmed = await confirmAction({
          title: 'Изменить официальность и перестроить цепочку',
          itemName: `Будет изменено стыков: ${plan.officialityChanges.length}`,
          description: renameText
            ? `Переименование продолжения: ${renameText}${hiddenRenameCount > 0 ? `; и еще ${hiddenRenameCount}` : ''}.`
            : 'Названия продолжения цепочки менять не потребуется.',
          warning: coilText
            ? `Катушка ${coilText} перестанет быть автоматической и будет сохранена как явно принятая досрочная катушка. Данные катушки не удаляются.`
            : 'Все перечисленные изменения выполнятся вместе. Данные, контроль и документы останутся у тех же записей.',
          confirmLabel: plan.renames.length > 0 ? 'Сохранить и перестроить' : 'Сохранить',
          tone: 'warning',
        })
        if (!confirmed) return
      }
      mutation.mutate({ records: selectedRows, officiality, plan })
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  return {
    openLnkOfficialityModal,
    closeLnkOfficialityModal,
    toggleLnkOfficialityRow,
    setVisibleLnkOfficialityRowsSelected,
    saveLnkOfficiality,
  }
}
