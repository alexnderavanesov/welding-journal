import type { ActiveReport } from '@/lib/home-state'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { isUnusedRepeatedJointDraft } from '@/lib/repeated-joint-tasks'
import type {
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
  RepeatedJointTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import { getCoilJointNames, parseRepeatedJointName } from '@/lib/joint-chain'
import { isUnofficialJoint } from '@/lib/joint-display'
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import type { WeldJointChainEarlyCoilCandidate } from '@/server/weld-contracts'
import { getWeldJointById } from '@/server/weld-read-api'

type MutationLike<TValue> = {
  mutate: (value: TValue) => void
}

type UseRepeatedJointTaskActionsOptions = {
  activeReport: ActiveReport
  loadTasks: () => Promise<RepeatedJointTask[]>
  systemIndexSettings: SystemIndexSettings
  repeatedJointMutation: MutationLike<RepeatedJointCreateTask | RepeatedJointCoilTask>
  earlyCoilMutation: MutationLike<{
    sourceRowId: number
    expectedVersion: string
    task?: RepeatedJointCreateTask
  }>
  obsoleteRepeatedJointMutation: MutationLike<RepeatedJointDeleteTask>
  renameRepeatedJointMutation: MutationLike<RepeatedJointRenameTask>
  setMessage: (value: string) => void
}

export function useRepeatedJointTaskActions({
  activeReport,
  loadTasks,
  systemIndexSettings,
  repeatedJointMutation,
  earlyCoilMutation,
  obsoleteRepeatedJointMutation,
  renameRepeatedJointMutation,
  setMessage,
}: UseRepeatedJointTaskActionsOptions) {
  const confirmAction = useConfirmAction()

  async function getCurrentTasks() {
    try {
      return await loadTasks()
    } catch {
      setMessage('Не удалось обновить диспетчер для проверки задачи. Повторите действие.')
      return null
    }
  }

  async function createRepeatedJoint(task: RepeatedJointCreateTask | RepeatedJointCoilTask) {
    if (activeReport === 'lnk') {
      setMessage('В отчете ЛНК диспетчер только показывает цепочку. Создание стыков доступно из сварочного журнала.')
      return
    }

    const currentTasks = await getCurrentTasks()
    if (!currentTasks) return
    const currentTask = currentTasks.find(
      (candidate): candidate is RepeatedJointCreateTask | RepeatedJointCoilTask =>
        (candidate.kind === 'create' || candidate.kind === 'coil') && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }

    repeatedJointMutation.mutate(currentTask)
  }

  async function createEarlyCoil(task: RepeatedJointCreateTask) {
    if (activeReport !== 'weldingJournal') {
      setMessage('Досрочная врезка катушки доступна только из сварочного журнала.')
      return
    }
    const currentTasks = await getCurrentTasks()
    if (!currentTasks) return
    const currentTask = currentTasks.find(
      (candidate): candidate is RepeatedJointCreateTask =>
        candidate.kind === 'create' && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }

    let sourceRow: WeldRow | null
    try {
      sourceRow = await getWeldJointById({ data: { id: currentTask.row.id } })
    } catch {
      setMessage('Не удалось обновить исходный стык перед созданием катушки. Повторите действие.')
      return
    }
    if (!sourceRow) {
      setMessage('Исходный стык больше не существует. Обновите отчет и повторите действие.')
      return
    }
    if (isUnofficialJoint(sourceRow)) {
      setMessage('Досрочную катушку можно создать только после негодного официального стыка.')
      return
    }

    const targetJoints = getCoilJointNames(
      parseRepeatedJointName(currentTask.sourceJoint, systemIndexSettings).base,
      systemIndexSettings,
    ) as [string, string]
    await confirmAndCreateEarlyCoil({
      sourceRow,
      sourceJoint: currentTask.sourceJoint,
      targetJoints,
      replacementJoint: currentTask.targetJoint,
      task: currentTask,
    })
  }

  async function createEarlyCoilFromChain(
    sourceRow: WeldRow,
    candidate: WeldJointChainEarlyCoilCandidate,
  ) {
    if (activeReport !== 'weldingJournal') {
      setMessage('Досрочная врезка катушки доступна только из сварочного журнала.')
      return
    }
    await confirmAndCreateEarlyCoil({
      sourceRow,
      sourceJoint: candidate.sourceJoint,
      targetJoints: candidate.targetJoints,
      replacementJoint: candidate.replacementJoint ?? '',
    })
  }

  async function confirmAndCreateEarlyCoil({
    sourceRow,
    sourceJoint,
    targetJoints,
    replacementJoint,
    task,
  }: {
    sourceRow: WeldRow
    sourceJoint: string
    targetJoints: [string, string]
    replacementJoint: string
    task?: RepeatedJointCreateTask
  }) {
    if (isUnofficialJoint(sourceRow)) {
      setMessage('Досрочную катушку можно создать только после негодного официального стыка.')
      return
    }
    const confirmed = await confirmAction({
      title: 'Врезать катушку досрочно',
      itemName: `${sourceJoint} -> ${targetJoints.join(' + ')}`,
      description:
        'Система завершит текущую ветку ремонта или выреза и создаст два новых стыка катушки. Решение сохранится в настройках среди принятых исключений.',
      warning: replacementJoint
        ? `Если ожидаемый стык ${replacementJoint} уже создан и остается полностью пустым, он будет заменен катушкой. Заполненные или измененные стыки система не удаляет.`
        : 'Перед созданием сервер еще раз проверит актуальность цепочки. Заполненные или измененные стыки система не удаляет.',
      confirmLabel: 'Врезать катушку',
      tone: 'warning',
    })
    if (!confirmed) return
    earlyCoilMutation.mutate({
      sourceRowId: sourceRow.id,
      expectedVersion: String(sourceRow.rowVersion ?? '').trim(),
      task,
    })
  }

  async function deleteObsoleteRepeatedJoint(task: RepeatedJointDeleteTask) {
    if (activeReport === 'lnk') {
      setMessage('В отчете ЛНК диспетчер только показывает цепочку. Удаление стыков доступно из сварочного журнала.')
      return
    }

    const currentTasks = await getCurrentTasks()
    if (!currentTasks) return
    const currentTask = currentTasks.find(
      (candidate): candidate is RepeatedJointDeleteTask => candidate.kind === 'delete' && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }
    if (!isUnusedRepeatedJointDraft(currentTask.row)) {
      setMessage('Повторный стык уже содержит данные. Диспетчер не удаляет такие стыки автоматически, проверьте цепочку вручную.')
      return
    }

    const confirmed = await confirmAction({
      title: 'Удалить повторный стык',
      itemName: `${task.targetJoint}`,
      description: `Исходный стык ${task.sourceJoint} больше не требует повтора.`,
      warning: 'Стык будет удален из сварочного журнала. Это действие нельзя отменить.',
    })
    if (!confirmed) return
    obsoleteRepeatedJointMutation.mutate(currentTask)
  }

  async function renameObsoleteRepeatedJoint(task: RepeatedJointRenameTask) {
    if (activeReport === 'lnk') {
      setMessage('В отчете ЛНК диспетчер только показывает цепочку. Переименование стыков доступно из сварочного журнала.')
      return
    }

    const currentTasks = await getCurrentTasks()
    if (!currentTasks) return
    const currentTask = currentTasks.find(
      (candidate): candidate is RepeatedJointRenameTask => candidate.kind === 'rename' && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }

    const renamePlan = currentTask.changes
      .map((change) => `${change.currentJoint} -> ${change.targetJoint}`)
      .join('; ')
    const confirmed = await confirmAction({
      title: currentTask.changes.length > 1 ? 'Исправить имена цепочки' : 'Переименовать повторный стык',
      itemName: `${currentTask.currentJoint} -> ${currentTask.targetJoint}`,
      description:
        `Диспетчер пересчитал имена от измененного звена по фактическим результатам цепочки. ` +
        `Будут выполнены изменения: ${renamePlan}.`,
      warning: 'Все перечисленные стыки будут переименованы вместе. Данные и документы останутся привязаны к тем же записям.',
      confirmLabel: currentTask.changes.length > 1 ? 'Исправить цепочку' : 'Переименовать',
      tone: 'warning',
    })
    if (!confirmed) return
    renameRepeatedJointMutation.mutate(currentTask)
  }

  return {
    createEarlyCoil,
    createEarlyCoilFromChain,
    createRepeatedJoint,
    deleteObsoleteRepeatedJoint,
    renameObsoleteRepeatedJoint,
  }
}
