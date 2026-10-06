import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { programApprovalKey } from '../../src/lib/program-control-approval'
import { rpcName } from '../rpc'

const project = 'E2E approval category'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('Согласования контроля не смешиваются с другими исключениями; фильтр не пересчитывает диспетчер', async ({ page }) => {
  await withE2eDatabase(async db => {
    const line = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'FILTER','FILTER-L1','II','A',10,10) returning id`, [project])).rows[0]
    const joint = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,has_vik,has_rk,has_uzk)
      values ($1,$2,'FILTER','FILTER-L1','S1','2026-09-01','действующий','актуальная','С17','да','да','да') returning id`, [line.id, project])).rows[0]
    await db.query(`insert into dispatcher_accepted_warnings(key,kind,title,context,weld_joint_id,line_program_id)
      values ($1,'line-program-control','E2E согласован РК+УЗК','РК - УЗК',$2,null),
        ('e2e-filter-percentage','percentage-line-control','E2E принято клеймо','Клеймо: K1',null,$3),
        ('e2e-filter-other','line-consistency','E2E проверка линии','Проверка: история',null,$3)`,
    [programApprovalKey({ id: joint.id, hasRk: 'да', hasUzk: 'да' }, 'common', true), joint.id, line.id])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url()).split('_')[0]) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Принятые исключения', exact: true }).click()
  const panel = page.locator('#settings-panel-acceptedWarnings')
  await expect(panel.getByText('Всего: 3', { exact: true })).toBeVisible()
  const beforeFilter = calls.length
  await panel.getByRole('button', { name: 'Согласования контроля', exact: true }).click()
  await expect(panel.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E согласован РК+УЗК', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E принято клеймо', { exact: true })).toHaveCount(0)
  await expect(panel.getByText('E2E проверка линии', { exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Процентные линии', exact: true }).click()
  await expect(panel.getByText('E2E принято клеймо', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E согласован РК+УЗК', { exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Другие', exact: true }).click()
  await expect(panel.getByText('E2E проверка линии', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E согласован РК+УЗК', { exact: true })).toHaveCount(0)
  expect(calls.slice(beforeFilter)).toEqual(Array(3).fill('listDispatcherAcceptedWarnings'))
  expect(errors).toEqual([])
})
