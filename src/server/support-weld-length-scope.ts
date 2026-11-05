import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { weldJoints, weldJointProgramStates } from '@/db/schema'
import { isTConnectionType } from '@/lib/connection-type'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ProgramChainState } from '@/lib/line-program-chain-state'
import type { WeldInput } from '@/lib/weld-fields'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'
import { haveSameWeldLineMemberships, lockWeldLineMemberships } from './weld-line-membership-lock'
import { supportConnectionTypeWhere } from './connection-type-sql'

const source = alias(weldJoints, 'length_source')
const sourceState = alias(weldJointProgramStates, 'length_source_state')

/** Stable physical links cross line/name boundaries. The root and its persisted
 * descendants are fetched in one indexed query, including moved history. */
export async function loadSupportLengthChainRows(tx: Pick<SystemDocumentSequenceTransaction, 'select'>, ids: readonly number[]): Promise<WeldRow[]> {
  if (!ids.length) return []
  const roots = tx.select({ id: sql<number>`coalesce(${sourceState.physicalRootId}, ${source.id})` }).from(source)
    .leftJoin(sourceState, eq(sourceState.weldJointId, source.id))
    .where(and(buildNumberArrayMatch(source.id, ids), supportConnectionTypeWhere(source.connectionType)))
  const rows = await tx.select({ row: { id: weldJoints.id, projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode,
    line: weldJoints.line, joint: weldJoints.joint, officiality: weldJoints.officiality, weldDate: weldJoints.weldDate,
    connectionType: weldJoints.connectionType, weldLength: weldJoints.weldLength }, state: weldJointProgramStates })
    .from(weldJoints).leftJoin(weldJointProgramStates, eq(weldJointProgramStates.weldJointId, weldJoints.id))
    .where(or(inArray(weldJoints.id, roots), inArray(weldJointProgramStates.physicalRootId, roots)))
    .orderBy(asc(weldJoints.id))
  return rows.map(({ row, state }) => ({ ...row, ...(state ? { programChainState: state as ProgramChainState } : {}) }))
}

/** Acquire every affected line before any weld-row lock. Recheck the snapshot
 * after acquiring the sorted union, so a concurrent move/creation cannot escape
 * propagation or cause us to acquire a new line lock in the opposite order. */
export async function lockSupportWeldLengthMemberships(
  tx: SystemDocumentSequenceTransaction,
  identities: readonly { projectTitle?: unknown; subtitleCode?: unknown; line?: unknown }[],
  submitted: readonly WeldInput[],
) {
  const ids = [...new Set(submitted.filter(row => row.id && Object.hasOwn(row, 'weldLength') &&
    (!row.connectionType || isTConnectionType(row.connectionType))).map(row => Number(row.id)))].sort((a, b) => a - b)
  if (!ids.length) return lockWeldLineMemberships(tx, identities)
  const snapshot = await loadSupportLengthChainRows(tx, ids)
  await lockWeldLineMemberships(tx, [...identities, ...snapshot])
  if (!snapshot.length) return
  const current = await loadSupportLengthChainRows(tx, ids)
  const roots = new Map(snapshot.map(row => [row.id, row.programChainState?.physicalRootId]))
  if (!haveSameWeldLineMemberships(snapshot, current) || current.some(row => roots.get(row.id) !== row.programChainState?.physicalRootId)) {
    throw new Error('Состав или расположение ремонтной цепочки изменились. Ничего не сохранено; обновите данные.')
  }
}
