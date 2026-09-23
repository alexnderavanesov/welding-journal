import { asc } from 'drizzle-orm'

import { weldJoints, type WeldJoint } from '@/db/schema'
import {
  assertCurrentInteractiveWeldRowVersions,
  type WeldRowVersionTarget,
} from '@/lib/weld-row-version'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'
import { WELD_TABLE_RETURNING } from '@/server/weld-server-shared'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

type VersionedWeldJoint = WeldJoint & { rowVersion: string }

export function assertExpectedInteractiveWeldVersions(
  targetIds: readonly number[],
  expectedVersions: readonly WeldRowVersionTarget[],
  currentRows: readonly {
    id: number
    line?: unknown
    joint?: unknown
    rowVersion?: string
  }[],
) {
  assertCurrentInteractiveWeldRowVersions({
    targetIds,
    expectedVersions,
    currentVersions: currentRows.map((row) => ({
      id: row.id,
      line: normalizeVersionLabelPart(row.line),
      joint: normalizeVersionLabelPart(row.joint),
      version: String(row.rowVersion ?? '').trim(),
    })),
  })
}

function normalizeVersionLabelPart(value: unknown) {
  return value == null ? null : String(value)
}

export async function lockInteractiveWeldRows(
  tx: SystemDocumentSequenceTransaction,
  targetIds: readonly number[],
) {
  const ids = [...new Set(targetIds
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))]
    .sort((left, right) => left - right)
  if (ids.length === 0) return []
  return tx
    .select(WELD_TABLE_RETURNING)
    .from(weldJoints)
    .where(buildNumberArrayMatch(weldJoints.id, ids))
    .orderBy(asc(weldJoints.id))
    .for('update') as Promise<VersionedWeldJoint[]>
}

export async function lockAndAssertInteractiveWeldVersions(
  tx: SystemDocumentSequenceTransaction,
  targetIds: readonly number[],
  expectedVersions: readonly WeldRowVersionTarget[],
) {
  const rows = await lockInteractiveWeldRows(tx, targetIds)
  assertExpectedInteractiveWeldVersions(targetIds, expectedVersions, rows)
  return rows
}
