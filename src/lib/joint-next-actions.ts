import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import {
  getRepeatedJointTaskDetails,
  getRepeatedJointTaskTitle,
} from '@/lib/dispatcher-text'
import { getPendingLnkResultMethods } from '@/lib/lnk-result-navigation'
import {
  getAvailablePreHeatTreatmentRequestMethods,
  getAvailablePreHeatTreatmentResultMethods,
} from '@/lib/lnk-workflow-routing'
import {
  getPrimaryLnkStageBlockReason,
  isPrimaryLnkStageReady,
} from '@/lib/lnk-control-stage'
import { getAvailableLnkRequestMethods, getJointStatusLabel } from '@/lib/lnk-status'
import {
  canAddPstoWorkflowResult,
  canCreatePstoWorkflowRequest,
  getPstoWorkflowRequestBlockReason,
} from '@/lib/psto-status'
import { isPstoCancelledValue } from '@/lib/psto-line-assignment'
import { hasWeldDate } from '@/lib/report-value-utils'
import { canAddTvmtResult, canCreateTvmtRequest } from '@/lib/tvmt-field-updates'
import {
  getCurrentPstoCycle,
  getNextPstoCycleSequence,
  getPstoTvmtWorkflowLabel,
  getPstoTvmtWorkflowState,
} from '@/lib/tvmt-cycle'

export type JointNextActionKind =
  | 'editWeld'
  | 'preLnkRequest'
  | 'preLnkResult'
  | 'pstoRequest'
  | 'pstoResult'
  | 'tvmtRequest'
  | 'tvmtResult'
  | 'primaryLnkRequest'
  | 'primaryLnkResult'
  | 'dispatcherTask'
  | 'blocked'
  | 'complete'

export type JointNextAction = {
  key: string
  kind: JointNextActionKind
  title: string
  description: string
  buttonLabel?: string
  methodCode?: string
  taskKey?: string
  tone: 'default' | 'warning' | 'success'
}

export function buildJointNextActions(
  row: WeldRow,
  dispatcherTasks: readonly RepeatedJointTask[] = [],
): JointNextAction[] {
  const rowTasks = dispatcherTasks
    .filter((task) => isTaskForRow(task, row))
    .sort(compareTasks)
  const taskActions = rowTasks.map(buildDispatcherAction)
  const chainStructureActions = rowTasks
    .filter((task) => task.kind === 'create' || task.kind === 'coil' || task.kind === 'delete' || task.kind === 'rename')
    .map(buildDispatcherAction)

  if (chainStructureActions.length > 0) return chainStructureActions

  if (!hasWeldDate(row)) {
    return [
      {
        key: `edit-weld:${row.id}`,
        kind: 'editWeld',
        title: `Заполнить сварку ${formatJoint(row)}`,
        description: 'Стык уже создан, но без даты сварки дальнейший контроль не начинается.',
        buttonLabel: 'Открыть стык',
        tone: 'default',
      },
      ...taskActions,
    ]
  }

  const directAction = buildDirectWorkflowAction(row)
  if (directAction) return [directAction, ...taskActions]
  if (taskActions.length > 0) return taskActions

  const status = getJointStatusLabel(row)
  if (status === 'годен') {
    return [{
      key: `complete:${row.id}`,
      kind: 'complete',
      title: 'Работа по стыку завершена',
      description: 'Все обязательные этапы выполнены, итоговый статус стыка: годен.',
      tone: 'success',
    }]
  }

  if (status === 'не годен' || status === 'не годен по дублю') {
    return [{
      key: `rejected:${row.id}`,
      kind: 'blocked',
      title: 'Ожидается решение по негодному результату',
      description: 'Проверьте задачи диспетчера: система должна предложить следующий R/W-стык либо проверку цепочки.',
      tone: 'warning',
    }]
  }

  return [{
    key: `check:${row.id}`,
    kind: 'blocked',
    title: 'Нужно проверить данные стыка',
    description: text(row.activeDispatcherTasks) || text(row.dispatcherTasks)
      ? `Активные проверки: ${text(row.activeDispatcherTasks) || text(row.dispatcherTasks)}.`
      : 'Следующее профильное действие не определено. Проверьте назначения, документы и активные ДЗ/ЗВ ниже.',
    tone: 'warning',
  }]
}

