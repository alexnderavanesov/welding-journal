import { expect, test, type Page } from '@playwright/test'
import { copyFile, writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { createSmoothnessProbe } from '../smoothness-probe'
import { rpcName } from '../rpc'

const enabled = process.env.SMOOTHNESS_LINE_FAMILY === '1'
test.skip(!enabled, 'Explicit isolated mixed-family production-build comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 20000 })

const searchA = 'familytokena1105'
const searchB = 'familytokenb1105'
const project = `E2E family performance ${searchA}`
const subtitle = `FAMILY-${searchB}`
const line = 'FAMILY-MIXED-0001'
const stamp = 'H001'
const supportCount = 10

// These are deliberately primary physical joints, with persisted primary states.
// R/W/Y would add ancestry cost unrelated to reading the other connection family.
// Both phases keep exactly the same ten T rows/IDs; only the C population grows.
async function growFixture(commonCount: 50 | 4000) {
  return withLineProgramFixture(async db => {
    if (commonCount === 50) {
      await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,
        weld_control_percent,pvk_control_percent,support_uzk_control_percent,support_pvk_control_percent)
        values($1,$2,$3,'II','Б(а)',10,10,10,10)`, [project, subtitle, line])
      await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
        connection_type,officiality,revision_actuality,welding_method,material_group,d1,t1,weld_length,
        stamp_1_k,stamp_1_k_fact,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,psto_required)
        select p.id,p.project_title,p.subtitle_code,p.line,'ОП'||lpad(n::text,4,'0'),'2026-10-01',
        'Т1','действующий','актуальная','РД','М01',108,4,600.25,$2,$2,
        'да','FAMILY-VIK','2026-10-02','годен','FAMILY-VIK-C','2026-10-03','нет'
        from line_programs p cross join generate_series(1,10) n where p.project_title=$1`, [project, stamp])
    }
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      connection_type,officiality,revision_actuality,welding_method,material_group,d1,d2,t1,t2,wdi,
      stamp_1_k,stamp_1_k_fact,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,psto_required)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||lpad(n::text,4,'0'),'2026-10-01',
      'С17','действующий','актуальная','РД','М01',108,108,4,4,0.42,'G001','G001',
      'да','FAMILY-VIK','2026-10-02','годен','FAMILY-VIK-C','2026-10-03','нет'
      from line_programs p cross join generate_series($2::int,$3::int) n where p.project_title=$1`,
    [project, commonCount === 50 ? 1 : 51, commonCount])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1 on conflict(weld_joint_id) do nothing`, [project])
    await db.query('analyze weld_joints')
    await db.query('analyze weld_joint_program_states')
    const rows = await db.query<{ id: number; connection_type: string }>(
      'select id,connection_type from weld_joints where project_title=$1 order by id', [project])
    expect(rows.rows.filter(row => row.connection_type === 'С17')).toHaveLength(commonCount)
    const supportIds = rows.rows.filter(row => row.connection_type === 'Т1').map(row => row.id)
    expect(supportIds).toHaveLength(supportCount)
    return supportIds
  })
}

function waitForRpc(page: Page, name: string) {
  return page.waitForResponse(response => response.url().includes('/_serverFn/') &&
    new RegExp(`^${name}(?:_|$)`).test(rpcName(response.url())), { timeout: 120000 })
}

async function expectSectionReady(page: Page, joints: number) {
  await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 1', exact: true })).toBeVisible({ timeout: 120000 })
  await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: `Учитываемых соединений ${joints}`, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Расчёт итогов раздела', exact: true })).toBeEnabled({ timeout: 120000 })
  await expect(page.getByRole('status').filter({ hasText: /Загружаем найденные линии|Рассчитываем/ })).toHaveCount(0)
}

