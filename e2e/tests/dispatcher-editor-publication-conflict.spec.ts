import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'

// This preserves evidence of a limitation, not an acceptance assertion for
// editing during a cold calculation. A stale edit must not overwrite a row.
test('publication-only status change rejects an old editor version without saving its draft', async ({ request, baseURL }, info) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Uses the compiled real RPC manifest')
  const directory = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
  const manifest = readFileSync(resolve(directory, readdirSync(directory).find(name => name.includes('tanstack-start-server-fn-resolver'))!), 'utf8')
  const observed = `${baseURL}/_serverFn/${manifest.match(/"([a-f0-9]{64})":/)![1]}`
  const call = async (name: string, data: unknown, method: 'GET' | 'POST' = 'POST') => {
    const url = new URL(siblingRpcUrl(observed, `${name}_createServerFn_handler`))
    const encoded = await serializeRpcData(data)
    if (method === 'GET') url.searchParams.set('payload', encoded)
    const response = await request.fetch(url.toString(), {
      method, ...(method === 'POST' ? { data: encoded } : {}),
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    return await deserializeRpcResponse(await response.text()) as { result?: Record<string, unknown>; error?: Error }
  }
  const projectTitle = `Publication conflict ${randomUUID()}`
  try {
    await withLineProgramFixture(db => db.query(`insert into line_programs
      (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,psto_assignment)
      values($1,'VERSION','PUBLICATION','II','A',100,100,'unassigned')`, [projectTitle]))
    const created = await call('createWeldJoint', {
      projectTitle, subtitleCode: 'VERSION', line: 'PUBLICATION', joint: 'S1',
      connectionType: 'С17', weldingMethod: 'РД', materialGroup: 'М01', d1: 57, d2: 57, t1: 3, t2: 3,
    })
    expect(created.error).toBeUndefined()
    const id = Number(created.result!.id)
    // Represents a legacy/missing calculated value BEFORE opening the card.
    // After that read no user changes any field; only the real engine publishes.
    await withE2eDatabase(db => db.query('update weld_joints set final_status=null where id=$1', [id]))
    const opened = await call('getWeldJointById', { id }, 'GET')
    expect(opened.error).toBeUndefined()
    expect(opened.result!.finalStatus).toBeNull()
    const stored = () => withE2eDatabase(async db => (await db.query(
      'select xmin::text version,to_jsonb(w) facts from weld_joints w where id=$1', [id])).rows[0])
    const before = await stored()
    expect(opened.result!.rowVersion).toBe(before.version)
    const refresh = await call('refreshDispatcherTaskSnapshot', {})
    expect(refresh.error).toBeUndefined()
    expect(refresh.result!.isFresh).toBe(true)
    const after = await stored()
    expect(after.version).not.toBe(before.version)
    expect(after.facts.final_status).toBe('ожидает сварку')
    expect({ ...after.facts, final_status: null }).toEqual(before.facts)
    for (let attempt = 0; attempt < 2; attempt++) {
      const saved = await call('updateWeldJoint', { id, expectedVersion: opened.result!.rowVersion, isometry: 'UNSAVED-DRAFT' })
      expect(saved.error?.message).toContain('уже изменен другим пользователем или в другом окне')
      expect(await stored()).toEqual(after)
    }
    await info.attach('publication-only-conflict', { contentType: 'application/json', body: JSON.stringify({
      beforeVersion: before.version, afterVersion: after.version,
      changedFacts: ['final_status'], repeatSaveRejected: true, draftNotSaved: true,
    }) })
  } finally {
    await cleanupLineProgramProjects([projectTitle])
  }
})