function buildDirectWorkflowAction(row: WeldRow): JointNextAction | null {
  const pstoState = getPstoTvmtWorkflowState(row)
  const currentCycle = getCurrentPstoCycle(row)
  const activePhysicalCycleAction = buildActivePhysicalCycleAction(row, pstoState, currentCycle?.sequence ?? 1)
  if (activePhysicalCycleAction) return activePhysicalCycleAction

  const preRequestMethods = getAvailablePreHeatTreatmentRequestMethods(row)
  if (preRequestMethods.length > 0) {
    return buildControlAction({
      row,
      kind: 'preLnkRequest',
      title: 'Создать заявку НК до ТО',
      description: `Ожидают заявки: ${preRequestMethods.map((method) => method.code).join(', ')}.`,
      buttonLabel: 'Создать заявку',
      methodCode: preRequestMethods[0]?.code,
    })
  }

  const preResultMethods = getAvailablePreHeatTreatmentResultMethods(row)
  if (preResultMethods.length > 0) {
    return buildControlAction({
      row,
      kind: 'preLnkResult',
      title: 'Внести результат НК до ТО',
      description: `Ожидают результата: ${preResultMethods.map((method) => method.code).join(', ')}.`,
      buttonLabel: 'Внести результат',
      methodCode: preResultMethods[0]?.code,
    })
  }

  if (canCreatePstoWorkflowRequest(row)) {
    const sequence = pstoState === 'repeat-psto-required'
      ? getNextPstoCycleSequence(row)
      : currentCycle?.sequence ?? 1
    return buildControlAction({
      row,
      kind: 'pstoRequest',
      title: sequence > 1 ? `Создать заявку повторной ПСТО · цикл ${sequence}` : 'Создать заявку ПСТО',
      description: sequence > 1
        ? 'Предыдущая ТВМТ не годна. Новый цикл относится только к этому стыку.'
        : 'НК до ТО завершён, можно начать физический цикл термообработки.',
      buttonLabel: 'Создать заявку',
    })
  }

  const primaryRequestMethods = getAvailableLnkRequestMethods(row)
  if (primaryRequestMethods.length > 0) {
    return buildControlAction({
      row,
      kind: 'primaryLnkRequest',
      title: 'Создать заявку основного НК',
      description: `Ожидают заявки: ${primaryRequestMethods.map((method) => method.code).join(', ')}.`,
      buttonLabel: 'Создать заявку',
      methodCode: primaryRequestMethods[0]?.code,
    })
  }

  const primaryResultMethods = getPendingLnkResultMethods(row)
    .filter((method) => isPrimaryLnkStageReady(row, method.code))
  if (primaryResultMethods.length > 0) {
    return buildControlAction({
      row,
      kind: 'primaryLnkResult',
      title: 'Внести результат основного НК',
      description: `Ожидают результата: ${primaryResultMethods.map((method) => method.code).join(', ')}.`,
      buttonLabel: 'Внести результат',
      methodCode: primaryResultMethods[0]?.code,
    })
  }

  if (pstoState !== 'not-required' && pstoState !== 'complete') {
    const reason = pstoState === 'waiting-psto-request'
      ? getPstoWorkflowRequestBlockReason(row)
      : `Текущий этап: ${getPstoTvmtWorkflowLabel(pstoState)}.`
    return {
      key: `blocked-psto:${row.id}:${pstoState}`,
      kind: 'blocked',
      title: 'Цикл ПСТО пока заблокирован',
      description: reason,
      tone: 'warning',
    }
  }

  const blockedPrimaryMethod = getPendingLnkResultMethods(row)
    .find((method) => getPrimaryLnkStageBlockReason(row, method.code))
  if (blockedPrimaryMethod) {
    return {
      key: `blocked-primary:${row.id}:${blockedPrimaryMethod.code}`,
      kind: 'blocked',
      title: `Основной ${blockedPrimaryMethod.code} пока недоступен`,
      description: getPrimaryLnkStageBlockReason(row, blockedPrimaryMethod.code),
      tone: 'warning',
    }
  }

  return null
}