test('same ten T joints: 50 then 4000 C joints, distinct searches and nested assignment loading', async ({ browser }, info) => {
  test.setTimeout(600000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.SMOOTHNESS_LABEL).toBeTruthy()
  const phases: { commonCount: number; supportIds: number[]; warmSearchProgramRequests: string[] }[] = []
  let originalSupportIds: number[] | undefined
  try {
    for (const commonCount of [50, 4000] as const) {
      const supportIds = await growFixture(commonCount)
      if (originalSupportIds) expect(supportIds).toEqual(originalSupportIds)
      else originalSupportIds = supportIds
      // A fresh client prevents the 50-row phase's React Query data from masking
      // the fixture revision; server caches are invalidated by the fixture helper.
      const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE,
        baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } })
      const page = await context.newPage()
      page.setDefaultTimeout(20000)
      const probe = await createSmoothnessProbe(page, info)
      const programRequests: string[] = []
      page.on('request', request => {
        if (!request.url().includes('/_serverFn/')) return
        const name = rpcName(request.url())
        if (/^getLineProgram(Page|Section|Calculation|JointPage)(?:_|$)/.test(name)) programRequests.push(name)
      })
      const prefix = `family:T${supportCount}:C${commonCount}`
      try {
        // Ordinary opening is recorded separately: its C calculations and the
        // authentication/dispatcher bootstrap are not a pure supports RPC cost.
        await probe.measure(`${prefix}:initial-all-lines`, async () => {
          await page.goto('/line-program')
          await expectSectionReady(page, commonCount)
        })
        await probe.measure(`${prefix}:supports-tab`, async () => {
          const response = waitForRpc(page, 'getLineProgramSection')
          await page.getByRole('button', { name: 'Опоры', exact: true }).click()
          expect((await response).ok()).toBe(true)
          await expectSectionReady(page, supportCount)
        })
        for (const [label, search] of [['A', searchA], ['B', searchB]] as const) {
          await probe.measure(`${prefix}:search-${label}-new-key`, async () => {
            const response = waitForRpc(page, 'getLineProgramSection')
            await page.getByLabel('Поиск программы линий', { exact: true }).fill(search)
            expect((await response).ok()).toBe(true)
            await expectSectionReady(page, supportCount)
          })
        }
        const beforeWarm = programRequests.length
        await probe.measure(`${prefix}:search-A-repeat-key`, async () => {
          await page.getByLabel('Поиск программы линий', { exact: true }).fill(searchA)
          // The input has a 250 ms debounce. Observe its pending state before
          // accepting the same visible line. A can need no RPC within staleTime,
          // but a slow prior sample may exceed it: record that rather than fail.
          await expect(page.getByRole('status').filter({ hasText: 'Загружаем найденные линии' })).toBeVisible()
          await expectSectionReady(page, supportCount)
        })
        const warmSearchProgramRequests = programRequests.slice(beforeWarm)
        phases.push({ commonCount, supportIds, warmSearchProgramRequests })
        await probe.measure(`${prefix}:T-calculation`, async () => {
          const response = waitForRpc(page, 'getLineProgramCalculation')
          await page.getByRole('button', { name: `Расчёт линии ${line}`, exact: true }).click()
          expect((await response).ok()).toBe(true)
          await expect(page.locator('[data-program-grid="stamps"] .ag-row').first()).toBeVisible({ timeout: 120000 })
          await expect(page.getByRole('button', { name: `Клеймо ${stamp}`, exact: true })).toBeVisible()
        })
        // Open assignments before the nested read-only joints so this operation
        // includes the first JointPage RPC, rather than a previously warmed copy.
        await probe.measure(`${prefix}:T-assignments-cold-rows`, async () => {
          const response = waitForRpc(page, 'getLineProgramJointPage')
          await page.getByRole('button', { name: `Открыть назначения линии ${line}`, exact: true }).click()
          expect((await response).ok()).toBe(true)
          await expect(page.getByRole('checkbox', { name: 'Выбрать ОП0001', exact: true })).toBeVisible({ timeout: 120000 })
          await expect(page.getByRole('checkbox', { name: /^Выбрать F\d/ })).toHaveCount(0)
        })
        const assignments = page.locator('[data-program-grid="assignments"]')
        await probe.measure(`${prefix}:T-assignments-select-ten`, async () => {
          const all = assignments.getByRole('checkbox', { name: 'Выбрать все доступные стыки', exact: true })
          await all.click()
          await expect(all).toBeChecked()
          await expect(assignments.getByRole('checkbox', { name: 'Выбрать ОП0001', exact: true })).toBeChecked()
          await all.click()
          await expect(all).not.toBeChecked()
        })
        await page.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
        await expect(assignments).toBeHidden()
        await probe.measure(`${prefix}:T-nested-joints-warm-rows`, async () => {
          await page.getByRole('button', { name: 'По клеймам', exact: true }).click()
          await page.getByRole('button', { name: `Клеймо ${stamp}`, exact: true }).click()
          const joints = page.locator('[data-program-grid="joints"]').filter({ visible: true })
          await expect(joints.getByText('ОП0001', { exact: true })).toBeVisible()
          await expect(joints.getByText(/^F\d{4}$/)).toHaveCount(0)
        })
      } finally {
        try {
          await probe.finish()
          await copyFile(info.outputPath('smoothness.json'), info.outputPath(`family-T${supportCount}-C${commonCount}.json`))
        } finally { await context.close() }
      }
    }
  } finally {
    await writeFile(info.outputPath('family-fixture.json'), JSON.stringify({ label: process.env.SMOOTHNESS_LABEL,
      runtime: process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', project, subtitle, line, searchA, searchB,
      primaryOnly: true, supportCount, phases,
      notes: 'New search keys exercise server overview reuse; repeated A records client-cache reuse or a staleTime refetch. Initial opening includes bootstrap. No timing threshold or business-rule acceptance is inferred.' }, null, 2))
    await cleanupLineProgramProjects([project])
  }
})
