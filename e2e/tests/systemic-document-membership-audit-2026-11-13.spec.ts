import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { expect, test } from '@playwright/test'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'

type Pair = { document_id: number; weld_joint_id: number }
type MembershipChange = { entity_id: string; joint_id: number; kind: string; changes: Record<string, { before?: unknown; after?: unknown }> }

test('real request composition RPC preserves every membership history pair and omits unchanged rebuilt links', async ({ page, baseURL }, info) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Exercises the built HTTP RPC middleware and audit transaction')
  const suffix = randomUUID(), project = `AUDIT-MEMBERSHIP-${suffix}`
  const names = [`AUDIT-A-${suffix}`, `AUDIT-B-${suffix}`], requestDate = '2026-01-02'
  const operations: string[] = [], evidence: unknown[] = []
  const ids = await withE2eDatabase(async db => {
    const lineId = (await db.query(`insert into line_programs(project_title,subtitle_code,line,psto_assignment)
      values($1,'AUDIT','L','unassigned') returning id`, [project])).rows[0].id
    return (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,
      connection_type,weld_date,stamp_1_k,officiality,revision_actuality,has_vik,vik_request,vik_request_date,vik_result,final_status)
      select $1,$2,'AUDIT','L','F'||n,'С17','2026-01-01','AAAA',null,'актуальная','да',
        case when n=1 then $3 when n=4 then $4 else null end,
        case when n in (1,4) then $5::date else null end,
        case when n in (1,4) then 'ожидает НК' else null end,
        case when n in (1,4) then 'ожидает НК' else 'ожидает заявку' end
      from generate_series(1,6) n returning id`, [lineId, project, ...names, requestDate])).rows.map(row => row.id as number)
  })
  try {
    const owners = await withE2eDatabase(async db => (await db.query<{ id: string; name: string }>(
      `select u.id,u.name from auth_users u join auth_owner o on o.user_id=u.id
       where u.email='owner@e2e.test' and u.status='active'`)).rows)
    expect(owners).toHaveLength(1)
    const owner = owners[0]
    // Fixture setup has no account context. The measured changes below all go
    // through the actual public RPC, never a fabricated audit operation.
    await requireDb().transaction(async tx => {
      const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
      await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    })
    const docs = await withE2eDatabase(async db => (await db.query(
      'select id,title from generated_documents where title=any($1::text[]) order by title', [names])).rows as { id: number; title: string }[])
    expect(docs).toHaveLength(2)
    const docIds = names.map(name => docs.find(doc => doc.title === name)!.id)
    // Replacing an unchanged membership can refresh this timestamp; the guide
    // promises full business history, not spurious timestamp-only link edits.
    await withE2eDatabase(db => db.query("update generated_document_weld_joints set created_at='2020-01-01' where document_id=any($1::int[])", [docIds]))
    const pairs = () => withE2eDatabase(async db => (await db.query<Pair>(
      'select document_id,weld_joint_id from generated_document_weld_joints where document_id=any($1::int[]) order by document_id,weld_joint_id', [docIds])).rows)
    const sorted = (values: Pair[]) => values.slice().sort((a, b) => a.document_id - b.document_id || a.weld_joint_id - b.weld_joint_id)
    expect(await pairs()).toEqual(sorted([{ document_id: docIds[0], weld_joint_id: ids[0] }, { document_id: docIds[1], weld_joint_id: ids[3] }]))

    let observed = ''
    page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
    await page.goto('/account?tab=profile')
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    const call = async (operation: string, data: unknown) => {
      const response = await page.request.post(siblingRpcUrl(observed, `${operation}_createServerFn_handler`), {
        data: await serializeRpcData(data), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin',
          'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
      })
      const decoded = await deserializeRpcResponse(await response.text()) as { result?: any; error?: Error }
      expect(decoded.error, `${operation}: ${decoded.error?.message ?? ''}`).toBeUndefined()
      return decoded.result
    }
    const membershipHistory = async (operationId: string) => withE2eDatabase(async db => (await db.query<MembershipChange>(
      `select entity_id,joint_id,kind,changes from audit_changes
       where operation_id=$1 and entity='generated_document_weld_joints' order by entity_id`, [operationId])).rows)
    const run = async (operation: string, data: unknown, expected: { documentId: number; rowIds: number[]; kind: 'create' | 'delete' }) => {
      const afterId = await withE2eDatabase(async db => Number((await db.query('select coalesce(max(id),0) id from audit_changes')).rows[0].id))
      await call(operation, data)
      const saved = await withE2eDatabase(async db => (await db.query(`select distinct o.id,o.action,o.actor_id,o.actor_name from audit_operations o
        join audit_changes c on c.operation_id=o.id where c.id>$1 and c.joint_id=any($2::int[])`, [afterId, ids])).rows)
      operations.push(...saved.map(row => row.id))
      expect(saved).toHaveLength(1)
      expect(saved[0]).toMatchObject({ action: operation, actor_id: owner.id, actor_name: owner.name })
      const changes = await membershipHistory(saved[0].id)
      evidence.push({ operation, operationId: saved[0].id, pairs: await pairs(), membershipChanges: changes })
      expect(changes.map(row => row.entity_id).sort()).toEqual(expected.rowIds.map(id => `${expected.documentId}:${id}`).sort())
      expect(changes.map(row => row.joint_id).sort((a, b) => a - b)).toEqual(expected.rowIds.slice().sort((a, b) => a - b))
      for (const row of changes) {
        expect(row.kind).toBe(expected.kind)
        expect(Object.keys(row.changes).sort()).toEqual(['documentId', 'weldJointId'])
        const side = expected.kind === 'create' ? 'after' : 'before'
        expect(row.changes.documentId[side]).toBe(expected.documentId)
        expect(row.changes.weldJointId[side]).toBe(row.joint_id)
        const otherSide = side === 'before' ? 'after' : 'before'
        expect(row.changes.documentId).not.toHaveProperty(otherSide)
        expect(row.changes.weldJointId).not.toHaveProperty(otherSide)
      }
      // The real history RPC returns every stored relation in its joint's
      // history. Collapsing technical details in the UI must not erase it.
      for (const jointId of expected.rowIds) {
        const details = await call('getActivityDetails', { operationId: saved[0].id, jointId })
        const links = details.rows.filter((row: { entity: string }) => row.entity === 'generated_document_weld_joints')
        expect(links).toHaveLength(1)
        expect(links[0]).toMatchObject({ entityId: `${expected.documentId}:${jointId}`, jointId, kind: expected.kind })
      }
      return { id: saved[0].id as string, changes }
    }

    const addedA = await run('extendLnkRequest', { requestName: names[0], requestDate,
      targets: ids.slice(1, 3).map(rowId => ({ rowId, methodKey: 'vikRequest' })) },
    { documentId: docIds[0], rowIds: ids.slice(1, 3), kind: 'create' })
    expect(await pairs()).toEqual(sorted([
      ...ids.slice(0, 3).map(weld_joint_id => ({ document_id: docIds[0], weld_joint_id })),
      { document_id: docIds[1], weld_joint_id: ids[3] },
    ]))
    const addedB = await run('extendLnkRequest', { requestName: names[1], requestDate,
      targets: ids.slice(4, 6).map(rowId => ({ rowId, methodKey: 'vikRequest' })) },
    { documentId: docIds[1], rowIds: ids.slice(4, 6), kind: 'create' })
    const allPairs = sorted(docIds.flatMap((document_id, index) => ids.slice(index * 3, index * 3 + 3).map(weld_joint_id => ({ document_id, weld_joint_id }))))
    expect(await pairs()).toEqual(allPairs)
    const expectedVersions = await withE2eDatabase(async db => (await db.query(
      'select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [ids.slice(0, 3)])).rows)
    await run('manageLnkRequestDocument', { action: 'delete', requestName: names[0], requestDate, expectedVersions },
      { documentId: docIds[0], rowIds: ids.slice(0, 3), kind: 'delete' })
    expect(await pairs()).toEqual(allPairs.filter(pair => pair.document_id === docIds[1]))
    // Removing the document does not rewrite its earlier relation history.
    expect(await membershipHistory(addedA.id)).toEqual(addedA.changes)
    expect(await membershipHistory(addedB.id)).toEqual(addedB.changes)
  } finally {
    await writeFile(info.outputPath('document-membership-history.json'), JSON.stringify(evidence, null, 2))
    await page.close()
    await cleanupLineProgramProjects([project])
    if (operations.length) await withE2eDatabase(async db => {
      await db.query('delete from audit_changes where operation_id=any($1::text[])', [operations])
      await db.query('delete from audit_operations where id=any($1::text[])', [operations])
    })
  }
})