function buildActivePhysicalCycleAction(
  row: WeldRow,
  pstoState: ReturnType<typeof getPstoTvmtWorkflowState>,
  sequence: number,
) {
  if (canAddPstoWorkflowResult(row)) {
    return buildControlAction({
      row,
      kind: 'pstoResult',
      title: `Внести результат ПСТО · цикл ${sequence}`,
      description: isPstoCancelledValue(row.pstoRequired)
        ? 'Линия ПСТО отменена, но по этому физическому циклу уже есть фактические данные. Завершите сохранение результата ПСТО.'
        : 'Физический цикл уже начат заявкой. Укажите дату ПСТО и диаграмму термообработки.',
      buttonLabel: 'Внести результат',
    })
  }
  if (canCreateTvmtRequest(row)) {
    return buildControlAction({
      row,
      kind: 'tvmtRequest',
      title: `Создать заявку ТВМТ · цикл ${sequence}`,
      description: isPstoCancelledValue(row.pstoRequired)
        ? 'Линия ПСТО отменена, но термообработка уже проведена. Закончите цикл твердометрией.'
        : 'ПСТО проведена. Закончите уже начатый физический цикл твердометрией.',
      buttonLabel: 'Создать заявку',
    })
  }
  if (canAddTvmtResult(row)) {
    return buildControlAction({
      row,
      kind: 'tvmtResult',
      title: `Внести результат ТВМТ · цикл ${sequence}`,
      description: isPstoCancelledValue(row.pstoRequired)
        ? 'Линия ПСТО отменена. Внесите фактический результат ТВМТ, чтобы закончить уже начатый цикл; новый повтор не откроется.'
        : 'После годной ТВМТ откроется основной НК. Негодная ТВМТ потребует повторную ПСТО.',
      buttonLabel: 'Внести результат',
    })
  }
  if (pstoState === 'repeat-psto-required' && canCreatePstoWorkflowRequest(row)) {
    return buildControlAction({
      row,
      kind: 'pstoRequest',
      title: `Создать заявку повторной ПСТО · цикл ${sequence + 1}`,
      description: 'Предыдущая ТВМТ не годна. Новый цикл относится только к этому стыку.',
      buttonLabel: 'Создать заявку',
    })
  }
  return null
}

function buildControlAction({
  row,
  kind,
  title,
  description,
  buttonLabel,
  methodCode,
}: {
  row: WeldRow
  kind: JointNextActionKind
  title: string
  description: string
  buttonLabel: string
  methodCode?: string
}): JointNextAction {
  return {
    key: `${kind}:${row.id}:${methodCode ?? ''}`,
    kind,
    title,
    description,
    buttonLabel,
    methodCode,
    tone: 'default',
  }
}

function buildDispatcherAction(task: RepeatedJointTask): JointNextAction {
  const code = getDispatcherTaskCode(task)
  const title = getRepeatedJointTaskTitle(task)
  const actionTitle = task.kind === 'create'
    ? `Создать ${task.targetJoint}`
    : task.kind === 'coil'
      ? `Создать катушку ${task.targetJoints.join(' + ')}`
      : `${code} · ${title.type}`
  return {
    key: `dispatcher:${task.key}`,
    kind: 'dispatcherTask',
    title: actionTitle,
    description: getRepeatedJointTaskDetails(task),
    buttonLabel: task.kind === 'create' || task.kind === 'coil' ? 'Перейти к созданию' : 'Открыть задачу',
    taskKey: task.key,
    tone: 'warning',
  }
}

function isTaskForRow(task: RepeatedJointTask, row: WeldRow) {
  if (task.row.id === row.id) return true
  if ('sourceRow' in task && task.sourceRow.id === row.id) return true
  return false
}

function compareTasks(left: RepeatedJointTask, right: RepeatedJointTask) {
  return getTaskPriority(left) - getTaskPriority(right) || left.key.localeCompare(right.key, 'ru')
}

function getTaskPriority(task: RepeatedJointTask) {
  if (task.kind === 'create' || task.kind === 'coil') return 0
  if (task.kind === 'delete' || task.kind === 'rename') return 1
  return 2
}

function formatJoint(row: WeldRow) {
  return text(row.joint) || `ID ${row.id}`
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
