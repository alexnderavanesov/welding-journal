import { createServerOnlyFn } from '@tanstack/react-start'
import { and, eq, ne, sql } from 'drizzle-orm'
import { weldJoints, workClosures } from '@/db/schema'
import { hasPermission } from '@/lib/access-permissions'
import { closureDisplayFields, readClosureColumnFilters, type WorkClosure, type WorkClosureFilter } from '@/lib/work-closures'
import { accessContext } from './access-store'

export function workClosurePositionWhere(filter: WorkClosureFilter) {
  const matches = (column: typeof workClosures.workType | typeof workClosures.rateCode | typeof workClosures.actNumber, values?: string[]) =>
    values?.length ? sql`${column} = any(${sql.param(values)}::text[])` : undefined
  return and(matches(workClosures.workType, filter.workType), matches(workClosures.rateCode, filter.rateCode),
    filter.rateAssigned ? ne(workClosures.rateCode, '') : undefined, matches(workClosures.actNumber, filter.actNumber))
}

export function workClosureWhere(filter: WorkClosureFilter) {
  const sameJoint = eq(workClosures.weldJointId, weldJoints.id)
  if (filter.noWorks) return sql`not exists (select 1 from ${workClosures} where ${sameJoint})`
  return sql`exists (select 1 from ${workClosures} where ${and(sameJoint, workClosurePositionWhere(filter))})`
}

// Project the page's matching positions once, preserving the association and literal free-text values.
export const selectClosurePositions = createServerOnlyFn((columns: Record<string, string>) => {
  const identity = accessContext.getStore()?.identity
  if (identity && !hasPermission(identity, 'closures.view')) return { closurePositions: sql<null>`null` }
  const match = and(eq(workClosures.weldJointId, weldJoints.id), workClosurePositionWhere(readClosureColumnFilters(columns)))
  return { closurePositions: sql<WorkClosure[] | null>`(select json_agg(json_build_object(
    'workType', ${workClosures.workType}, 'rateCode', ${workClosures.rateCode}, 'actNumber', ${workClosures.actNumber}))
    from ${workClosures} where ${match})` }
})

export function projectClosureRow<T extends { id: number; closurePositions?: WorkClosure[] | null }>(row: T, format: 'report' | 'grid' = 'report') {
  if (!('closurePositions' in row)) return row
  const { closurePositions, ...facts } = row
  return closurePositions?.length ? { ...facts, ...closureDisplayFields(closurePositions, format) } : facts
}
