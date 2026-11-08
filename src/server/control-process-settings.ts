import { eq, sql } from 'drizzle-orm'

import {
  appSettings,
  weldJoints,
  preHeatTreatmentControls,
} from '@/db/schema'
import {
  DEFAULT_CONTROL_PROCESS_SETTINGS,
  normalizeControlProcessSettings,
} from '@/lib/control-process-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  lockAllControlProcessSettings,
  lockControlProcessSettings,
} from '@/server/control-process-settings-lock'
import type { GeneratedDocumentsTransaction } from '@/server/generated-document-number-sequence'
import { attachProgramChainStates } from './line-program-chain-state'
import { buildChainActualityGroups } from '@/lib/chain-actuality'
import { loadProgramSystemIndexSettings } from './line-program'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import { buildNumberArrayMatch } from './weld-request-utils'

export async function loadControlProcessSettingsFromTransaction(
  tx: Pick<GeneratedDocumentsTransaction, 'execute' | 'select'>,
) {
  await lockAllControlProcessSettings(tx)
  const [stored] = await tx
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses))
    .limit(1)
  if (!stored) return DEFAULT_CONTROL_PROCESS_SETTINGS
  try {
    return normalizeControlProcessSettings(JSON.parse(stored.value))
  } catch {
    return DEFAULT_CONTROL_PROCESS_SETTINGS
  }
}

export async function prepareControlProcessSettingsChangeInTransaction({
  tx,
  currentValue,
  nextValue,
  processLocksAlreadyHeld = false,
}: {
  tx: GeneratedDocumentsTransaction
  currentValue: unknown
  nextValue: unknown
  processLocksAlreadyHeld?: boolean
}) {
  const current = normalizeControlProcessSettings(currentValue)
  const next = normalizeControlProcessSettings(nextValue)
  const preHeatTreatmentChanged = current.preHeatTreatmentMode !== next.preHeatTreatmentMode
  const pvkGoodOnlyChanged = current.pvkGoodOnly !== next.pvkGoodOnly

  // Keep this order aligned with weld mutations that can touch both processes.
  if (preHeatTreatmentChanged && !processLocksAlreadyHeld) {
    await lockControlProcessSettings(tx, 'preHeatTreatmentLnk', 'exclusive')
  }
  if (pvkGoodOnlyChanged && !processLocksAlreadyHeld) {
    await lockControlProcessSettings(tx, 'layeredControl', 'exclusive')
  }

  if (current.preHeatTreatmentMode === 'allPsto' && next.preHeatTreatmentMode === 'selected') {
    // Initialize only legacy undecided rows. Explicit selective choices survive
    // subsequent mode changes; newly recorded history must never be hidden.
    const rows = await attachProgramChainStates(await tx.select({ id: weldJoints.id, joint: weldJoints.joint,
      projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode, line: weldJoints.line,
      officiality: weldJoints.officiality, weldDate: weldJoints.weldDate, pstoRequired: weldJoints.pstoRequired,
      preHeatTreatmentRequired: weldJoints.preHeatTreatmentRequired,
    }).from(weldJoints), tx)
    const history = new Set((await tx.selectDistinct({ id: preHeatTreatmentControls.weldJointId }).from(preHeatTreatmentControls)).map(row => row.id))
    const settings = await loadProgramSystemIndexSettings(tx)
    const ids = buildChainActualityGroups(rows, settings).groups.flatMap(group =>
      group.rows.some(row => history.has(row.id) || row.preHeatTreatmentRequired === true ||
        row.preHeatTreatmentRequired == null && isControlEnabledValue(row.pstoRequired))
        ? group.rows.filter(row => row.preHeatTreatmentRequired !== true).map(row => row.id) : [])
    for (let offset = 0; offset < ids.length; offset += 5000) {
      await tx.update(weldJoints).set({ preHeatTreatmentRequired: true,
        updatedAt: sql`greatest(clock_timestamp(), ${weldJoints.updatedAt} + interval '1 millisecond')`,
      }).where(buildNumberArrayMatch(weldJoints.id, ids.slice(offset, offset + 5000)))
    }
  }

  return next
}
