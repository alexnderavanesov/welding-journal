import { asc, inArray, sql, type SQL } from 'drizzle-orm'

import { weldJoints } from '@/db/schema'
import {
  getPstoLineIdentityKey,
  normalizePstoLineIdentity,
} from '@/lib/psto-line-assignment'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { splitNumberBatches } from '@/server/weld-request-utils'

type WeldLineIdentityInput = {
  projectTitle?: unknown
  subtitleCode?: unknown
  line?: unknown
}

export type WeldLineMembershipSnapshot = WeldLineIdentityInput & { id: number }

type WeldLineLockExecutor = {
  execute: (query: SQL) => PromiseLike<unknown>
}

const WELD_LINE_LOCK_PREFIX = 'weld-line-membership:'

export function getWeldLineMembershipLockKeys(
  identities: readonly WeldLineIdentityInput[],
) {
  return [...new Set(identities.flatMap((value) => {
    const identity = normalizePstoLineIdentity(value)
    return identity.line
      ? [`${WELD_LINE_LOCK_PREFIX}${getPstoLineIdentityKey(identity)}`]
      : []
  }))].sort()
}

export function getChangedWeldLineMemberships(
  previous: WeldLineIdentityInput,
  next: WeldLineIdentityInput,
) {
  return getPstoLineIdentityKey(previous) === getPstoLineIdentityKey(next)
    ? []
    : [previous, next]
}

export async function lockWeldLineMemberships(
  executor: WeldLineLockExecutor,
  identities: readonly WeldLineIdentityInput[],
) {
  const keys = getWeldLineMembershipLockKeys(identities)
  if (keys.length === 0) return

  for (let offset = 0; offset < keys.length; offset += 1000) {
    const values = sql.join(keys.slice(offset, offset + 1000).map((key) => sql`(${key})`), sql`, `)
    await executor.execute(sql`
      with "weld_line_lock_keys"("lock_key") as materialized (
        values ${values}
      ),
      "ordered_weld_line_lock_keys" as materialized (
        select "lock_key"
        from "weld_line_lock_keys"
        order by "lock_key"
      )
      select pg_advisory_xact_lock(hashtext("lock_key"))
      from "ordered_weld_line_lock_keys"
      order by "lock_key"
    `)
  }
}

export async function lockWeldLineMembershipsForWeldIds(
  tx: SystemDocumentSequenceTransaction,
  targetIds: readonly number[],
) {
  const ids = [...new Set(targetIds
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))]
    .sort((left, right) => left - right)
  const rows: WeldLineMembershipSnapshot[] = []
  for (const idBatch of splitNumberBatches(ids, 1000)) {
    rows.push(...await tx
      .select({
        id: weldJoints.id,
        projectTitle: weldJoints.projectTitle,
        subtitleCode: weldJoints.subtitleCode,
        line: weldJoints.line,
      })
      .from(weldJoints)
      .where(inArray(weldJoints.id, idBatch))
      .orderBy(asc(weldJoints.id)))
  }
  await lockWeldLineMemberships(tx, rows)
  return rows
}

export function haveSameWeldLineMemberships(
  snapshot: readonly WeldLineMembershipSnapshot[],
  currentRows: readonly WeldLineMembershipSnapshot[],
) {
  if (snapshot.length !== currentRows.length) return false
  const currentById = new Map(currentRows.map((row) => [row.id, row]))
  return snapshot.every((row) => {
    const current = currentById.get(row.id)
    return Boolean(current) && getPstoLineIdentityKey(row) === getPstoLineIdentityKey(current!)
  })
}
