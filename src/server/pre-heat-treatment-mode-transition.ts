import { eq, isNull, sql } from 'drizzle-orm'
import { appSettings, weldJoints, preHeatTreatmentControls } from '@/db/schema'
import { normalizeControlProcessSettings } from '@/lib/control-process-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { PRE_HEAT_SELECTED_TRANSITION_KEY, isCompletedTransition } from '@/lib/release-contract'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import { buildChainActualityGroups } from '@/lib/chain-actuality'
import { lockAllControlProcessSettings } from './control-process-settings-lock'
import { attachProgramChainStates } from './line-program-chain-state'
import { loadProgramSystemIndexSettings } from './line-program'
import { buildNumberArrayMatch } from './weld-request-utils'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Explicit release only. Read the OLD policy before normalizing its retired keys.
 * The readiness gate keeps new runtime semantics away from unconverted data. */
export async function initializePreHeatTreatmentMode(tx: SystemDocumentSequenceTransaction) {
  await lockAllControlProcessSettings(tx, 'exclusive')
  const [marker] = await tx.select().from(appSettings).where(eq(appSettings.key, PRE_HEAT_SELECTED_TRANSITION_KEY)).limit(1)
  if (isCompletedTransition(marker?.value)) return { skipped: true }
  await tx.execute(sql`lock table weld_joints, pre_heat_treatment_controls in share row exclusive mode`)
  const [stored] = await tx.select().from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses)).limit(1)
  let previous: Record<string, unknown> | null = null
  try { previous = stored ? JSON.parse(stored.value) : null } catch { /* old defaults */ }
  const [legacy] = await tx.select({ id: weldJoints.id }).from(weldJoints).where(isNull(weldJoints.preHeatTreatmentRequired)).limit(1)
  const full = previous?.preHeatTreatmentMode === 'allPsto' || previous?.preHeatTreatmentMode !== 'selected'
    && (previous ? previous.preHeatTreatmentLnkEnabled !== false : Boolean(legacy))
  let changed = 0
  if (full) {
    const rows = await attachProgramChainStates(await tx.select({ id: weldJoints.id, joint: weldJoints.joint,
      projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode, line: weldJoints.line,
      officiality: weldJoints.officiality, weldDate: weldJoints.weldDate, pstoRequired: weldJoints.pstoRequired,
      preHeatTreatmentRequired: weldJoints.preHeatTreatmentRequired,
    }).from(weldJoints), tx)
    const history = new Set((await tx.selectDistinct({ id: preHeatTreatmentControls.weldJointId }).from(preHeatTreatmentControls)).map(row => row.id))
    const settings = await loadProgramSystemIndexSettings(tx)
    // Explicit false was masked by full mode too: preserve CURRENT requirements,
    // not the dormant choice from an earlier temporary selective-mode session.
    const ids = buildChainActualityGroups(rows, settings).groups.flatMap(group =>
      group.rows.some(row => row.preHeatTreatmentRequired === true || isControlEnabledValue(row.pstoRequired) || history.has(row.id))
        ? group.rows.filter(row => row.preHeatTreatmentRequired !== true).map(row => row.id) : [])
    for (let offset = 0; offset < ids.length; offset += 5000) await tx.update(weldJoints).set({ preHeatTreatmentRequired: true,
      updatedAt: sql`greatest(clock_timestamp(), ${weldJoints.updatedAt} + interval '1 millisecond')`,
    }).where(buildNumberArrayMatch(weldJoints.id, ids.slice(offset, offset + 5000)))
    changed = ids.length
  }
  const next = normalizeControlProcessSettings(previous)
  await tx.insert(appSettings).values({ key: PROJECT_SETTING_KEYS.controlProcesses, value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(next), updatedAt: new Date() } })
  const value = JSON.stringify({ status: 'complete', previousFullMode: full, changed })
  await tx.insert(appSettings).values({ key: PRE_HEAT_SELECTED_TRANSITION_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
  return { skipped: false, mode: 'selected', previousFullMode: full, changed }
}
