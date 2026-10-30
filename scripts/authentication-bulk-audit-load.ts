import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { eq, sql } from 'drizzle-orm'
import type { requireDb } from '../src/db'
import * as schema from '../src/db/schema'
import type { AccessIdentity } from '../src/lib/access-permissions'
import { runWithAccess } from '../src/server/access-context'
import { auditSql } from '../src/server/audited-database'

/** The same whole-scope audit used by WDI recalculation, independently of formula cost. */
export async function measureBulkAuditLoad(db: ReturnType<typeof requireDb>, owner: AccessIdentity) {
  const target = new URL(process.env.DATABASE_URL!)
  assert.equal(target.hostname, '127.0.0.1')
  assert.match(target.pathname, /^\/welding_tracker_auth_20261029_\d+$/)
  const project = 'AUTH-BULK-AUDIT'
  for (const count of [20000, 200000]) {
    await db.execute(sql`insert into weld_joints(project_title,line,joint,wdi)
      select ${project},'BULK','F' || n::text,1 from generate_series(1,${count}::integer) n`)
    // Two documents per joint: document count is not inferred from page size.
    await db.execute(sql`insert into generated_documents(type,title,file_name,mime_type,wdi_total)
      select 'jsr',${project},'bulk-' || n::text || '.xlsx','application/test',1
      from generate_series(1,${count * 2}::integer) n`)
    const before = Number((await db.execute(sql`select count(*) from audit_changes`)).rows[0].count)
    const start = performance.now()
    await runWithAccess(owner, 'benchmarkBulkRecalculation', ['wdi.edit'], () => db.transaction(async tx => {
      const jointScope = eq(schema.weldJoints.projectTitle, project)
      const documentScope = eq(schema.generatedDocuments.title, project)
      await auditSql(tx, [{ table: schema.weldJoints, where: jointScope }], () => tx.execute(sql`update weld_joints set wdi=2 where project_title=${project}`))
      await auditSql(tx, [{ table: schema.generatedDocuments, where: documentScope }], () => tx.execute(sql`update generated_documents set wdi_total=2 where title=${project}`))
    }))
    const elapsedMs = Math.round(performance.now() - start)
    const after = Number((await db.execute(sql`select count(*) from audit_changes`)).rows[0].count)
    assert.equal(after - before, count * 3)
    assert.equal(Number((await db.execute(sql`select count(*) from weld_joints where project_title=${project} and wdi=2`)).rows[0].count), count)
    console.log('AUTH_BULK_AUDIT', JSON.stringify({ joints: count, documents: count * 2, details: after - before, elapsedMs,
      peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024), heapMB: Math.round(process.memoryUsage().heapUsed / 1024 ** 2) }))
    await db.delete(schema.weldJoints).where(eq(schema.weldJoints.projectTitle, project))
    await db.delete(schema.generatedDocuments).where(eq(schema.generatedDocuments.title, project))
  }
}
