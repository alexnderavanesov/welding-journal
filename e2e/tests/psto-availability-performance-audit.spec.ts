import { expect, test, type Page, type Response } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcResponse, rpcName, siblingRpcUrl } from '../rpc'
import { availabilityFromSummary, samplePstoAvailabilitySql } from '../psto-availability-probe'
import { createSmoothnessProbe } from '../smoothness-probe'
import type { PstoWorkflowSummary } from '../../src/server/weld-contracts'

const enabled = process.env.SMOOTHNESS_PSTO_AVAILABILITY === '1'
const project = 'E2E PSTO availability 5000'
const profiles = ['primary-positive', 'completed-no-candidates', 'blocked-no-history', 'repeat-history'] as const
type Profile = typeof profiles[number]
test.skip(!enabled, 'Explicit isolated PSTO summary/EXISTS comparison')
test.use({ actionTimeout: 20000, trace: 'off', video: 'off' })
test.afterEach(async () => { if (enabled) await cleanupLineProgramProjects([project]) })

async function seedProfile(profile: Profile, initial: boolean) {
  await withLineProgramFixture(async db => {
    if (initial) {
      // global-setup owns one standard joint. Remove only that precisely
      // identified seed, never a whole table/project or an arbitrary record.
      const baseline = await db.query(`select id,project_title,subtitle_code,line,joint,isometry,spool,
        connection_type,weld_date::text from weld_joints`)
      expect(baseline.rows.map(({ id: _id, ...row }) => row),
        'This standalone audit requires exactly the known global-setup joint').toEqual([{
        project_title: 'E2E проект', subtitle_code: 'E2E-001', line: 'E2E-L1', joint: 'F1',
        isometry: 'ISO-E2E', spool: 'E2E-S1', connection_type: 'СШ', weld_date: '2026-08-01',
      }])
      const removed = await db.query(`delete from weld_joints where id=$1 and project_title='E2E проект'
        and subtitle_code='E2E-001' and line='E2E-L1' and joint='F1' returning id`, [baseline.rows[0].id])
      expect(removed.rowCount).toBe(1)
      expect((await db.query('select count(*)::integer n from weld_joints')).rows[0].n).toBe(0)
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,
        officiality,revision_actuality,has_vik,psto_required,lnk_created_at,psto_created_at)
        select $1,'PSTO-AVAIL','PSTO-AVAIL','F'||lpad(n::text,5,'0'),'2026-10-01','С17',
          'действующий','актуальная','да','да','2026-10-01','2026-10-01' from generate_series(1,5000) n`, [project])
      await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
        select id,'ВИК','AVAIL-PRE','2026-10-02','годен','AVAIL-PRE-C','2026-10-03' from weld_joints where project_title=$1`, [project])
    }
    await db.query('delete from psto_repeat_cycles where weld_joint_id in (select id from weld_joints where project_title=$1)', [project])
    await db.query(`update weld_joints set psto_required='да',psto_request=null,psto_request_date=null,psto_result=null,
      psto_date=null,heat_treatment_diagram=null,tvmt_request=null,tvmt_request_date=null,tvmt_result=null,
      tvmt_conclusion=null,tvmt_conclusion_date=null where project_title=$1`, [project])
    await db.query(`update pre_heat_treatment_controls set result='годен'
      where weld_joint_id in (select id from weld_joints where project_title=$1)`, [project])
    if (profile === 'primary-positive') {
      await db.query(`update weld_joints set
        psto_request=case when substring(joint from 2)::int%5<>0 then 'AVAIL-PSTO' end,
        psto_request_date=case when substring(joint from 2)::int%5<>0 then date '2026-10-04' end,
        psto_result=case when substring(joint from 2)::int%5>=2 then 'проведено' end,
        psto_date=case when substring(joint from 2)::int%5>=2 then date '2026-10-05' end,
        tvmt_request=case when substring(joint from 2)::int%5>=3 then 'AVAIL-TVMT' end,
        tvmt_request_date=case when substring(joint from 2)::int%5>=3 then date '2026-10-06' end,
        tvmt_result=case when substring(joint from 2)::int%5=4 then 'годен' end,
        psto_required=case when substring(joint from 2)::int%5=4 then 'отменен' else 'да' end
        where project_title=$1`, [project])
    } else if (profile === 'blocked-no-history') {
      await db.query(`update pre_heat_treatment_controls set result='ремонт'
        where weld_joint_id in (select id from weld_joints where project_title=$1)`, [project])
    } else {
      await db.query(`update weld_joints set psto_request='AVAIL-PSTO',psto_request_date='2026-10-04',
        psto_result='проведено',psto_date='2026-10-05',tvmt_request='AVAIL-TVMT',tvmt_request_date='2026-10-06',
        tvmt_result='годен' where project_title=$1`, [project])
      if (profile === 'repeat-history') {
        await db.query(`update weld_joints set
          psto_required=case when substring(joint from 2)::int%10 in (5,6) then 'отменен' else 'да' end,
          tvmt_result=case when substring(joint from 2)::int%10=8 then 'не годен' else 'годен' end
          where project_title=$1`, [project])
        await db.query(`update pre_heat_treatment_controls set result='ремонт' where weld_joint_id in
          (select id from weld_joints where project_title=$1 and substring(joint from 2)::int%10=7)`, [project])
        await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_result,psto_date,
          tvmt_request,tvmt_request_date,tvmt_result)
          select id,2,'AVAIL-REPEAT-2','2026-10-07','проведено','2026-10-08','AVAIL-TVMT-2','2026-10-09',
            case when substring(joint from 2)::int%10=9 then 'не годен' else 'годен' end
          from weld_joints where project_title=$1`, [project])
        await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_result,psto_date,
          tvmt_request,tvmt_request_date,tvmt_result)
          select id,3,'AVAIL-REPEAT-3','2026-10-10',
            case when substring(joint from 2)::int%10 not in (1,5,7) then 'проведено' end,
            case when substring(joint from 2)::int%10 not in (1,5,7) then date '2026-10-11' end,
            case when substring(joint from 2)::int%10 in (0,3,4,8,9) then 'AVAIL-TVMT-3' end,
            case when substring(joint from 2)::int%10 in (0,3,4,8,9) then date '2026-10-12' end,
            case when substring(joint from 2)::int%10=0 then 'не годен'
              when substring(joint from 2)::int%10 in (4,8,9) then 'годен' end
          from weld_joints where project_title=$1`, [project])
      }
    }
    // Keep planner statistics comparable; this is outside timed operations.
    for (const table of ['weld_joints', 'psto_repeat_cycles', 'pre_heat_treatment_controls']) await db.query(`analyze ${table}`)
  })
}

