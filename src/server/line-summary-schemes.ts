import { and, eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { linePrograms, lineSchemeBundles, lineSchemeRevisions } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LineSchemeCoverage } from '@/lib/line-summary'
import { programJointIdentity } from '@/lib/line-program-topology'
import { readSchemeLineMetrics, type SchemeDb } from './line-scheme-read'

/** Scheme edits do not invalidate joint calculations. Include their compact
 * version signature only in the line-summary cache key, without changing any
 * other report or invalidating the dispatcher on every point save. */
export async function readLineSchemeStatisticsVersion() {
  const result = await requireDb().execute<{ version: string }>(sql`
    select md5(coalesce(string_agg(concat(b.id, ':', b.version, ':', r.id, ':', r.version), ',' order by b.id), '')) as version
    from ${lineSchemeBundles} b left join ${lineSchemeRevisions} r on r.id = b.active_revision_id
  `)
  return result.rows[0].version
}

export async function readLineSummarySchemes(db: SchemeDb, rows: readonly WeldRow[]) {
  const keys = new Set(rows.map(row => programJointIdentity(row, '')))
  if (!keys.size) return new Map<string, LineSchemeCoverage>()
  const lines = await db.select({ line_id: linePrograms.id, bundle_id: lineSchemeBundles.id,
    projectTitle: linePrograms.projectTitle, subtitleCode: linePrograms.subtitleCode, line: linePrograms.line,
    revisionId: lineSchemeRevisions.id,
  }).from(linePrograms).leftJoin(lineSchemeBundles, eq(lineSchemeBundles.lineProgramId, linePrograms.id))
    .leftJoin(lineSchemeRevisions, and(eq(lineSchemeRevisions.id, lineSchemeBundles.activeRevisionId), eq(lineSchemeRevisions.bundleId, lineSchemeBundles.id)))
  const selected = lines.filter(line => keys.has(programJointIdentity(line, '')))
  if (!selected.length) return new Map<string, LineSchemeCoverage>()
  const metrics = await readSchemeLineMetrics(db, selected)
  return new Map(selected.map(line => {
    const counts = metrics.get(line.line_id)!
    return [programJointIdentity(line, ''), { hasPdf: !!line.revisionId, total: counts.total, placed: counts.activePlacedCount }]
  }))
}
