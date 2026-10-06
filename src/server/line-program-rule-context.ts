import { sql } from 'drizzle-orm'
import { weldJoints, preHeatTreatmentControls, duplicateControls } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'
import { programJointIdentity } from '@/lib/line-program-topology'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'
import { loadProgramApprovals } from './program-approval-lifecycle'
import { attachProgramChainStates } from './line-program-chain-state'

/** Complete affected lines, compact columns and three batched relation reads. Never a
 * request for each edited row. Used under the same membership locks as the mutation.
 */
export async function loadProgramRuleContext(
  db: Pick<SystemDocumentSequenceTransaction, 'select'>,
  scope: readonly Pick<WeldInput, 'projectTitle' | 'subtitleCode' | 'line'>[],
  preHeatTreatmentLnkEnabled: boolean,
) {
  const identities = [...new Map(scope.map(row => [programJointIdentity(row as WeldRow, ''), row])).values()]
  const rows: WeldRow[] = []
  for (let offset = 0; offset < identities.length; offset += 500) {
    const tuples = identities.slice(offset, offset + 500).map(row => sql`(
      ${String(row.projectTitle ?? '').trim().toLocaleLowerCase('ru')},
      ${String(row.subtitleCode ?? '').trim().toLocaleLowerCase('ru')},
      ${String(row.line ?? '').trim().toLocaleLowerCase('ru')})`)
    const batch = await db.select({ id: weldJoints.id, projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode,
      line: weldJoints.line, joint: weldJoints.joint, officiality: weldJoints.officiality, revisionActuality: weldJoints.revisionActuality,
      connectionType: weldJoints.connectionType, weldDate: weldJoints.weldDate,
      hasVik: weldJoints.hasVik, hasPvk: weldJoints.hasPvk, hasRk: weldJoints.hasRk, hasUzk: weldJoints.hasUzk,
      vikResult: weldJoints.vikResult, pvkResult: weldJoints.pvkResult, rkResult: weldJoints.rkResult, uzkResult: weldJoints.uzkResult,
      layeredControlAssigned: weldJoints.layeredControlAssigned,
    }).from(weldJoints).where(sql`(lower(btrim(coalesce(${weldJoints.projectTitle}, ''))),
      lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))), lower(btrim(coalesce(${weldJoints.line}, '')))) in (${sql.join(tuples, sql`, `)})`)
    // A bounded line batch can still contain hundreds of thousands of joints.
    for (const row of batch) rows.push(row)
  }
  const byId = new Map(rows.map(row => { row.preHeatTreatmentLnkEnabled = preHeatTreatmentLnkEnabled; return [row.id, row] as const }))
  const ids = [...byId.keys()]
  if (ids.length) {
    const pre = await db.select().from(preHeatTreatmentControls).where(buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, ids))
    const duplicates = await db.select().from(duplicateControls).where(buildNumberArrayMatch(duplicateControls.weldJointId, ids))
    for (const control of pre) (byId.get(control.weldJointId)!.preHeatTreatmentControls ??= []).push(control)
    for (const control of duplicates) (byId.get(control.weldJointId)!.duplicateControls ??= []).push(control as NonNullable<WeldRow['duplicateControls']>[number])
  }
  await attachProgramChainStates(rows, db)
  const approved = new Set((await loadProgramApprovals(db, ids)).map(item => item.key))
  return { rows, approved }
}
