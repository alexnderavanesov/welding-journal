import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import type { WeldInput } from '@/lib/weld-fields'
import { getNewPreHeatTreatmentInheritance } from '@/lib/new-pre-heat-treatment'
import { applyPstoChainPolicy } from '@/lib/psto-chain-policy'
import { getPstoLineIdentityKey, normalizePstoLineIdentity } from '@/lib/psto-line-assignment'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import { loadProgramSystemIndexSettings, lineProgramWeldWhere } from './line-program'
import { overlayPstoProgramPolicies } from './psto-chain-policy'
import { attachProgramChainStates } from './line-program-chain-state'
import { assertSecurityScope } from './security-functions'
import { lockWeldLineMemberships } from './weld-line-membership-lock'

export type NewPreHeatTreatmentRequest = Pick<WeldInput, 'projectTitle' | 'subtitleCode' | 'line' | 'joint'>
export async function previewNewPreHeatTreatment({ data }: { data: NewPreHeatTreatmentRequest }) {
  await assertSecurityScope('entry')
  const identity = normalizePstoLineIdentity(data), identityKey = getPstoLineIdentityKey(identity)
  if (!identity.line) return { identityKey, applicable: false, inherited: false, required: false, rootJoint: '' }
  return requireDb().transaction(async tx => {
    await lockWeldLineMemberships(tx, [identity])
    const settings = await loadProgramSystemIndexSettings(tx)
    const rows = await attachProgramChainStates(await tx.select({ id: weldJoints.id, joint: weldJoints.joint,
      projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode, line: weldJoints.line,
      officiality: weldJoints.officiality, weldDate: weldJoints.weldDate,
      pstoRequired: weldJoints.pstoRequired, preHeatTreatmentRequired: weldJoints.preHeatTreatmentRequired,
    }).from(weldJoints).where(lineProgramWeldWhere(identity)), tx)
    const policies = await overlayPstoProgramPolicies(tx, [identity], new Map([[identityKey, {
      rowCount: rows.length, assignedCount: rows.filter(row => isControlEnabledValue(row.pstoRequired)).length,
      cancelledCount: rows.filter(row => row.pstoRequired === 'отменен').length,
    }]]))
    const record = applyPstoChainPolicy({ ...identity, joint: String(data.joint ?? ''), id: -1 }, policies.get(identityKey)!, settings)
    return { identityKey, applicable: isControlEnabledValue(record.pstoRequired), ...getNewPreHeatTreatmentInheritance(record, rows, settings) }
  })
}
