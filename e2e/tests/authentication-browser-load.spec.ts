import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { hashPassword } from 'better-auth/crypto'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { auditSqlCount } from '../audit-sql'
import { rpcName, siblingRpcUrl, serializeRpcData, deserializeRpcResponse } from '../rpc'
import type { Permission } from '../../src/lib/access-permissions'
import { observeAuthLoadTransport, probeAuthLoadServer, safeAuthLoadError } from '../auth-load-telemetry'
const LOAD_PERMISSIONS: Record<string, Permission[]> = {
  welding: ['welding.view', 'welding.edit', 'welding.import', 'welding.generate', 'welding.export', 'lnk.view', 'psto.view', 'lines.view', 'references.view', 'documents.view', 'documents.generate', 'documents.export', 'history.joint'],
  lnk: ['welding.view', 'lnk.view', 'lnk.edit', 'lnk.generate', 'lnk.export', 'psto.view', 'lines.view', 'references.view', 'documents.view', 'documents.generate', 'documents.export', 'history.joint'],
  psto: ['welding.view', 'lnk.view', 'psto.view', 'psto.edit', 'psto.generate', 'psto.export', 'lines.view', 'references.view', 'documents.view', 'documents.generate', 'documents.export', 'history.joint'],
}

const label = process.env.AUTH_BROWSER_LOAD
const project = 'AUTH BROWSER LOAD'
test.use({ trace: 'off', video: 'off' })
test('authentication: comparable table opening at 20k/200k and 25 authenticated users reading and saving', async ({ browser, baseURL }, info) => {
  test.skip(!label, 'Explicit isolated before/after measurement')
  test.setTimeout(900000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  const actors: Array<{ id: string; email: string; scope: 'welding' | 'lnk' | 'psto' }> = []
  const transport = observeAuthLoadTransport(baseURL!)
  const diagnosticGroups: Record<string, unknown>[] = []
  let diagnosticFailure: ReturnType<typeof safeAuthLoadError> | undefined
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
      const clientDiagnostics = currentActors.map((actor, index) => ({ index, scope: actor.scope,
        steps: [] as Record<string, unknown>[], browserRequests: [] as Record<string, unknown>[],
        pageErrors: [] as ReturnType<typeof safeAuthLoadError>[], droppedRequests: 0 }))
      const group: Record<string, unknown> = { count, commandTransport: 'browser-fetch', loginTransport: 'APIRequestContext', clients: clientDiagnostics }
      diagnosticGroups.push(group)
      let firstFailureHealth: ReturnType<typeof probeAuthLoadServer> | undefined
      // Every outcome and author is collected before fixture/user cleanup.
      // One transport failure must not invalidate the other 24 active sessions.
      const settled = await Promise.allSettled(currentActors.map(async (actor, index) => {
        const diagnostic = clientDiagnostics[index]
        const measure = async <T,>(phase: string, run: () => Promise<T>): Promise<T> => {
          const started = performance.now(), step: Record<string, unknown> = { phase, startMs: Math.round(started - start) }
          diagnostic.steps.push(step)
          try { const value = await run(); step.outcome = 'fulfilled'; return value }
          catch (error) { step.outcome = 'rejected'; step.error = safeAuthLoadError(error); throw error }
          finally { step.ms = Math.round(performance.now() - started) }
        }
        const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } })
        try {
          await measure('login', async () => {
            const login = await context.request.post('/api/auth/sign-in/email', { data: { email: actor.email, password }, maxRetries: 0,
              headers: { origin: baseURL!, 'x-e2e-auth-load-request-id': `auth-${count}-${index}-login` } })
            diagnostic.steps.at(-1)!.status = login.status()
            expect(login.ok()).toBe(true)
          })
          const page = await context.newPage(); let observed = ''; let rpc = 0, commandRpc = 0, backgroundRpc = 0
          const requests = new Map<object, Record<string, unknown>>()
          page.on('pageerror', error => diagnostic.pageErrors.push(safeAuthLoadError(error)))
          page.on('request', request => { if (request.url().includes('/_serverFn/')) {
            observed = request.url(); rpc++
            const commandId = request.headers()['x-e2e-auth-load-request-id']
            const command = commandId?.startsWith(`auth-${count}-${index}-`) === true
            if (command) commandRpc++; else backgroundRpc++
            if (diagnostic.browserRequests.length >= 200) { diagnostic.droppedRequests++; return }
            const record = { name: rpcName(request.url()), method: request.method(), startMs: Math.round(performance.now() - start),
              kind: command ? 'command' : 'background', ...(command ? { commandId } : {}) }
            requests.set(request, record); diagnostic.browserRequests.push(record)
          } })
          page.on('response', response => { const record = requests.get(response.request()); if (record) record.status = response.status() })
          page.on('requestfinished', request => { const record = requests.get(request); if (record) {
            record.endMs = Math.round(performance.now() - start); record.timing = request.timing()
          } })
          page.on('requestfailed', request => { const record = requests.get(request); if (record) {
            record.endMs = Math.round(performance.now() - start); record.failure = safeAuthLoadError(request.failure()?.errorText)
          } })
          await measure('page-open', async () => {
            await page.goto('/journal'); await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 180000 })
          })
          const call = async (name: string, data: unknown, method: 'GET' | 'POST', phase: 'read' | 'save' | 'verify') => measure(phase, async () => {
            const url = new URL(siblingRpcUrl(observed, name + '_createServerFn_handler')), encoded = await serializeRpcData(data)
            if (method === 'GET') url.searchParams.set('payload', encoded)
            // Use the real browser's connection pool and its authenticated
            // cookies. Keep the former APIRequestContext 30s deadline and make
            // exactly one fetch; neither reads nor writes are retried here.
            const response = await page.evaluate(async ({ endpoint, method, encoded, commandId }) => {
              const controller = new AbortController()
              const timer = window.setTimeout(() => controller.abort(), 30_000)
              try {
                const response = await fetch(endpoint, { method, credentials: 'same-origin', signal: controller.signal,
                  ...(method === 'POST' ? { body: encoded } : {}),
                  headers: { 'content-type': 'application/json', 'x-tsr-serverFn': 'true', 'x-e2e-auth-load-request-id': commandId } })
                return { status: response.status, ok: response.ok, text: await response.text() }
              } finally { window.clearTimeout(timer) }
            }, { endpoint: url.toString(), method, encoded, commandId: `auth-${count}-${index}-${phase}` })
            diagnostic.steps.at(-1)!.status = response.status
            expect(response.ok).toBe(true)
            const payload = await deserializeRpcResponse(response.text) as { result: any; error?: Error }
            if (payload.error) throw payload.error
            return payload.result
          })
          const row = await call('getWeldJointById', { id: jointIds[index] }, 'GET', 'read')
          const note = actor.scope === 'welding' ? 'weldingJournalNote' : actor.scope === 'lnk' ? 'lnkNote' : 'pstoNote'
          const value = `AUTH-25-${count}-${index}`
          await call('updateWeldJoint', { id: row.id, expectedVersion: row.rowVersion, mutationScope: actor.scope, [note]: value }, 'POST', 'save')
          expect((await call('getWeldJointById', { id: row.id }, 'GET', 'verify'))[note]).toBe(value)
          expect(commandRpc).toBe(3)
          return { scope: actor.scope, rpc, backgroundRpc, commandRpc, commandTransport: 'browser-fetch' }
        } catch (error) {
          firstFailureHealth ??= probeAuthLoadServer(baseURL!)
          throw error
        } finally { await measure('context-close', () => context.close()) }
      }))
      group.outcomes = settled.map((result, index) => ({ index, status: result.status,
        ...(result.status === 'rejected' ? { error: safeAuthLoadError(result.reason) } : result.value) }))
      group.allClientsSettledMs = Math.round(performance.now() - start)
      if (firstFailureHealth) group.firstFailureHealth = await firstFailureHealth
      group.finalHealth = await probeAuthLoadServer(baseURL!)
      await new Promise(resolve => setTimeout(resolve, 550))
      let auditActors: number | undefined
      try { auditActors = await withE2eDatabase(async db => (await db.query('select count(distinct actor_id)::int as count from audit_operations where actor_id=any($1::text[]) and action=$2', [currentActors.map(actor => actor.id), 'updateWeldJoint'])).rows[0].count) }
      catch (error) { group.auditQueryError = safeAuthLoadError(error) }
      group.auditedAuthors = auditActors ?? null
      const failures = settled.flatMap((result, index) => result.status === 'rejected' ? [{ index, error: safeAuthLoadError(result.reason) }] : [])
      console.log('AUTH_BROWSER_25_DIAGNOSTIC', JSON.stringify({ count, commandTransport: 'browser-fetch', settled: settled.length, failures, auditedAuthors: auditActors ?? null,
        firstFailureHealth: group.firstFailureHealth, finalHealth: group.finalHealth }))
      expect(failures).toEqual([])
      expect(auditActors).toBe(25)
      expect(clientDiagnostics.flatMap(client => client.pageErrors)).toEqual([])
      console.log('AUTH_BROWSER_25', JSON.stringify({ label, count, commandTransport: 'browser-fetch', elapsedMs: Math.round(performance.now() - start), sql: sqlBefore === undefined ? null : (await auditSqlCount())! - sqlBefore,
        users: settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []), auditedAuthors: auditActors }))
    }
  } catch (error) {
    diagnosticFailure = safeAuthLoadError(error)
    throw error
  } finally {
    transport.stop()
    try {
      const path = info.outputPath('auth-browser-load-diagnostics.json')
      await writeFile(path, JSON.stringify({ label, commandTransport: 'browser-fetch', loginTransport: 'APIRequestContext',
        outcome: diagnosticFailure ? 'failed' : 'completed', failure: diagnosticFailure,
        groups: diagnosticGroups, transport: transport.snapshot() }, null, 2))
      await info.attach('auth-browser-load-diagnostics', { path, contentType: 'application/json' })
    } finally {
      await cleanupLineProgramProjects([project])
      if (actors.length) await withE2eDatabase(db => db.query('delete from auth_users where id=any($1::text[])', [actors.map(actor => actor.id)]))
    }
  }
})
