import { and, or, sql } from 'drizzle-orm'

import { weldJoints } from '@/db/schema'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import {
  getPstoLineIdentityKey,
  normalizePstoLineIdentity,
  type PstoLineIdentity,
} from '@/lib/psto-line-assignment'
import { isCancelledControlValue } from '@/lib/report-value-utils'
import { hasPstoExecutionHistory } from '@/lib/psto-cycle'
import type { WeldInput } from '@/lib/weld-fields'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

type PstoWorkflowLineRow = {
  id?: number
  joint?: unknown
  projectTitle?: unknown
  subtitleCode?: unknown
  line?: unknown
  pstoRequired?: unknown
  pstoResult?: unknown
}

export async function assertPstoWorkflowLinesFullyAssigned(
  tx: Pick<SystemDocumentSequenceTransaction, 'select'>,
  selectedRows: readonly PstoWorkflowLineRow[],
  options: { allowPerformedHistoryRows?: boolean } = {},
) {
  const identities = uniqueLineIdentities(selectedRows)
  const missingLineRow = selectedRows.find((row) => !normalizePstoLineIdentity(row).line)
  if (missingLineRow) {
    throw new Error(
      `Стык ${formatJoint(missingLineRow)} не привязан к линии. Назначение ПСТО выполняется для всей линии.`,
    )
  }
  if (identities.length === 0) return

  const lineRows = await tx
    .select({
      projectTitle: weldJoints.projectTitle,
      subtitleCode: weldJoints.subtitleCode,
      line: weldJoints.line,
      pstoRequired: weldJoints.pstoRequired,
    })
    .from(weldJoints)
    .where(or(...identities.map(buildLineWhere)))

  const error = getPstoWorkflowLineAssignmentError(selectedRows, lineRows, options)
  if (error) throw new Error(error)
}

export function getPstoWorkflowLineAssignmentError(
  selectedRows: readonly PstoWorkflowLineRow[],
  lineRows: readonly PstoWorkflowLineRow[],
  options: { allowPerformedHistoryRows?: boolean } = {},
) {
  const stateByLine = new Map<string, { rowCount: number; assignedCount: number; cancelledCount: number }>()
  for (const row of lineRows) {
    const identity = normalizePstoLineIdentity(row)
    if (!identity.line) continue
    const key = getPstoLineIdentityKey(identity)
    const state = stateByLine.get(key) ?? { rowCount: 0, assignedCount: 0, cancelledCount: 0 }
    state.rowCount += 1
    if (isControlEnabledValue(row.pstoRequired)) state.assignedCount += 1
    if (isCancelledControlValue(row.pstoRequired)) state.cancelledCount += 1
    stateByLine.set(key, state)
  }

  for (const row of selectedRows) {
    const identity = normalizePstoLineIdentity(row)
    if (!identity.line) {
      return `Стык ${formatJoint(row)} не привязан к линии. Назначение ПСТО выполняется для всей линии.`
    }
    const state = stateByLine.get(getPstoLineIdentityKey(identity))
    const allowedPerformedHistoryRow = Boolean(
      options.allowPerformedHistoryRows &&
      hasPstoExecutionHistory(row as WeldInput, []),
    )
    if (!state || state.rowCount === 0 || (state.assignedCount !== state.rowCount && !allowedPerformedHistoryRow)) {
      return `Линия ${formatLineIdentity(identity)} имеет частичное или отсутствующее назначение ПСТО. Сначала выровняйте ее в «Программе ПСТО».`
    }
  }
  return null
}

function uniqueLineIdentities(rows: readonly PstoWorkflowLineRow[]) {
  const byKey = new Map<string, PstoLineIdentity>()
  for (const row of rows) {
    const identity = normalizePstoLineIdentity(row)
    if (!identity.line) continue
    byKey.set(getPstoLineIdentityKey(identity), identity)
  }
  return [...byKey.values()]
}

function buildLineWhere(identity: PstoLineIdentity) {
  return and(
    sql`btrim(coalesce(${weldJoints.projectTitle}, '')) = ${identity.projectTitle}`,
    sql`btrim(coalesce(${weldJoints.subtitleCode}, '')) = ${identity.subtitleCode}`,
    sql`btrim(coalesce(${weldJoints.line}, '')) = ${identity.line}`,
  )
}

function formatLineIdentity(identity: PstoLineIdentity) {
  return [identity.projectTitle, identity.subtitleCode, identity.line]
    .filter(Boolean)
    .join(' · ')
}

function formatJoint(row: PstoWorkflowLineRow) {
  return String(row.joint ?? row.id ?? '').trim() || 'без номера'
}
