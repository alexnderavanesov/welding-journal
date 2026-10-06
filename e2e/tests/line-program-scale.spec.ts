import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

test('500 стыков: ограниченный DOM, поиск последней записи и отсутствие повторных RPC', async ({ page }) => {
  const project = 'E2E practical 500-joint line', line = 'SCALE-500'
  await withE2eDatabase(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'SCALE',$2,'II','A',10,0) returning id`, [project, line])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,stamp_1_k,has_vik)
      select $1,$2,'SCALE',$3,'F'||n,'2026-09-01','действующий','актуальная','С17','SCALE-A','да'
      from generate_series(1,500) n`, [program.id, project, line])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('/line-program')
    const program = page.getByTestId('line-program')
    await program.getByLabel('Поиск программы линий').fill(line)
    const card = program.getByTestId('line-program-card')
    await expect(card).toHaveCount(1)
    const responsePromise = page.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('getLineProgramJointPage_'))
    const start = Date.now()
    await card.getByRole('button', { name: 'Учитываемых соединений 500', exact: true }).click()
    const response = await responsePromise
    expect(response.ok()).toBe(true)
    const responseBytes = (await response.body()).length
    await expect(card.getByTestId('line-program-readonly-joint').first()).toBeVisible()
    expect(await card.getByTestId('line-program-readonly-joint').count()).toBeLessThanOrEqual(50)
    console.log(JSON.stringify({ workflow: '500-joint line over HTTP', milliseconds: Date.now() - start, responseBytes }))
    await card.getByTestId('program-scope-actions').getByRole('button', { name: /^Назначения/ }).click()
    const editor = page.getByRole('dialog', { name: /^Назначения ·/ })
    await editor.getByLabel('Поиск стыков в назначениях').fill('F500')
    await expect(editor.getByTestId('line-program-joint')).toHaveCount(1)
    await expect(editor.getByRole('checkbox', { name: 'Выбрать F500', exact: true })).toBeVisible()
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    await editor.getByRole('button', { name: 'Очистить поиск стыков' }).click()
    await editor.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
    for (const prefix of ['getLineProgramSection_', 'getLineProgramCalculation_', 'getLineProgramJointPage_']) {
      expect(calls.filter(name => name.startsWith(prefix))).toHaveLength(1)
    }
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
  }
})
