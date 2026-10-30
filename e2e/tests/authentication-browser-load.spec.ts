import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { auditSqlCount } from '../audit-sql'
import { rpcName, siblingRpcUrl, serializeRpcData, deserializeRpcResponse } from '../rpc'
import type { Permission } from '../../src/lib/access-permissions'
const LOAD_PERMISSIONS: Record<string, Permission[]> = {
  welding: ['welding.view', 'welding.edit', 'welding.import', 'welding.generate', 'welding.export', 'lnk.view', 'psto.view', 'lines.view', 'references.view', 'documents.view', 'documents.generate', 'documents.export', 'history.joint'],
  lnk: ['welding.view', 'lnk.view', 'lnk.edit', 'lnk.generate', 'lnk.export', 'psto.view', 'lines.view', 'references.view', 'documents.view', 'documents.generate', 'documents.export', 'history.joint'],
  psto: ['welding.view', 'lnk.view', 'psto.view', 'psto.edit', 'psto.generate', 'psto.export', 'lines.view', 'references.view', 'documents.view', 'documents.generate', 'documents.export', 'history.joint'],
}

const label = process.env.AUTH_BROWSER_LOAD
const project = 'AUTH BROWSER LOAD'
test.use({ trace: 'off', video: 'off' })
test('authentication: comparable table opening at 20k/200k and 25 authenticated users reading and saving', async ({ browser, baseURL }) => {
  test.skip(!label, 'Explicit isolated before/after measurement')
  test.setTimeout(900000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  const actors: Array<{ id: string; email: string; scope: 'welding' | 'lnk' | 'psto' }> = []
  try {
    for (const count of [20000, 200000]) {
      await cleanupLineProgramProjects([project])
      await withLineProgramFixture(async db => {
        await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,wdi)
          select $1,'AUTH','AUTH-'||((n-1)/1000)::text,'F'||n, date '2026-10-01','СШ',1 from generate_series(1,$2::int) n`, [project, count])
        await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where project_title=$1`, [project])
        await db.query('analyze weld_joints'); await db.query('analyze weld_joint_program_states')
      })
      const samples = []
      for (let round = -1; round < 3; round++) {
        const context = await browser.newContext({ baseURL, storageState: process.env.E2E_AUTH_STATE, viewport: { width: 1600, height: 1000 } })
        try {
          const page = await context.newPage(); let observed = ''; const calls: string[] = []; page.on('request', request => { if (request.url().includes('/_serverFn/')) { observed = request.url(); calls.push(rpcName(request.url())) } })
          const sqlBefore = round < 0 ? undefined : await auditSqlCount(), started = performance.now()
          await page.goto('/journal')
          await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
          await expect(page.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible({ timeout: 240000 })
          await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
          await expect(page.locator('.journal-grid-frame .ag-row[row-id]').first()).toBeVisible()
          const readyMs = performance.now() - started
          await page.waitForLoadState('networkidle')
          await page.waitForTimeout(550) // Let the SQL instrumentation publish; excluded from readyMs.
          if (round >= 0) samples.push({ readyMs: Math.round(readyMs), sql: sqlBefore === undefined ? null : (await auditSqlCount())! - sqlBefore, rpc: calls.length, names: calls })
          if (round >= 0) {
            const ids = await withE2eDatabase(async db => (await db.query('select id from weld_joints where project_title=$1 order by id limit 1000', [project])).rows.map(row => row.id))
            const call = async (name: string, data: unknown) => {
              const response = await context.request.post(siblingRpcUrl(observed, name + '_createServerFn_handler'), { data: await serializeRpcData(data), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
              const payload = await deserializeRpcResponse(await response.text()) as { result: any; error?: Error }
              if (payload.error) throw payload.error
              return payload.result
            }
            for (const size of [1, 1000]) {
              const rows = await call('listWeldJointRowsByIds', { ids: ids.slice(0, size) })
              expect(rows).toHaveLength(size)
              const beforeSave = await auditSqlCount(), startSave = performance.now()
              const saved = await call('updateWeldJoints', { records: rows.map((row: any) => ({ id: row.id, weldingJournalNote: `auth-${label}-${round}-${size}` })), expectedVersions: rows.map((row: any) => ({ id: row.id, version: row.rowVersion })), mutationScope: 'welding' })
              const saveMs = Math.round(performance.now() - startSave)
              expect(saved).toHaveLength(size)
              console.log('AUTH_BROWSER_SAVE', JSON.stringify({ label, count, size, round, ms: saveMs, sql: beforeSave === undefined ? null : (await auditSqlCount())! - beforeSave, rpc: 1 }))
            }
          }

        } finally { await context.close() }
      }
      console.log('AUTH_BROWSER_OPEN', JSON.stringify({ label, count, samples, browser: browser.version(), databasePool: process.env.DATABASE_POOL_MAX || '5' }))
      if (label === 'before') continue
      const password = randomUUID(), hash = await hashPassword(password)
      const jointIds = await withE2eDatabase(async db => (await db.query('select id from weld_joints where project_title=$1 order by id limit 25', [project])).rows.map(row => row.id as number))
      await withE2eDatabase(async db => {
        // PSTO notes are retained control history: an unassigned, empty joint
        // cannot acquire that history. Use a cancelled stage, where factual
        // notes are legitimate, without changing the timed baseline fixtures.
        await db.query("update weld_joints set psto_required='отменен' where id=any($1::int[])", [jointIds.filter((_, index) => index % 3 === 2)])
        for (let index = 0; index < 25; index++) {
          const scope = (['welding', 'lnk', 'psto'] as const)[index % 3], id = randomUUID(), email = `load-${id}@e2e.test`
          actors.push({ id, email, scope })
          await db.query("insert into auth_users(id,name,email,email_verified,status,role,permissions) values($1,$2,$3,true,'active','user',$4::jsonb)", [id, `Инженер ${index}`, email, JSON.stringify(LOAD_PERMISSIONS[scope])])
          await db.query("insert into auth_accounts(id,account_id,provider_id,user_id,password) values($1,$2,'credential',$2,$3)", [randomUUID(), id, hash])
        }
      })
      const currentActors = actors.slice(-25), start = performance.now(), sqlBefore = await auditSqlCount()
      const result = await Promise.all(currentActors.map(async (actor, index) => {
        const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } })
        try {
          const login = await context.request.post('/api/auth/sign-in/email', { data: { email: actor.email, password }, headers: { origin: baseURL! } }); expect(login.ok()).toBe(true)
          const page = await context.newPage(); let observed = ''; let rpc = 0
          page.on('request', request => { if (request.url().includes('/_serverFn/')) { observed = request.url(); rpc++ } })
          await page.goto('/journal'); await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 180000 })
          const call = async (name: string, data: unknown, method: 'GET' | 'POST') => {
            const url = new URL(siblingRpcUrl(observed, name + '_createServerFn_handler')), encoded = await serializeRpcData(data)
            if (method === 'GET') url.searchParams.set('payload', encoded)
            const response = await context.request.fetch(url.toString(), { method, ...(method === 'POST' ? { data: encoded } : {}), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
            const payload = await deserializeRpcResponse(await response.text()) as { result: any; error?: Error }
            if (payload.error) throw payload.error
            return payload.result
          }
          const row = await call('getWeldJointById', { id: jointIds[index] }, 'GET')
          const note = actor.scope === 'welding' ? 'weldingJournalNote' : actor.scope === 'lnk' ? 'lnkNote' : 'pstoNote'
          const value = `AUTH-25-${count}-${index}`
          await call('updateWeldJoint', { id: row.id, expectedVersion: row.rowVersion, mutationScope: actor.scope, [note]: value }, 'POST')
          expect((await call('getWeldJointById', { id: row.id }, 'GET'))[note]).toBe(value)
          return { scope: actor.scope, rpc }
        } finally { await context.close() }
      }))
      await new Promise(resolve => setTimeout(resolve, 550))
      const auditActors = await withE2eDatabase(async db => (await db.query('select count(distinct actor_id)::int as count from audit_operations where actor_id=any($1::text[]) and action=$2', [currentActors.map(actor => actor.id), 'updateWeldJoint'])).rows[0].count)
      expect(auditActors).toBe(25)
      console.log('AUTH_BROWSER_25', JSON.stringify({ label, count, elapsedMs: Math.round(performance.now() - start), sql: sqlBefore === undefined ? null : (await auditSqlCount())! - sqlBefore, users: result, auditedAuthors: auditActors }))
    }
  } finally {
    await cleanupLineProgramProjects([project])
    if (actors.length) await withE2eDatabase(db => db.query('delete from auth_users where id=any($1::text[])', [actors.map(actor => actor.id)]))
  }
})