async function readResponse(response: Response) {
  expect(response.ok()).toBe(true)
  const text = await response.text()
  expect(await response.finished()).toBeNull()
  const payload = await deserializeRpcResponse(text) as { result: unknown; error?: unknown }
  expect(payload.error).toBeUndefined()
  const timing = response.request().timing()
  return { result: payload.result, bytes: Buffer.byteLength(text),
    elapsedMs: timing.responseEnd, ttfbMs: timing.responseStart - timing.requestStart,
    requestStartMs: timing.requestStart, responseStartMs: timing.responseStart }
}

async function sampleHttp(page: Page, url: string) {
  const sample = await page.evaluate(async url => {
    performance.clearResourceTimings()
    const start = performance.now()
    const response = await fetch(url, { cache: 'no-store', headers: { 'x-tsr-serverFn': 'true' } })
    const headersMs = performance.now() - start
    const text = await response.text()
    const elapsedMs = performance.now() - start
    const timing = performance.getEntriesByName(url).at(-1) as PerformanceResourceTiming | undefined
    return { ok: response.ok, text, elapsedMs, headersMs,
      ttfbMs: timing ? timing.responseStart - timing.requestStart : null }
  }, url)
  expect(sample.ok).toBe(true)
  const { result, error } = await deserializeRpcResponse(sample.text) as { result: unknown; error?: unknown }
  expect(error).toBeUndefined()
  const { text: _text, ...timing } = sample
  return { ...timing, bytes: Buffer.byteLength(sample.text), result }
}

