import {
  isAnyDispatcherSettingEnabled,
  isDispatcherSettingEnabled,
  isDispatcherTaskEnabled,
  type DispatcherReminderSettings,
  type DispatcherSettingId,
  type DispatcherSettings,
} from '@/lib/dispatcher-settings'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'
import {
  buildRepeatedJointTasks,
} from '@/lib/repeated-joint-tasks'
import { buildWelderStampExpiryTasks } from '@/lib/welder-stamp-expiry-tasks'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import type { DataListSettings } from '@/lib/data-list-settings'

const PERCENTAGE_LINE_DISPATCHER_SETTING_IDS = [
  'percentage-missing',
  'percentage-full-control',
  'percentage-excess',
  'percentage-new-welder',
  'percentage-rejected-primary',
  'percentage-suspend-welder',
] satisfies DispatcherSettingId[]

const LINE_CONSISTENCY_DISPATCHER_SETTING_IDS = [
  'line-percent',
  'line-group',
  'line-category',
  'line-control-presence',
  'line-psto-presence',
] satisfies DispatcherSettingId[]

export type BuildVisibleDispatcherTasksInput = {
  acceptedDispatcherWarningKeys: Set<string>
  dismissedRepeatedJointTaskKeys: Set<string>
  dispatcherReminderSettings: DispatcherReminderSettings
  dispatcherSettings: DispatcherSettings
  dataListSettings?: DataListSettings
  includeRepeatedJointTasks?: boolean
  includeWelderStampExpiryTasks?: boolean
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
}

export function buildVisibleDispatcherTasks({
  acceptedDispatcherWarningKeys,
  dismissedRepeatedJointTaskKeys,
  dispatcherReminderSettings,
  dispatcherSettings,
  dataListSettings,
  includeRepeatedJointTasks = true,
  includeWelderStampExpiryTasks = true,
  rows,
  welderStamps,
  welderStampSuspensions,
}: BuildVisibleDispatcherTasksInput) {
  const hiddenDispatcherTaskKeys = new Set([...dismissedRepeatedJointTaskKeys, ...acceptedDispatcherWarningKeys])
  const repeatedJointTasks = includeRepeatedJointTasks
    ? buildRepeatedJointTasks(rows, welderStamps, welderStampSuspensions, {
        dataListSettings,
        includeIncompleteStampChecks: isDispatcherSettingEnabled('check-incomplete-stamps', dispatcherSettings),
        includeLineConsistencyTasks: isAnyDispatcherSettingEnabled(LINE_CONSISTENCY_DISPATCHER_SETTING_IDS, dispatcherSettings),
        includePercentageLineControlTasks: isAnyDispatcherSettingEnabled(PERCENTAGE_LINE_DISPATCHER_SETTING_IDS, dispatcherSettings),
        includeWelderStampCompatibilityChecks: isDispatcherSettingEnabled('check-welder-stamp', dispatcherSettings),
      }).filter(
        (task) => !hiddenDispatcherTaskKeys.has(task.key) && isDispatcherTaskEnabled(task, dispatcherSettings),
      )
    : []
  const welderStampExpiryTasks =
    !includeWelderStampExpiryTasks ||
    (!isDispatcherSettingEnabled('welder-stamp-expiry', dispatcherSettings) &&
      !isDispatcherSettingEnabled('welder-dls-expiry', dispatcherSettings))
      ? []
      : buildWelderStampExpiryTasks(welderStamps, dispatcherReminderSettings).filter(
          (task) => !hiddenDispatcherTaskKeys.has(task.key) && isDispatcherTaskEnabled(task, dispatcherSettings),
        )

  return {
    repeatedJointTasks,
    welderStampExpiryTasks,
  }
}

export function getDispatcherTaskRowIds(tasks: DispatcherTask[]) {
  const rowIds = new Set<number>()
  for (const task of tasks) {
    if (task.kind === 'welder-stamp-expiry') continue
    rowIds.add(task.row.id)
    if (task.kind === 'percentage-line-control') {
      task.targetRowIds?.forEach((rowId) => rowIds.add(rowId))
    }
  }
  return rowIds
}
