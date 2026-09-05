import { getDispatcherTaskSettingId } from '@/lib/dispatcher-settings'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import { isUnofficialJoint } from '@/lib/joint-display'
import type { WorkflowRootCauseAction } from '@/lib/workflow-root-cause-actions'

export type DispatcherTaskActionId =
  | 'accept-warning'
  | 'assign-percentage-controls'
  | 'create-early-coil'
  | 'create-joint'
  | 'delete-joint'
  | 'edit-stamp'
  | 'edit-weld'
  | 'open-lnk'
  | 'open-psto'
  | 'open-psto-program'
  | 'open-root-cause'
  | 'open-stamp-registry'
  | 'rename-joint'
  | 'show-task'
  | 'skip-suspension'
  | 'suspend-welder'
  | 'toggle-officiality'

export type DispatcherTaskActionSpec = {
  id: DispatcherTaskActionId
  label: string
  tone?: 'default' | 'danger' | 'primary'
  key?: string
  rootCauseAction?: WorkflowRootCauseAction
}

type DispatcherTaskActionOptions = {
  canCreateEarlyCoil?: boolean
}

export function getDispatcherTaskActionSpecs(
  task: RepeatedJointTask,
  options: DispatcherTaskActionOptions = {},
): DispatcherTaskActionSpec[] {
  if (task.kind === 'create') {
    return compactActions([
      action('create-joint', `Создать ${task.targetJoint}`, 'primary'),
      action(
        'toggle-officiality',
        isUnofficialJoint(task.row) ? 'Сделать официальным' : 'Сделать неофициальным',
      ),
      options.canCreateEarlyCoil && !isUnofficialJoint(task.row)
        ? action('create-early-coil', 'Врезать катушку досрочно')
        : null,
      action('show-task', 'Показать в отчете'),
    ])
  }

  if (task.kind === 'coil') {
    return [
      action('create-joint', `Создать катушку ${task.targetJoints.join(' + ')}`, 'primary'),
      action(
        'toggle-officiality',
        isUnofficialJoint(task.row) ? 'Сделать официальным' : 'Сделать неофициальным',
      ),
      action('show-task', 'Показать в отчете'),
    ]
  }

  if (task.kind === 'delete') {
    return [
      action('delete-joint', `Удалить ${task.targetJoint}`, 'danger'),
      action('show-task', 'Показать в отчете'),
    ]
  }

  if (task.kind === 'rename') {
    return [
      action('rename-joint', `Переименовать в ${task.targetJoint}`, 'primary'),
      action('show-task', 'Показать в отчете'),
    ]
  }

  if (task.kind === 'percentage-line-control') {
    if (task.issue === 'missing') {
      return [
        action('assign-percentage-controls', 'Назначить контроль', 'primary'),
        action('show-task', 'Показать стыки'),
      ]
    }
    if (task.issue === 'new-welder') {
      return [
        action('edit-stamp', 'Исправить клеймо', 'primary'),
        action('accept-warning', 'Принять исключение'),
        action('show-task', 'Показать стыки'),
      ]
    }
    if (task.issue === 'rejected-primary') {
      return [
        action('toggle-officiality', 'Проверить официальность', 'primary'),
        action('accept-warning', 'Принять исключение'),
        action('show-task', 'Показать стыки'),
      ]
    }
    if (task.issue === 'suspend-welder') {
      return [
        action('suspend-welder', 'Оформить отстранение', 'primary'),
        action('skip-suspension', 'Не отстранять'),
        action('show-task', 'Показать стыки'),
      ]
    }
    return [
      action('show-task', 'Показать лишние назначения', 'primary'),
      action('accept-warning', 'Принять исключение'),
    ]
  }

  if (task.kind === 'line-consistency') {
    return task.fieldKey === 'pstoPresence'
      ? [
          action('open-psto-program', 'Открыть программу ПСТО', 'primary'),
          action('show-task', 'Показать линию'),
        ]
      : [action('show-task', 'Показать линию', 'primary')]
  }

  if (task.kind === 'duplicate-check') {
    return [action('show-task', 'Показать в отчете', 'primary')]
  }

  if (task.kind === 'check' && task.rootCauseActions?.length) {
    return [
      ...task.rootCauseActions.map((rootCauseAction) => ({
        id: 'open-root-cause' as const,
        key: rootCauseAction.key,
        label: rootCauseAction.label,
        tone: rootCauseAction.tone,
        rootCauseAction,
      })),
      action('show-task', 'Показать в отчете'),
    ]
  }

  const settingId = getDispatcherTaskSettingId(task)
  if (
    settingId === 'check-lnk-request-date-order' ||
    settingId === 'check-lnk-vik-date-order' ||
    settingId === 'check-lnk-vik-required' ||
    settingId === 'check-lnk-result-completeness'
  ) {
    return [action('open-lnk', 'Исправить в ЛНК', 'primary'), action('show-task', 'Показать в отчете')]
  }
  if (settingId === 'check-psto-request-date-order' || settingId === 'check-psto-result-completeness') {
    return [action('open-psto', 'Исправить в ПСТО', 'primary'), action('show-task', 'Показать в отчете')]
  }
  if (settingId === 'check-welder-stamp') {
    return [
      action('edit-weld', 'Исправить стык', 'primary'),
      action('open-stamp-registry', 'Открыть реестр клейм'),
      action('show-task', 'Показать в отчете'),
    ]
  }
  if (settingId === 'check-control-history') {
    return [
      action('open-lnk', 'Проверить ЛНК', 'primary'),
      action('open-psto', 'Проверить ПСТО'),
      action('edit-weld', 'Проверить назначения'),
    ]
  }
  if (
    settingId === 'check-repair-diameter' ||
    settingId === 'check-incomplete-stamps' ||
    settingId === 'check-joint-core-data' ||
    settingId === 'chain-date-order'
  ) {
    return [action('edit-weld', 'Исправить стык', 'primary'), action('show-task', 'Показать в отчете')]
  }

  return [action('show-task', 'Показать в отчете', 'primary')]
}

export function getDispatcherTaskScopeLabel(task: RepeatedJointTask) {
  if (task.kind === 'line-consistency') return 'Вся линия'
  if (task.kind === 'percentage-line-control') return 'Линия и клеймо'
  if (task.kind === 'duplicate-check') return 'Совпадающие стыки'
  if (task.kind === 'create' || task.kind === 'coil' || task.kind === 'delete' || task.kind === 'rename') {
    return 'Цепочка стыка'
  }
  return 'Этот стык'
}

export function canOpenDispatcherTaskPicture(task: RepeatedJointTask) {
  return task.kind !== 'line-consistency' && task.kind !== 'percentage-line-control'
}

function action(
  id: DispatcherTaskActionId,
  label: string,
  tone: DispatcherTaskActionSpec['tone'] = 'default',
): DispatcherTaskActionSpec {
  return { id, label, tone }
}

function compactActions(actions: Array<DispatcherTaskActionSpec | false | null | undefined>) {
  return actions.filter((item): item is DispatcherTaskActionSpec => Boolean(item))
}