test('5000: exact summary versus presence with primary, empty and repeat-history scopes', async ({ browser, context }, info) => {
  test.setTimeout(600000)
  const results: unknown[] = []
  const save = () => writeFile(info.outputPath('psto-availability.json'), JSON.stringify({
    label: process.env.SMOOTHNESS_LABEL, runtime: process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output',
    note: 'First menu is cold React Query/module state; DB/OS caches are not forcibly cleared. SQL samples are warm and alternate query order.',
    results,
  }, null, 2))
  try {
    for (const [index, profile] of profiles.entries()) {
      await seedProfile(profile, index === 0)
      const isolated = await browser.newContext({ storageState: await context.storageState(), baseURL: test.info().project.use.baseURL,
        viewport: { width: 1600, height: 1000 } })
      const page = await isolated.newPage()
      page.setDefaultTimeout(20000)
      const probe = await createSmoothnessProbe(page, info)
      let initial!: Awaited<ReturnType<typeof readResponse>>
      let observedUrl = ''
      try {
        await page.goto('/psto')
        await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 })
        await probe.measure(`${profile}:first-menu`, async () => {
          const response = page.waitForResponse(value => value.url().includes('/_serverFn/') &&
            /^getPstoWorkflow(?:Summary|Availability)(?:_|$)/.test(rpcName(value.url())), { timeout: 120000 })
          await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
          const received = await response
          observedUrl = received.url()
          initial = await readResponse(received)
        })
        const summaryUrl = siblingRpcUrl(observedUrl, 'getPstoWorkflowSummary_createServerFn_handler')
        const http: { kind: string; round: number; sample: Awaited<ReturnType<typeof sampleHttp>> }[] = []
        // The future app endpoint is optional: today's baseline still runs.
        let availabilityUrl: string | undefined
        if (process.env.PSTO_AVAILABILITY_HTTP === '1') availabilityUrl = siblingRpcUrl(observedUrl, 'getPstoWorkflowAvailability_createServerFn_handler')
        for (let round = 0; round < 3; round++) {
          http.push({ kind: 'summary', round, sample: await sampleHttp(page, summaryUrl) })
          if (availabilityUrl) http.push({ kind: 'availability', round, sample: await sampleHttp(page, availabilityUrl) })
        }
        const sql = await samplePstoAvailabilitySql()
        for (const { kind, sample } of http) expect(sample.result).toEqual(kind === 'summary' ? sql.counts : sql.availability)
        const initialIsSummary = /^getPstoWorkflowSummary(?:_|$)/.test(rpcName(observedUrl))
        expect(initial.result).toEqual(initialIsSummary ? sql.counts : sql.availability)
        // Independent fixture expectations also cover ignored inactive repeats,
        // an old failed cycle followed by a good one, and rejected pre-controls.
        const expected = profile === 'primary-positive' ? [1000, 4000, 1000, 4000, 1000, 1000]
          : profile === 'completed-no-candidates' ? [0, 5000, 0, 5000, 0, 0]
          : profile === 'blocked-no-history' ? [0, 0, 0, 0, 0, 0]
          : [500, 5000, 500, 5000, 1000, 500]
        expect([sql.counts.requestCandidateCount, sql.counts.requestRegistryCount, sql.counts.resultCandidateCount,
          sql.counts.resultRegistryCount, sql.counts.tvmtRequestCandidateCount, sql.counts.tvmtResultCandidateCount]).toEqual(expected)
        expect(sql.availability).toEqual(availabilityFromSummary(sql.counts as PstoWorkflowSummary))
        results.push({ profile, jointCount: 5000, initialRpc: rpcName(observedUrl), initial, http, sql })
        await save()
      } finally {
        await probe.finish()
        // Each probe writes the same default name; preserve every profile.
        const { copyFile } = await import('node:fs/promises')
        await copyFile(info.outputPath('smoothness.json'), info.outputPath(`smoothness-${profile}.json`))
        await isolated.close()
      }
    }
  } finally { await save() }
})
