import {
  isAnyDispatcherSettingEnabled,
  isDispatcherSettingEnabled,
  isDispatcherTaskEnabled,
  isMandatoryDispatcherTask,
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
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import { getEarlyCoilDecisionSourceRowIds } from '@/lib/early-coil-decision'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import type { SaveCheckSettings } from './save-check-settings'
import type { createTechnologyCardReview } from '@/lib/technology-card-review'
import { buildTechnologyCardTasks } from '@/lib/technology-card-tasks'

const PERCENTAGE_LINE_DISPATCHER_SETTING_IDS = [
  'percentage-missing',
  'percentage-full-control',
  'percentage-excess',
  'percentage-new-welder',
  'percentage-rejected-rows',
  'percentage-suspend-welder',
] satisfies DispatcherSettingId[]

const LINE_CONSISTENCY_DISPATCHER_SETTING_IDS = [
  'line-control-presence',
  'line-psto-presence',
] satisfies DispatcherSettingId[]

export type BuildVisibleDispatcherTasksInput = {
  acceptedDispatcherWarningKeys: Set<string>
  dismissedRepeatedJointTaskKeys: Set<string>
  dispatcherReminderSettings: DispatcherReminderSettings
  dispatcherSettings: DispatcherSettings
  dataListSettings?: DataListSettings
  systemIndexSettings?: SystemIndexSettings
  controlProcessSettings?: ControlProcessSettings
  saveCheckSettings?: SaveCheckSettings
  technologyCardReview?: ReturnType<typeof createTechnologyCardReview>
  earlyCoilDecisionSourceRowIds?: Set<number>
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
  systemIndexSettings,
  controlProcessSettings,
  saveCheckSettings,
  technologyCardReview,
  earlyCoilDecisionSourceRowIds: preparedEarlyCoilIds,
  includeRepeatedJointTasks = true,
  includeWelderStampExpiryTasks = true,
  rows,
  welderStamps,
  welderStampSuspensions,
}: BuildVisibleDispatcherTasksInput) {
  const isHidden = (key: string) => dismissedRepeatedJointTaskKeys.has(key) || acceptedDispatcherWarningKeys.has(key)
  const earlyCoilDecisionSourceRowIds = preparedEarlyCoilIds ?? getEarlyCoilDecisionSourceRowIds(acceptedDispatcherWarningKeys)
  const repeatedJointTasks = includeRepeatedJointTasks
    ? [...buildRepeatedJointTasks(rows, welderStamps, welderStampSuspensions, {
        dataListSettings,
        earlyCoilDecisionSourceRowIds,
        acceptedProgramControlKeys: acceptedDispatcherWarningKeys,
        systemIndexSettings,
        controlProcessSettings,
        saveCheckSettings,
        includeControlHistoryChecks: isDispatcherSettingEnabled('check-control-history', dispatcherSettings),
        includeIncompleteStampChecks: isDispatcherSettingEnabled('check-incomplete-stamps', dispatcherSettings),
        includeJointCoreDataChecks: isDispatcherSettingEnabled('check-joint-core-data', dispatcherSettings),
        includeLineConsistencyTasks: isAnyDispatcherSettingEnabled(LINE_CONSISTENCY_DISPATCHER_SETTING_IDS, dispatcherSettings),
        includePercentageLineControlTasks: isAnyDispatcherSettingEnabled(PERCENTAGE_LINE_DISPATCHER_SETTING_IDS, dispatcherSettings),
        includeWelderStampCompatibilityChecks: isDispatcherSettingEnabled('check-welder-stamp', dispatcherSettings),
      }), ...(technologyCardReview && isDispatcherSettingEnabled('check-technology-card', dispatcherSettings)
        ? buildTechnologyCardTasks(rows, technologyCardReview) : [])].filter(
        (task) => isMandatoryDispatcherTask(task) ||
          (!isHidden(task.key) && isDispatcherTaskEnabled(task, dispatcherSettings)),
      )
    : []
  const welderStampExpiryTasks =
    !includeWelderStampExpiryTasks ||
    (!isDispatcherSettingEnabled('welder-stamp-expiry', dispatcherSettings) &&
      !isDispatcherSettingEnabled('welder-dls-expiry', dispatcherSettings))
      ? []
      : buildWelderStampExpiryTasks(welderStamps, dispatcherReminderSettings).filter(
          (task) => !isHidden(task.key) && isDispatcherTaskEnabled(task, dispatcherSettings),
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
    if (task.kind === 'check') task.actualityRowIds?.forEach(id => rowIds.add(id))
    if (task.kind === 'rename') {
      task.changes.forEach((change) => rowIds.add(change.rowId))
    }
    if (task.kind === 'percentage-line-control') {
      task.targetRowIds?.forEach((rowId) => rowIds.add(rowId))
    }
  }
  return rowIds
}
