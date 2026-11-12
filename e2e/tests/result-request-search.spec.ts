import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'
import { listLnkWorkflowRows } from '../../src/server/lnk-workflow-context'
import { listPstoWorkflowRows } from '../../src/server/psto-workflow-context'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'

const project = 'E2E result request search'
type Scope = 'primary' | 'beforeHeatTreatment' | 'psto' | 'tvmt'
test.afterEach(async ({ page }) => { await page.close(); await cleanupLineProgramProjects([project]) })

async function seed(scope: Scope) {
  return withLineProgramFixture(async db => {
    const rows = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,has_rk,has_uzk,has_pvk,psto_required,pre_heat_treatment_required,lnk_created_at,psto_created_at)
      select $1,'FAR','FAR-L'||lpad(n::text,4,'0'),'F990'||lpad(n::text,4,'0'),'2026-10-01','С17','действующий','актуальная','да','нет','нет','нет',$2,$2='да','2026-10-01','2026-10-01'
      from generate_series(1,601)n returning id`, [project, scope === 'primary' ? 'нет' : 'да'])).rows.map(row => Number(row.id))
    await db.query(`update weld_joints set vik_request='Wrong primary stage',vik_request_date='2026-10-02',vik_result='ожидает НК' where project_title=$1`, [project])
    if (scope === 'primary') {
      await db.query(`update weld_joints set vik_request='Far request '||substring(line from 6)::integer where project_title=$1`, [project])
    } else {
      await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
        select id,'ВИК',case when $2 then 'Far request '||substring(line from 6)::integer else 'Completed before TO' end,'2026-10-02',
          case when $2 then 'ожидает НК' else 'годен' end,case when $2 then null else 'Before TO conclusion' end,case when $2 then null else '2026-10-03'::date end
        from weld_joints where project_title=$1`, [project, scope === 'beforeHeatTreatment'])
      if (scope === 'psto' || scope === 'tvmt') {
        await db.query(`update weld_joints set psto_request='Far request '||substring(line from 6)::integer,psto_request_date='2026-10-04' where project_title=$1`, [project])
        if (scope === 'tvmt') await db.query(`update weld_joints set psto_result='проведено',psto_date='2026-10-05',heat_treatment_diagram='PSTO diagram',tvmt_request='Far request '||substring(line from 6)::integer,tvmt_request_date='2026-10-06',tvmt_result='ожидает НК' where project_title=$1`, [project])
        // The distant request lives in a repeat: an old primary request must not win the search.
        await db.query(`update weld_joints set psto_result='проведено',psto_date='2026-10-05',heat_treatment_diagram='Old PSTO',tvmt_request='Old TVMT',tvmt_request_date='2026-10-06',tvmt_result='не годен',tvmt_conclusion='Old TVMT result',tvmt_conclusion_date='2026-10-07' where id=$1`, [rows.at(-1)])
        await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_result,psto_date,heat_treatment_diagram,tvmt_request,tvmt_request_date,tvmt_result)
          values($1,2,'Far request 601','2026-10-08',$2,$3,$4,$5,$6,$7)`, [rows.at(-1), scope === 'tvmt' ? 'проведено' : null, scope === 'tvmt' ? '2026-10-09' : null, scope === 'tvmt' ? 'Repeat diagram' : null, scope === 'tvmt' ? 'Far request 601' : null, scope === 'tvmt' ? '2026-10-10' : null, scope === 'tvmt' ? 'ожидает НК' : null])
      }
    }
    return rows
  })
}

for (const scope of ['primary', 'beforeHeatTreatment', 'psto', 'tvmt'] as const) test(`${scope}: finds a request beyond 500 candidates and preserves the existing result draft`, async ({ page }) => {
  const ids = await seed(scope)
  const specialty = scope === 'psto' || scope === 'tvmt'
  const candidates = specialty
    ? await asE2eOwner(() => listPstoWorkflowRows({ scope: scope === 'tvmt' ? 'tvmtResultCandidates' : 'resultCandidates' }), 'psto.view')()
    : await asE2eOwner(() => listLnkWorkflowRows({ scope: scope === 'primary' ? 'resultCandidates' : 'preHeatTreatmentResultCandidates', methodKeys: ['vikRequest'] }), 'lnk.view')()
  expect(candidates.length).toBe(500)
  expect(candidates.some(row => row.id === ids.at(-1))).toBe(false)
  await ensureDispatcherTaskIndexFresh()
  await page.goto(specialty ? '/psto' : '/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F9900001')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await page.locator('[data-weld-report-grid] .ag-header-cell').getByRole('checkbox').check()
  await page.locator('header').getByRole('button', { name: scope === 'tvmt' ? 'ТВМТ' : 'Результат', exact: true }).click()
  await page.getByRole('button', { name: scope === 'tvmt' ? 'Внести результаты ТВМТ' : 'Внести результаты', exact: true }).click()
  const title = scope === 'psto' ? 'Внесение результатов ПСТО' : scope === 'tvmt' ? 'Внесение результатов ТВМТ' : scope === 'beforeHeatTreatment' ? 'Внесение результатов ЛНК до ТО' : 'Внесение результатов ЛНК'
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  if (!specialty) {
    const method = dialog.getByRole('combobox', { name: 'Метод контроля', exact: true })
    const expected = scope === 'primary' ? 'vikRequest' : 'ВИК'
    if (await method.inputValue() !== expected) {
      await method.click()
      await page.getByRole('listbox').getByRole('option', { name: 'ВИК', exact: true }).click()
    }
  }
  const selected = dialog.getByRole('button', { name: 'Выбрано: 1', exact: true })
  await expect(selected).toBeVisible()
  const date = dialog.getByLabel(scope === 'psto' ? 'Дата ПСТО' : scope === 'tvmt' ? 'Дата ТВМТ' : 'Дата контроля', { exact: true })
  await date.fill('2026-10-12')
  if (scope === 'tvmt') await dialog.getByRole('combobox', { name: 'Результат для выбранных' }).selectOption('годен')
  else if (!specialty) await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык', { exact: true }).fill('')
  const filter = dialog.getByRole('combobox', { name: /^Фильтр по заявке/ })
  if (specialty) {
    await filter.fill(scope === 'psto' ? '08.10.2026' : '10.10.2026')
    await expect(dialog.getByRole('option', { name: /^Far request 601/ })).toBeVisible()
  }
  await filter.fill('Far request 601')
  await dialog.getByRole('option', { name: /^Far request 601/ }).click()
  await expect(filter).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.getByRole('checkbox', { name: 'Выбрать стык FAR-L0601 F9900601', exact: true })).toBeVisible()
  await expect(selected).toBeVisible()
  await expect(date).toHaveValue('2026-10-12')
  await selected.click()
  const first = dialog.getByRole('checkbox', { name: 'Выбрать стык FAR-L0001 F9900001', exact: true })
  await expect(first).toBeChecked()
  if (scope === 'tvmt') await expect(dialog.getByRole('combobox', { name: 'Результат для выбранных' })).toHaveValue('годен')
  else if (!specialty) await expect(dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
